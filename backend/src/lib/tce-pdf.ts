import fs from "node:fs/promises";
import path from "node:path";
import type { PDFFont, PDFTextField } from "pdf-lib";
import { PDFDocument, PDFDict, PDFName, StandardFonts, rgb } from "pdf-lib";
import { AppError } from "./errors.js";

async function readTemplate(): Promise<Buffer> {
  const candidates = [
    path.resolve(process.cwd(), "templates", "tce.pdf"),
    path.resolve(process.cwd(), "..", "templates", "tce.pdf"),
  ];
  for (const file of candidates) {
    try {
      return await fs.readFile(file);
    } catch {
      continue;
    }
  }
  throw new AppError(500, "MODELO_AUSENTE", "O modelo templates/tce.pdf não foi encontrado.");
}

function forPdf(value: string) {
  const normalized = value
    .normalize("NFC")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
  let out = "";
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    // Fora disso a Helvetica do PDF não tem a letra (inclui os controles invisíveis U+007F a U+009F, comuns em texto colado).
    if (code === 10 || code === 13 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch;
    else out += " ";
  }
  return out;
}

function tamanhoPadrao(nome: string) {
  if (nome === "plano_atividades") return 9;
  return 8;
}

/**
 * Tamanho de letra de cada campo neste TCE: o padrão, ou menor quando o texto não cabe na linha. Calculado em fillTceTemplate
 * e usado até o fim do preenchimento sem nenhum `await` no meio, então dois TCEs gerados ao mesmo tempo não se misturam.
 */
let tamanhosDoTce: Record<string, number> = {};

function tamanhoDoCampo(nome: string) {
  return tamanhosDoTce[nome] ?? tamanhoPadrao(nome);
}

const TAMANHO_MINIMO = 5.5;

/** Maior tamanho (até `maximo`) em que o texto cabe numa linha de `largura`. */
export function tamanhoQueCabe(font: PDFFont, texto: string, maximo: number, largura: number, minimo = TAMANHO_MINIMO) {
  // Campo de uma linha: quebra de linha vira espaço, como o pdf-lib faz ao escrever.
  const linha = texto.replace(/[\r\n]+/g, " ");
  try {
    let tamanho = maximo;
    while (tamanho > minimo && font.widthOfTextAtSize(linha, tamanho) > largura) tamanho -= 0.25;
    return tamanho;
  } catch {
    // Letra que a fonte não mede: fica o tamanho padrão (antes desta função existir era sempre assim).
    return maximo;
  }
}

/** Quebra o texto em linhas de até `largura` (por palavra; palavra maior que a linha é quebrada por letra). */
function quebrarLinhas(font: PDFFont, texto: string, tamanho: number, largura: number) {
  const linhas: string[] = [];
  for (const paragrafo of texto.split(/\r?\n/)) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (font.widthOfTextAtSize(tentativa, tamanho) <= largura) {
        atual = tentativa;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = palavra;
      while (font.widthOfTextAtSize(atual, tamanho) > largura && atual.length > 1) {
        let corte = atual.length - 1;
        while (corte > 1 && font.widthOfTextAtSize(atual.slice(0, corte), tamanho) > largura) corte--;
        linhas.push(atual.slice(0, corte));
        atual = atual.slice(corte);
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

// Quadro do plano de atividades (Anexo II, página 8): começa no mesmo topo do modelo e cresce para baixo até caber o texto,
// no máximo até perto do rodapé. Só se nem assim couber, a letra diminui.
const PLANO = { x: 49, topo: 636, largura: 503, alturaMinima: 56, fundoMinimo: 90 };

export function medidasDoPlano(font: PDFFont, texto: string) {
  const larguraUtil = PLANO.largura - 6;
  const alturaMaxima = PLANO.topo - PLANO.fundoMinimo;
  let tamanho = tamanhoPadrao("plano_atividades");
  for (;;) {
    const linhas = quebrarLinhas(font, texto, tamanho, larguraUtil).length;
    // pdf-lib usa a altura da fonte como entrelinha; folga de uma linha e meia para as diferenças de quebra.
    const altura = Math.max(PLANO.alturaMinima, Math.ceil((linhas + 1.5) * font.heightAtSize(tamanho) + 6));
    if (altura <= alturaMaxima || tamanho <= TAMANHO_MINIMO) return { tamanho, altura: Math.min(altura, alturaMaxima) };
    tamanho -= 0.25;
  }
}

let alturaDoPlano = PLANO.alturaMinima;

const CAMPOS_ANEXO_1 = new Set([
  "estagio_inicio",
  "estagio_termino",
  "carga_horaria_diaria",
  "carga_horaria_semanal",
  "jornada",
  "supervisor",
  "bolsa",
  "beneficios",
  "seguro_apolice",
]);

function ajustarQuadroDoPlano(field: PDFTextField, doc: PDFDocument) {
  const widget = field.acroField.getWidgets()[0];
  widget?.dict.set(PDFName.of("Rect"), doc.context.obj([PLANO.x, PLANO.topo - alturaDoPlano, PLANO.x + PLANO.largura, PLANO.topo]));
}

function baseDoTexto(font: PDFFont, tamanho: number, altura: number) {
  const padding = 1;
  const miolo = altura - padding * 2;
  const alturaFonte = font.heightAtSize(tamanho, { descender: false });
  return padding + (miolo / 2 - alturaFonte / 2);
}

function semMoldura(field: PDFTextField) {
  for (const widget of field.acroField.getWidgets()) {
    const mk = widget.dict.lookup(PDFName.of("MK"));
    if (mk instanceof PDFDict) {
      mk.delete(PDFName.of("BG"));
      mk.delete(PDFName.of("BC"));
    }
    widget.getBorderStyle()?.setWidth(0);
    widget.dict.set(PDFName.of("Border"), widget.dict.context.obj([0, 0, 0]));
  }
}

function alinharAnexo1(field: PDFTextField, doc: PDFDocument, font: PDFFont) {
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return;
  const rect = widget.getRectangle();
  const base = baseDoTexto(font, tamanhoDoCampo(field.getName()), rect.height);
  const y = rect.y + (4.99 - base);
  widget.dict.set(PDFName.of("Rect"), doc.context.obj([rect.x, y, rect.x + rect.width, y + rect.height]));
}

function alinharDataAditivo(field: PDFTextField, doc: PDFDocument, font: PDFFont) {
  const widget = field.acroField.getWidgets()[0];
  if (!widget) return;
  const rect = widget.getRectangle();
  const altura = 12;
  const base = baseDoTexto(font, 8, altura);
  const y = 361.2 - base;
  widget.dict.set(PDFName.of("Rect"), doc.context.obj([rect.x, y, rect.x + rect.width, y + altura]));
}

// Coluna "Novo valor" da tabela do Termo Aditivo (Anexo III): texto até a borda direita da tabela.
const LARGURA_NOVO_VALOR = 146;

/** Escreve na célula: diminui a letra para caber numa linha; se ficar pequena demais, quebra em duas linhas. */
function escrever(page: ReturnType<PDFDocument["getPages"]>[number], font: Awaited<ReturnType<PDFDocument["embedFont"]>>, x: number, y: number, texto: string, tamanho = 8) {
  const valor = forPdf(texto).replace(/\s+/g, " ").trim();
  if (!valor) return;
  const umaLinha = tamanhoQueCabe(font, valor, tamanho, LARGURA_NOVO_VALOR, 6.5);
  if (font.widthOfTextAtSize(valor, umaLinha) <= LARGURA_NOVO_VALOR) {
    page.drawRectangle({ x: x - 1, y: y - 2, width: LARGURA_NOVO_VALOR, height: 11, color: rgb(1, 1, 1) });
    page.drawText(valor, { x, y, size: umaLinha, font, color: rgb(0, 0, 0) });
    return;
  }
  let menor = 7;
  let linhas = quebrarLinhas(font, valor, menor, LARGURA_NOVO_VALOR);
  while (linhas.length > 2 && menor > 5) {
    menor -= 0.25;
    linhas = quebrarLinhas(font, valor, menor, LARGURA_NOVO_VALOR);
  }
  page.drawRectangle({ x: x - 1, y: y - 6, width: LARGURA_NOVO_VALOR, height: 19, color: rgb(1, 1, 1) });
  const [primeira = "", ...resto] = linhas;
  page.drawText(primeira, { x, y: y + 4, size: menor, font, color: rgb(0, 0, 0) });
  page.drawText(resto.join(" "), { x, y: y - 4, size: menor, font, color: rgb(0, 0, 0) });
}

function cobrirTextoDoModelo(doc: PDFDocument) {
  const plano = doc.getPages()[7];
  const aditivo = doc.getPages()[8];
  if (plano) {
    plano.drawRectangle({ x: 30, y: 664, width: 250, height: 12, color: rgb(1, 1, 1) });
    plano.drawRectangle({ x: PLANO.x, y: PLANO.topo - alturaDoPlano, width: PLANO.largura, height: alturaDoPlano, borderWidth: 0.6, borderColor: rgb(0, 0, 0) });
  }
  if (aditivo) {
    aditivo.drawRectangle({ x: 32, y: 353, width: 148, height: 16, color: rgb(1, 1, 1) });
  }
}

function completarAnexo3(doc: PDFDocument, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, values: Record<string, string>) {
  const page = doc.getPages()[8];
  if (!page) return;
  const novo = 409.24;
  escrever(page, font, novo, 561.711, values.estagio_inicio ?? "");
  escrever(page, font, novo, 540.514, values.estagio_termino ?? "");
  const semanal = (values.carga_horaria_semanal ?? "").trim();
  // A carga já costuma vir como "30 horas": só acrescenta "horas" quando veio só o número.
  escrever(page, font, novo, 519.317, /^\d+([.,]\d+)?$/.test(semanal) ? `${semanal} horas` : semanal);
  escrever(page, font, novo, 498.12, values.jornada ?? "");
  escrever(page, font, novo, 476.923, values.bolsa ?? "");
  escrever(page, font, novo, 455.726, values.supervisor ?? "");
  escrever(page, font, novo, 434.529, values.beneficios ?? "");
  page.drawText("Local e data do termo aditivo:", { x: 33.75, y: 361.2, size: 8, font, color: rgb(0, 0, 0) });
  const vigencia = (values.data_termo_aditivo ?? "").trim();
  if (vigencia) {
    const prefixo = "original, produzindo efeitos a partir de ";
    const x = 33.75 + font.widthOfTextAtSize(prefixo, 7.5);
    const data = forPdf(vigencia);
    const largura = Math.max(font.widthOfTextAtSize("[data]", 7.5), font.widthOfTextAtSize(data, 7.5)) + 2;
    page.drawRectangle({ x, y: 394.6, width: largura, height: 9, color: rgb(1, 1, 1) });
    page.drawText(data, { x, y: 397.386, size: 7.5, font, color: rgb(0, 0, 0) });
  }
}

export async function fillTceTemplate(values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await readTemplate());
  const form = doc.getForm();
  const available = new Set(form.getFields().map((field) => field.getName()));
  const missing = Object.keys(values).filter((key) => !available.has(key));
  if (missing.length > 0) {
    throw new AppError(500, "MODELO_INCOMPATIVEL", `O modelo não possui os campos: ${missing.join(", ")}`);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Antes de alinhar e escrever: o tamanho de letra que faz cada texto caber no seu campo.
  tamanhosDoTce = {};
  alturaDoPlano = PLANO.alturaMinima;
  for (const [key, raw] of Object.entries(values)) {
    const texto = forPdf(raw ?? "");
    if (key === "plano_atividades") {
      try {
        const plano = medidasDoPlano(font, texto);
        tamanhosDoTce[key] = plano.tamanho;
        alturaDoPlano = plano.altura;
      } catch {
        // Sem conseguir medir, fica o quadro e a letra do modelo, como antes.
      }
      continue;
    }
    const largura = form.getTextField(key).acroField.getWidgets()[0]?.getRectangle().width;
    if (largura) tamanhosDoTce[key] = tamanhoQueCabe(font, texto.trim(), tamanhoPadrao(key), largura - 4);
  }
  for (const field of form.getFields()) {
    if (field.constructor.name !== "PDFTextField") continue;
    const texto = form.getTextField(field.getName());
    if (texto.isMultiline()) {
      if (texto.getName() === "plano_atividades") ajustarQuadroDoPlano(texto, doc);
    } else if (CAMPOS_ANEXO_1.has(texto.getName())) {
      alinharAnexo1(texto, doc, font);
    } else if (texto.getName() === "data_termo_aditivo") {
      alinharDataAditivo(texto, doc, font);
    }
    semMoldura(texto);
  }
  for (const [key, raw] of Object.entries(values)) {
    const field = form.getTextField(key);
    field.acroField.setDefaultAppearance(`0 0 0 rg /Helv ${tamanhoDoCampo(key)} Tf`);
    const text = forPdf(raw ?? "");
    const max = field.getMaxLength();
    if (max && text.length > max) {
      throw new AppError(400, "CAMPO_LONGO", `O campo ${key} excede o limite de ${max} caracteres do modelo.`);
    }
    try {
      field.setText(text);
    } catch {
      throw new AppError(400, "CAMPO_INVALIDO", `Não foi possível gravar o campo ${key}.`);
    }
  }
  const linhas: { page: ReturnType<PDFDocument["getPages"]>[number] | undefined; x: number; y: number; largura: number }[] = [];
  for (const field of form.getFields()) {
    if (field.constructor.name !== "PDFTextField") continue;
    const texto = form.getTextField(field.getName());
    texto.updateAppearances(font);
    if (texto.isMultiline()) continue;
    for (const widget of texto.acroField.getWidgets()) {
      const rect = widget.getRectangle();
      const ref = doc.context.getObjectRef(widget.dict);
      const page = doc.getPages().find((item) => item.node.Annots()?.asArray().some((anotacao) => anotacao === ref));
      linhas.push({
        page,
        x: rect.x,
        y: rect.y + baseDoTexto(font, tamanhoDoCampo(texto.getName()), rect.height) - 1.5,
        largura: rect.width,
      });
    }
  }
  form.flatten({ updateFieldAppearances: false });
  for (const linha of linhas) {
    linha.page?.drawLine({
      start: { x: linha.x, y: linha.y },
      end: { x: linha.x + linha.largura, y: linha.y },
      thickness: 0.7,
      color: rgb(0, 0, 0),
    });
  }
  cobrirTextoDoModelo(doc);
  completarAnexo3(doc, font, values);
  return doc.save();
}

export function storageDir(configured: string): string {
  return configured || path.join(process.cwd(), "data", "tces");
}

// ---------------------------------------------------------------------------
// Versão para assinatura em papel (a caneta): o mesmo PDF gerado do TCE, com o nome e o documento
// de cada parte embaixo da sua linha de assinatura, um campo de data e sem o rodapé da ZapSign.
// Não grava nada: é montada na hora a partir do PDF guardado.

export type ParteQueAssina = { nome: string; documento: string };
export type PartesDoTce = {
  concedente: ParteQueAssina;
  estagiario: ParteQueAssina;
  escola: ParteQueAssina;
  responsavel: ParteQueAssina | null;
};

function soDigitos(valor: string | undefined | null) {
  return String(valor ?? "").replace(/\D/g, "");
}

function documentoDe(valor: string | undefined | null, rotulo: "CPF" | "CNPJ" | "CNPJ/INEP") {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return "";
  const d = soDigitos(bruto);
  if (rotulo === "CPF" && d.length === 11) return `CPF ${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (rotulo !== "CPF" && d.length === 14) return `${rotulo} ${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return `${rotulo} ${bruto}`;
}

/** Quem assina cada linha da página de assinaturas, a partir dos campos salvos do TCE (public.tces.payload). */
export function partesDoTce(
  campos: Partial<Record<string, string>>,
  concedente: { razao_social?: string; cnpj?: string },
): PartesDoTce {
  const responsavel = String(campos.nome_responsavel ?? "").trim();
  return {
    concedente: { nome: String(concedente.razao_social ?? "").trim(), documento: documentoDe(concedente.cnpj, "CNPJ") },
    estagiario: { nome: String(campos.nome ?? "").trim(), documento: documentoDe(campos.cpf, "CPF") },
    escola: { nome: String(campos.nome_escola ?? "").trim(), documento: documentoDe(campos.escola_cnpj_inep, "CNPJ/INEP") },
    responsavel: responsavel ? { nome: responsavel, documento: documentoDe(campos.cpf_responsavel, "CPF") } : null,
  };
}

// Posições no templates/tce.pdf (pontos, origem no canto de baixo). Página 6 = assinaturas, página 8 = Anexo II.
const PAGINA_ASSINATURAS = 5;
const PAGINA_RODAPE_ZAPSIGN = 7;
const LARGURA_COLUNA = 210;
const COLUNAS = { esquerda: 160.75, direita: 406.7 };
const BASE_LINHA_1 = 534;
const BASE_LINHA_2 = 472;

function caber(font: PDFFont, texto: string, tamanhoMax: number, largura: number) {
  const completo = forPdf(texto).trim();
  let tamanho = tamanhoMax;
  while (tamanho > 6 && font.widthOfTextAtSize(completo, tamanho) > largura) tamanho -= 0.5;
  if (font.widthOfTextAtSize(completo, tamanho) <= largura) return { valor: completo, tamanho };
  // Nem com a fonte menor coube: corta e marca com reticências.
  let corte = completo.length;
  while (corte > 1 && font.widthOfTextAtSize(`${completo.slice(0, corte).trimEnd()}...`, tamanho) > largura) corte--;
  return { valor: `${completo.slice(0, corte).trimEnd()}...`, tamanho };
}

function centralizar(page: ReturnType<PDFDocument["getPages"]>[number], font: PDFFont, centro: number, y: number, texto: string, tamanho: number, cor = rgb(0, 0, 0)) {
  const { valor, tamanho: final } = caber(font, texto, tamanho, LARGURA_COLUNA);
  if (!valor) return;
  page.drawText(valor, { x: centro - font.widthOfTextAtSize(valor, final) / 2, y, size: final, font, color: cor });
}

function blocoDaParte(page: ReturnType<PDFDocument["getPages"]>[number], fontes: { normal: PDFFont; negrito: PDFFont }, centro: number, base: number, parte: ParteQueAssina | null) {
  const cinza = rgb(0.25, 0.25, 0.25);
  if (parte?.nome) centralizar(page, fontes.negrito, centro, base, parte.nome, 8);
  if (parte?.documento) centralizar(page, fontes.normal, centro, base - 9.5, parte.documento, 7.5, cinza);
  centralizar(page, fontes.normal, centro, base - 19, "Data: ____/____/________", 7.5, cinza);
}

export async function paraAssinaturaEmPapel(pdf: Uint8Array, partes: PartesDoTce): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const paginas = doc.getPages();
  const assinaturas = paginas[PAGINA_ASSINATURAS];
  if (!assinaturas) throw new AppError(500, "MODELO_INCOMPATIVEL", "O PDF do TCE não tem a página de assinaturas.");
  const fontes = { normal: await doc.embedFont(StandardFonts.Helvetica), negrito: await doc.embedFont(StandardFonts.HelveticaBold) };
  blocoDaParte(assinaturas, fontes, COLUNAS.esquerda, BASE_LINHA_1, partes.concedente);
  blocoDaParte(assinaturas, fontes, COLUNAS.direita, BASE_LINHA_1, partes.estagiario);
  blocoDaParte(assinaturas, fontes, COLUNAS.esquerda, BASE_LINHA_2, partes.escola);
  if (partes.responsavel) blocoDaParte(assinaturas, fontes, COLUNAS.direita, BASE_LINHA_2, partes.responsavel);
  // O modelo traz desenhado no rodapé do Anexo II "ZapSign … Documento assinado eletronicamente": não vale no papel.
  paginas[PAGINA_RODAPE_ZAPSIGN]?.drawRectangle({ x: 0, y: 8, width: 595.28, height: 18, color: rgb(1, 1, 1) });
  doc.setTitle("TCE para assinatura em papel");
  return doc.save();
}
