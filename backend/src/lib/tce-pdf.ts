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

/** Letra a partir da qual fica com menos linhas: uma linha com 7 pt ou mais; várias linhas com 6,5 pt ou mais. */
const LEGIVEL_UMA_LINHA = 7;
const LEGIVEL_VARIAS_LINHAS = 6.5;
const SUBLINHADO = 1.5;

export type Bloco = { tamanho: number; linhas: string[] };

/** Altura de um bloco de `n` linhas: do topo das maiúsculas da primeira linha ao sublinhado da última. */
export function alturaDoBloco(tamanho: number, n: number, entrelinha: number) {
  return (n - 1) * tamanho * entrelinha + tamanho * 0.72 + SUBLINHADO;
}

/**
 * Como escrever o texto de um campo de uma linha sem cortar. Para 1, 2, … `maxLinhas` linhas, acha a maior letra
 * (até `maximo`) em que o texto cabe na largura e o bloco cabe na `altura`; fica com o menor número de linhas que
 * ainda deixa a letra legível (7 pt numa linha, 6,5 pt em várias) e, se nenhum deixar, com a maior letra.
 * Só se nem com a letra mínima couber, a última linha é cortada com "...".
 */
export function blocoQueCabe(font: PDFFont, texto: string, maximo: number, largura: number, altura: number, maxLinhas: number, entrelinha = 1.15, minimo = TAMANHO_MINIMO): Bloco {
  const linha = texto.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  try {
    const opcoes: Bloco[] = [];
    for (let n = 1; n <= maxLinhas; n += 1) {
      for (let tamanho = maximo; tamanho >= minimo; tamanho -= 0.25) {
        const linhas = n === 1 ? [linha] : quebrarLinhas(font, linha, tamanho, largura);
        const cabe = n === 1
          ? font.widthOfTextAtSize(linha, tamanho) <= largura
          : linhas.length <= n && alturaDoBloco(tamanho, linhas.length, entrelinha) <= altura;
        if (cabe) {
          opcoes.push({ tamanho, linhas });
          break;
        }
      }
    }
    const legivel = opcoes.find((opcao) => opcao.tamanho >= (opcao.linhas.length === 1 ? LEGIVEL_UMA_LINHA : LEGIVEL_VARIAS_LINHAS));
    if (legivel) return legivel;
    if (opcoes.length) return opcoes.reduce((melhor, opcao) => (opcao.tamanho > melhor.tamanho ? opcao : melhor));
    // Nem assim: cabe o máximo de linhas na altura, com a letra mínima, e a última termina em "...".
    let n = maxLinhas;
    while (n > 1 && alturaDoBloco(minimo, n, entrelinha) > altura) n--;
    const linhas = quebrarLinhas(font, linha, minimo, largura);
    if (linhas.length <= n) return { tamanho: minimo, linhas };
    const visiveis = linhas.slice(0, n);
    let ultima = visiveis[n - 1];
    while (ultima.length > 1 && font.widthOfTextAtSize(`${ultima}...`, minimo) > largura) ultima = ultima.slice(0, -1).trimEnd();
    visiveis[n - 1] = `${ultima}...`;
    return { tamanho: minimo, linhas: visiveis };
  } catch {
    // Letra que a fonte não mede: uma linha no tamanho padrão, como antes.
    return { tamanho: maximo, linhas: [linha] };
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

/** Campos que nunca quebram linha (têm lugar e tamanho próprios). */
const SEMPRE_UMA_LINHA = new Set(["emissao_cidade_data", "data_termo_aditivo", "seguro_apolice"]);

type Espaco = { altura: number; maxLinhas: number; anexo1: boolean; entrelinha: number };

/**
 * Quanto espaço o campo tem para quebrar o texto em mais linhas.
 * - Anexo I (página 7): as linhas ficam a 19 pt uma da outra e o texto ocupa uns 6 pt, então há espaço livre acima e
 *   abaixo: até 3 linhas, centradas na altura do rótulo, cada uma com a sua linha embaixo.
 * - Página 1: o rótulo do campo de baixo fica colado na caixa, então só cabe o que couber dentro da caixa: até 2 linhas.
 */
function espacoDoCampo(nome: string, alturaDaCaixa: number): Espaco {
  if (SEMPRE_UMA_LINHA.has(nome)) return { altura: 0, maxLinhas: 1, anexo1: false, entrelinha: 1.15 };
  if (CAMPOS_ANEXO_1.has(nome)) return { altura: ANEXO1.acima + ANEXO1.abaixo, maxLinhas: 3, anexo1: true, entrelinha: ANEXO1.entrelinha };
  return { altura: alturaDaCaixa + 1, maxLinhas: 2, anexo1: false, entrelinha: 1.15 };
}

/**
 * Anexo I: até onde o bloco pode subir e descer a partir da linha de base do rótulo. A linha de cima fica 17,5 pt acima
 * e o texto da linha de baixo começa uns 13 pt abaixo: sobra folga dos dois lados.
 */
const ANEXO1 = { acima: 13, abaixo: 9.5, centro: 3, entrelinha: 1.3 };

/** Texto que não coube numa linha, por campo, e onde desenhá-lo (calculado junto com `tamanhosDoTce`). */
let blocosDoTce: Record<string, Bloco> = {};

function desenharBloco(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: PDFFont,
  rect: { x: number; y: number; width: number; height: number },
  base: number,
  bloco: Bloco,
  anexo1: boolean,
) {
  const { tamanho, linhas } = bloco;
  const entrelinha = anexo1 ? ANEXO1.entrelinha : 1.15;
  const passo = tamanho * entrelinha;
  const altura = alturaDoBloco(tamanho, linhas.length, entrelinha);
  // Topo do bloco: centrado no rótulo (Anexo I) ou na caixa (página 1), sem passar dos limites.
  const [baixo, cima, centro] = anexo1
    ? [base - ANEXO1.abaixo, base + ANEXO1.acima, base + ANEXO1.centro]
    : [rect.y - 1.5, rect.y + rect.height - 0.5, rect.y + rect.height / 2];
  const topo = Math.min(cima, Math.max(baixo + altura, centro + altura / 2));
  linhas.forEach((linha, indice) => {
    const y = topo - tamanho * 0.72 - indice * passo;
    page.drawText(linha, { x: rect.x + 2, y, size: tamanho, font, color: rgb(0, 0, 0) });
    if (anexo1 || indice === linhas.length - 1) {
      page.drawLine({ start: { x: rect.x, y: y - SUBLINHADO }, end: { x: rect.x + rect.width, y: y - SUBLINHADO }, thickness: 0.7, color: rgb(0, 0, 0) });
    }
  });
}

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

// Cada linha da tabela tem 21,2 pt de altura; `y` é a linha de base de um texto de uma linha só, a 7,1 pt da borda de baixo.
const CELULA = { abaixo: 7.1, acima: 14.1 };

/**
 * Escreve na célula: numa linha, diminuindo a letra até 6,5 pt; se não couber, em até 4 linhas dentro da célula
 * (a letra desce até 4,5 pt). Só o que nem assim couber termina em "...".
 */
function escrever(page: ReturnType<PDFDocument["getPages"]>[number], font: Awaited<ReturnType<PDFDocument["embedFont"]>>, x: number, y: number, texto: string, tamanho = 8) {
  const valor = forPdf(texto).replace(/\s+/g, " ").trim();
  if (!valor) return;
  const umaLinha = tamanhoQueCabe(font, valor, tamanho, LARGURA_NOVO_VALOR, 6.5);
  if (font.widthOfTextAtSize(valor, umaLinha) <= LARGURA_NOVO_VALOR) {
    page.drawRectangle({ x: x - 1, y: y - 2, width: LARGURA_NOVO_VALOR, height: 11, color: rgb(1, 1, 1) });
    page.drawText(valor, { x, y, size: umaLinha, font, color: rgb(0, 0, 0) });
    return;
  }
  const entrelinha = 1.1;
  const altura = CELULA.abaixo + CELULA.acima - 1.5;
  const { tamanho: menor, linhas } = blocoQueCabe(font, valor, 7, LARGURA_NOVO_VALOR, altura, 4, entrelinha, 4.5);
  page.drawRectangle({ x: x - 1, y: y - CELULA.abaixo + 0.8, width: LARGURA_NOVO_VALOR, height: CELULA.abaixo + CELULA.acima - 1.6, color: rgb(1, 1, 1) });
  // Centrado na altura da célula.
  const meio = y + (CELULA.acima - CELULA.abaixo) / 2;
  const alturaTexto = (linhas.length - 1) * menor * entrelinha + menor * 0.72;
  const primeira = meio + alturaTexto / 2 - menor * 0.72;
  linhas.forEach((linha, indice) => {
    page.drawText(linha, { x, y: primeira - indice * menor * entrelinha, size: menor, font, color: rgb(0, 0, 0) });
  });
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
  blocosDoTce = {};
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
    const caixa = form.getTextField(key).acroField.getWidgets()[0]?.getRectangle();
    if (!caixa?.width) continue;
    const espaco = espacoDoCampo(key, caixa.height);
    if (espaco.maxLinhas === 1) {
      tamanhosDoTce[key] = tamanhoQueCabe(font, texto.trim(), tamanhoPadrao(key), caixa.width - 4);
      continue;
    }
    const bloco = blocoQueCabe(font, texto, tamanhoPadrao(key), caixa.width - 4, espaco.altura, espaco.maxLinhas, espaco.entrelinha);
    // Em várias linhas, o campo fica vazio (o texto é desenhado depois) e mantém o tamanho padrão para o alinhamento.
    if (bloco.linhas.length > 1) blocosDoTce[key] = bloco;
    else tamanhosDoTce[key] = bloco.tamanho;
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
      field.setText(blocosDoTce[key] ? "" : text);
    } catch {
      throw new AppError(400, "CAMPO_INVALIDO", `Não foi possível gravar o campo ${key}.`);
    }
  }
  const linhas: { page: ReturnType<PDFDocument["getPages"]>[number] | undefined; x: number; y: number; largura: number }[] = [];
  const quebrados: (() => void)[] = [];
  for (const field of form.getFields()) {
    if (field.constructor.name !== "PDFTextField") continue;
    const texto = form.getTextField(field.getName());
    texto.updateAppearances(font);
    if (texto.isMultiline()) continue;
    for (const widget of texto.acroField.getWidgets()) {
      const rect = widget.getRectangle();
      const ref = doc.context.getObjectRef(widget.dict);
      const page = doc.getPages().find((item) => item.node.Annots()?.asArray().some((anotacao) => anotacao === ref));
      const bloco = blocosDoTce[texto.getName()];
      if (bloco) {
        const base = rect.y + baseDoTexto(font, tamanhoDoCampo(texto.getName()), rect.height);
        const anexo1 = espacoDoCampo(texto.getName(), rect.height).anexo1;
        if (page) quebrados.push(() => desenharBloco(page, font, rect, base, bloco, anexo1));
        continue;
      }
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
  for (const desenhar of quebrados) desenhar();
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
