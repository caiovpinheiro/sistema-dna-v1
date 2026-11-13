import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Pool } from "pg";
import { z } from "zod";
import { moneyToNumber } from "./money.js";
import { onlyDigits, semEntidades } from "./normalize.js";

/** Campos da carta, já conferidos pelo operador na ficha do candidato. */
export const aberturaContaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data."),
  nome: z.string().trim().min(3, "Informe o nome.").max(200),
  cpf: z.string().trim().max(20).default(""),
  endereco: z.string().trim().max(300).default(""),
  telefone: z.string().trim().max(40).default(""),
  bolsa: z.number({ invalid_type_error: "Informe o valor da bolsa auxílio." }).positive("Informe o valor da bolsa auxílio.").max(1_000_000),
  cnpj: z.string().trim().max(20).default(""),
  empresa: z.string().trim().min(2, "Informe a empresa.").max(200),
});

export type AberturaConta = z.infer<typeof aberturaContaSchema>;

const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0 a 999 por extenso ("oitocentos e cinquenta"). */
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (resto < 20) {
    if (resto) partes.push(UNIDADES[resto]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return partes.join(" e ");
}

/** Inteiro até 999.999.999 por extenso. */
function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const grupos: string[] = [];
  if (milhoes) grupos.push(milhoes === 1 ? "um milhão" : `${ate999(milhoes)} milhões`);
  if (milhares) grupos.push(milhares === 1 ? "mil" : `${ate999(milhares)} mil`);
  if (resto) grupos.push(ate999(resto));
  if (grupos.length === 1) return grupos[0];
  // "e" antes do último grupo quando ele é menor que 100 ou é centena redonda ("mil e cem", "mil e cinquenta").
  const ultimo = grupos.pop()!;
  const juntaComE = resto > 0 && (resto < 100 || resto % 100 === 0);
  return `${grupos.join(", ")}${juntaComE ? " e " : ", "}${ultimo}`;
}

/** 850 → "oitocentos e cinquenta reais"; 1100.5 → "mil e cem reais e cinquenta centavos". */
export function valorPorExtenso(valor: number): string {
  const totalCentavos = Math.round(valor * 100);
  const reais = Math.floor(totalCentavos / 100);
  const centavos = totalCentavos % 100;
  const partes: string[] = [];
  if (reais) {
    const deMilhao = reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${inteiroPorExtenso(reais)}${deMilhao} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero reais";
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-10-30" → "30 de outubro de 2026". */
export function dataDaCarta(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${ano}`;
}

export function moedaBr(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

function cpfFormatado(valor: string) {
  const d = onlyDigits(valor);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : valor.trim();
}

function cnpjFormatado(valor: string) {
  const d = onlyDigits(valor);
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : valor.trim();
}

function telefoneFormatado(valor: string) {
  const d = onlyDigits(valor);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return valor.trim();
}

const maiusculo = (valor: string) => valor.trim().toLocaleUpperCase("pt-BR");
const comInicial = (valor: string) => valor.charAt(0).toLocaleUpperCase("pt-BR") + valor.slice(1);

/** As linhas da carta, na ordem do modelo em papel (também usadas nos testes). */
export function linhasAberturaConta(dados: AberturaConta) {
  return {
    titulo: "Abertura de conta.",
    data: dataDaCarta(dados.data),
    referencia: "REF. SOLICITAÇÃO DE ABERTURA DE CONTA PARA CRÉDITO DE BOLSA AUXÍLIO",
    abertura: "Solicito a abertura da conta para o (a) funcionário (a) abaixo:",
    pessoa: [
      ["Nome", maiusculo(dados.nome)],
      ["CPF", cpfFormatado(dados.cpf) || "—"],
      ["Endereço", maiusculo(dados.endereco) || "—"],
      ["Telefone", telefoneFormatado(dados.telefone) || "—"],
      ["Bolsa Auxílio", `${moedaBr(dados.bolsa)} (${comInicial(valorPorExtenso(dados.bolsa))})`],
    ] as Array<[string, string]>,
    empresa: [
      ["CNPJ", cnpjFormatado(dados.cnpj) || "—"],
      ["Empresa", maiusculo(dados.empresa)],
    ] as Array<[string, string]>,
  };
}

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.2, 0.2, 0.2);

/** Quebra o texto em linhas que cabem na largura. */
function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (atual && fonte.widthOfTextAtSize(tentativa, tamanho) > largura) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = tentativa;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function paragrafo(page: PDFPage, texto: string, x: number, y: number, fonte: PDFFont, tamanho: number, largura: number, entre = 1.35) {
  let linhaY = y;
  for (const linha of quebrar(texto, fonte, tamanho, largura)) {
    page.drawText(linha, { x, y: linhaY, size: tamanho, font: fonte, color: INK });
    linhaY -= tamanho * entre;
  }
  return linhaY;
}

/** PDF A4 no mesmo leiaute da carta em papel, com linha de assinatura da empresa. */
export async function buildAberturaContaPdf(dados: AberturaConta): Promise<Uint8Array> {
  const linhas = linhasAberturaConta(dados);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Abertura de conta - ${dados.nome}`);
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const negrito = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const margem = 56;
  const largura = page.getWidth() - margem * 2;

  const tituloTamanho = 20;
  const tituloLargura = negrito.widthOfTextAtSize(linhas.titulo, tituloTamanho);
  page.drawText(linhas.titulo, { x: (page.getWidth() - tituloLargura) / 2, y: 770, size: tituloTamanho, font: negrito, color: INK });

  const tamanho = 12;
  let y = 640;
  y = paragrafo(page, linhas.data, margem, y, regular, tamanho, largura) - 14;
  y = paragrafo(page, linhas.referencia, margem, y, regular, tamanho, largura) - 14;
  y = paragrafo(page, linhas.abertura, margem, y, regular, tamanho, largura);
  for (const [rotulo, valor] of linhas.pessoa) y = paragrafo(page, `${rotulo}: ${valor}`, margem, y, regular, tamanho, largura);
  y -= 28;
  for (const [rotulo, valor] of linhas.empresa) y = paragrafo(page, `${rotulo}: ${valor}`, margem, y, regular, tamanho, largura);

  // Espaço do carimbo e da assinatura da empresa.
  const assinaturaY = Math.min(y - 150, 360);
  page.drawLine({ start: { x: margem + 60, y: assinaturaY }, end: { x: margem + 290, y: assinaturaY }, thickness: 0.8, color: LINE });
  page.drawText("ASS.", { x: margem + 60, y: assinaturaY - 16, size: 11, font: negrito, color: INK });
  return pdf.save();
}

type Prefill = {
  nome: string | null;
  cpf: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  celular: string | null;
  telefonefixo: string | null;
  salario: string | null;
  cnpj: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  contratacao_ativa: boolean | null;
};

export type AberturaContaSugestao = {
  nome: string;
  cpf: string;
  endereco: string;
  telefone: string;
  bolsa: number | null;
  cnpj: string;
  empresa: string;
  /** De onde vieram a bolsa e a empresa: a contratação ativa, a mais recente, ou nenhuma. */
  contratacao: "ativa" | "recente" | "nenhuma";
};

/** Dados da ficha e da contratação (a ativa; sem ela, a mais recente) para preencher a carta. Null se o candidato não existe. */
export async function sugestaoAberturaConta(db: Pool, idCandidato: string, statusAtivo: number): Promise<AberturaContaSugestao | null> {
  const { rows } = await db.query<Prefill>(
    `SELECT c.nome, c.cpf, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.estado, c.celular, c.telefonefixo,
            ct.salario, ct.cnpj, ct.razao_social, ct.nome_fantasia, ct.ativa AS contratacao_ativa
     FROM dna_work.candidato c
     LEFT JOIN LATERAL (
       SELECT v.salario, e.cnpj, e.razao_social, e.nome_fantasia, coalesce(cv.status = $2, false) AS ativa
       FROM dna_work.conratacaovaga cv
       LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
       LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
       WHERE cv.id_candidato = c.id_candidato
       ORDER BY (cv.status = $2) DESC, cv.id_contratacao DESC
       LIMIT 1
     ) ct ON true
     WHERE c.id_candidato = $1`,
    [idCandidato, statusAtivo],
  );
  const row = rows[0];
  if (!row) return null;
  const texto = (valor: string | null) => semEntidades((valor ?? "").trim());
  const rua = [texto(row.logradouro), texto(row.numero)].filter(Boolean).join(", ");
  const endereco = [rua, texto(row.complemento), texto(row.bairro), texto(row.cidade), texto(row.estado)].filter(Boolean).join(", ");
  const razao = texto(row.razao_social);
  const fantasia = texto(row.nome_fantasia);
  // Como no modelo: razão social e, entre parênteses, a unidade (nome fantasia), quando é diferente.
  const empresa = razao && fantasia && razao.toLowerCase() !== fantasia.toLowerCase() ? `${razao} (${fantasia})` : razao || fantasia;
  const temContratacao = row.contratacao_ativa != null;
  return {
    nome: texto(row.nome),
    cpf: texto(row.cpf),
    endereco,
    telefone: texto(row.celular) || texto(row.telefonefixo),
    bolsa: moneyToNumber(row.salario),
    cnpj: texto(row.cnpj),
    empresa,
    contratacao: !temContratacao ? "nenhuma" : row.contratacao_ativa ? "ativa" : "recente",
  };
}
