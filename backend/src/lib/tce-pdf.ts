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
    if (code === 10 || code === 13 || (code >= 32 && code <= 255)) out += ch;
    else out += " ";
  }
  return out;
}

function tamanhoDoCampo(nome: string) {
  if (nome === "plano_atividades") return 9;
  return 8;
}

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
  widget?.dict.set(PDFName.of("Rect"), doc.context.obj([49, 580, 552, 636]));
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

function escrever(page: ReturnType<PDFDocument["getPages"]>[number], font: Awaited<ReturnType<PDFDocument["embedFont"]>>, x: number, y: number, texto: string, tamanho = 8) {
  const valor = forPdf(texto).trim();
  if (!valor) return;
  page.drawRectangle({ x: x - 1, y: y - 2, width: 146, height: 11, color: rgb(1, 1, 1) });
  page.drawText(valor, { x, y, size: tamanho, font, color: rgb(0, 0, 0) });
}

function cobrirTextoDoModelo(doc: PDFDocument) {
  const plano = doc.getPages()[7];
  const aditivo = doc.getPages()[8];
  if (plano) {
    plano.drawRectangle({ x: 30, y: 664, width: 250, height: 12, color: rgb(1, 1, 1) });
    plano.drawRectangle({ x: 49, y: 580, width: 503, height: 56, borderWidth: 0.6, borderColor: rgb(0, 0, 0) });
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
  escrever(page, font, novo, 519.317, semanal ? `${semanal} horas` : "");
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
