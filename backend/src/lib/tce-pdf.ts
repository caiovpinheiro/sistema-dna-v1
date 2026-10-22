import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
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

export async function fillTceTemplate(values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await readTemplate());
  const form = doc.getForm();
  const available = new Set(form.getFields().map((field) => field.getName()));
  const missing = Object.keys(values).filter((key) => !available.has(key));
  if (missing.length > 0) {
    throw new AppError(500, "MODELO_INCOMPATIVEL", `O modelo não possui os campos: ${missing.join(", ")}`);
  }
  for (const [key, raw] of Object.entries(values)) {
    const field = form.getTextField(key);
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  form.flatten();
  return doc.save();
}

export function storageDir(configured: string): string {
  return configured || path.join(process.cwd(), "data", "tces");
}
