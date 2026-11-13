import JSZip from "jszip";
import { AppError } from "./errors.js";

/** Planilha lida: nomes das colunas (primeira linha) e as linhas como texto. */
export type Planilha = { colunas: string[]; linhas: string[][] };

const LIMITE_LINHAS = 5000;

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };

function decodificar(texto: string) {
  return texto
    .replace(/&(amp|lt|gt|quot|apos);/g, (entidade) => ENTIDADES[entidade])
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codigo: string) => String.fromCodePoint(Number.parseInt(codigo, 16)));
}

/** Texto de um nó com <t> (vários quando há formatação rica). */
function textoDosT(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((parte) => decodificar(parte[1])).join("");
}

/** "AB12" → 27 (coluna, base 0). */
function indiceDaColuna(referencia: string) {
  const letras = referencia.replace(/\d+/g, "").toUpperCase();
  let indice = 0;
  for (const letra of letras) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return indice - 1;
}

/** Número de série do Excel em data AAAA-MM-DD (só quando o estilo é de data não dá para saber; fica como número). */
function numeroComoTexto(valor: string) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  // Telefones grandes vêm como 5.511999999999E+12: volta para dígitos.
  return Number.isInteger(n) ? n.toFixed(0) : String(n);
}

/** Lê a primeira aba de um .xlsx (Office Open XML) sem biblioteca externa: sharedStrings + sheet XML. */
export async function lerXlsx(buffer: Buffer): Promise<Planilha> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new AppError(422, "PLANILHA_INVALIDA", "Não consegui abrir o arquivo como Excel (.xlsx). Salve como .xlsx ou .csv e tente de novo.");
  }
  const workbook = await zip.file("xl/workbook.xml")?.async("string");
  const relacoes = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  let caminho = "xl/worksheets/sheet1.xml";
  const primeiraAba = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (primeiraAba && relacoes) {
    const alvo = new RegExp(`<Relationship\\b[^>]*Id="${primeiraAba}"[^>]*Target="([^"]+)"`).exec(relacoes)?.[1]
      ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${primeiraAba}"`).exec(relacoes)?.[1];
    if (alvo) caminho = alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`;
  }
  const folha = await zip.file(caminho)?.async("string");
  if (!folha) throw new AppError(422, "PLANILHA_INVALIDA", "A planilha não tem nenhuma aba com dados.");
  const compartilhadas = await zip.file("xl/sharedStrings.xml")?.async("string");
  const textos = compartilhadas ? [...compartilhadas.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((item) => textoDosT(item[1])) : [];

  const linhas: string[][] = [];
  for (const linha of folha.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const valores: string[] = [];
    for (const celula of linha[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celula[1];
      const conteudo = celula[2] ?? "";
      const referencia = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(conteudo)?.[1];
      let texto = "";
      if (tipo === "s") texto = textos[Number(v)] ?? "";
      else if (tipo === "inlineStr") texto = textoDosT(conteudo);
      else if (tipo === "str" || tipo === "b") texto = decodificar(v ?? "");
      else if (v !== undefined) texto = numeroComoTexto(decodificar(v));
      const indice = referencia ? indiceDaColuna(referencia) : valores.length;
      while (valores.length < indice) valores.push("");
      valores[indice] = texto.trim();
    }
    linhas.push(valores);
    if (linhas.length > LIMITE_LINHAS + 1) break;
  }
  return montar(linhas);
}

/** CSV com ; ou , (o que aparecer mais na primeira linha), aspas duplas e quebras dentro de aspas. */
export function lerCsv(texto: string): Planilha {
  const conteudo = texto.replace(/^﻿/, "");
  const primeira = conteudo.split(/\r?\n/, 1)[0] ?? "";
  const separador = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];
    if (aspas) {
      if (c === "\"" && conteudo[i + 1] === "\"") { campo += "\""; i += 1; }
      else if (c === "\"") aspas = false;
      else campo += c;
    } else if (c === "\"") aspas = true;
    else if (c === separador) { linha.push(campo.trim()); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && conteudo[i + 1] === "\n") i += 1;
      linha.push(campo.trim()); linhas.push(linha); linha = []; campo = "";
      if (linhas.length > LIMITE_LINHAS + 1) break;
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo.trim()); linhas.push(linha); }
  return montar(linhas);
}

function montar(brutas: string[][]): Planilha {
  const linhas = brutas.filter((linha) => linha.some((valor) => valor !== ""));
  if (!linhas.length) throw new AppError(422, "PLANILHA_VAZIA", "A planilha está vazia.");
  const largura = Math.max(...linhas.map((linha) => linha.length));
  const cabecalho = linhas[0];
  const colunas = Array.from({ length: largura }, (_, i) => (cabecalho[i] ?? "").trim() || `Coluna ${i + 1}`);
  const corpo = linhas.slice(1, LIMITE_LINHAS + 1).map((linha) => Array.from({ length: largura }, (_, i) => linha[i] ?? ""));
  if (!corpo.length) throw new AppError(422, "PLANILHA_VAZIA", "A planilha só tem a linha de títulos.");
  return { colunas, linhas: corpo };
}

/** Escolhe o leitor pela assinatura do arquivo (ZIP = xlsx), não pela extensão. */
export async function lerPlanilha(nome: string, buffer: Buffer): Promise<Planilha> {
  if (buffer.length > 8 * 1024 * 1024) throw new AppError(413, "PLANILHA_GRANDE", "A planilha passa de 8 MB.");
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return lerXlsx(buffer);
  if (/\.xls$/i.test(nome) || (buffer[0] === 0xd0 && buffer[1] === 0xcf)) {
    throw new AppError(422, "PLANILHA_XLS", "Arquivo .xls antigo não é suportado. No Excel, use Salvar como → .xlsx ou .csv.");
  }
  const texto = buffer.toString("utf8");
  return lerCsv(texto.includes("�") ? buffer.toString("latin1") : texto);
}
