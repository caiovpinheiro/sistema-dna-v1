import JSZip from "jszip";
import sharp from "sharp";
import { AppError } from "../errors.js";

/** Tamanho máximo do arquivo já decodificado. */
export const TAMANHO_MAXIMO_CURRICULO = 5 * 1024 * 1024;
/** Texto mínimo para considerar que um DOCX tem conteúdo legível. */
const TEXTO_MINIMO = 20;
/** Imagens muito grandes só aumentam custo e latência; acima disso o arquivo é recusado. */
const PIXELS_MAXIMOS = 40_000_000;

export type TipoDetectado = "pdf" | "docx" | "doc" | "png" | "jpeg" | "webp" | "desconhecido";

/** Conteúdo pronto para a análise: PDF e imagem vão como arquivo; DOCX vira texto aqui mesmo. */
export type CurriculoPreparado =
  | { tipo: "pdf"; nome: string; base64: string }
  | { tipo: "imagem"; mime: "image/png" | "image/jpeg" | "image/webp"; base64: string }
  | { tipo: "texto"; texto: string };

const EXTENSOES: Record<string, TipoDetectado[]> = {
  pdf: ["pdf"],
  docx: ["docx"],
  doc: ["doc"],
  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  webp: ["webp"],
};

function comeca(buffer: Buffer, bytes: number[], offset = 0) {
  return bytes.every((byte, indice) => buffer[offset + indice] === byte);
}

/** Tipo real do arquivo pelos primeiros bytes, sem confiar na extensão nem no tipo informado pelo navegador. */
export function detectarTipo(buffer: Buffer): TipoDetectado {
  if (comeca(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (comeca(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (comeca(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (comeca(buffer, [0x52, 0x49, 0x46, 0x46]) && comeca(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (comeca(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "doc"; // OLE2 (Word 97-2003)
  if (comeca(buffer, [0x50, 0x4b, 0x03, 0x04])) return "docx"; // ZIP; confirmado depois pelo word/document.xml
  return "desconhecido";
}

function extensao(nome: string) {
  return nome.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

/** Base64 puro ou data URL. Recusa caracteres fora do alfabeto em vez de decodificar lixo. */
export function decodificarBase64(valor: string): Buffer {
  const puro = valor.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (!puro || !/^[A-Za-z0-9+/]+={0,2}$/.test(puro)) {
    throw new AppError(422, "ARQUIVO_INVALIDO", "O arquivo enviado não está em base64 válido.");
  }
  return Buffer.from(puro, "base64");
}

const ENTIDADES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };

/** Texto do corpo de um DOCX: parágrafos, quebras e tabulações do word/document.xml. */
export async function textoDoDocx(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new AppError(422, "ARQUIVO_INVALIDO", "O DOCX está corrompido ou não é um documento do Word.");
  }
  const documento = zip.file("word/document.xml");
  if (!documento) throw new AppError(422, "ARQUIVO_INVALIDO", "O arquivo não é um DOCX do Word.");
  const xml = await documento.async("string");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>|<w:cr\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (entidade) => ENTIDADES[entidade] ?? entidade)
    .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Valida o currículo por tipo real, tamanho e conteúdo e devolve o que a análise consome.
 * DOC (Word 97-2003) é recusado: sem conversor no servidor, o texto não seria lido com segurança.
 */
export async function prepararCurriculo(arquivo: { nome: string; base64: string }): Promise<CurriculoPreparado> {
  const buffer = decodificarBase64(arquivo.base64);
  if (!buffer.length) throw new AppError(422, "ARQUIVO_VAZIO", "O arquivo está vazio.");
  if (buffer.length > TAMANHO_MAXIMO_CURRICULO) {
    throw new AppError(413, "ARQUIVO_GRANDE", "O currículo passa de 5 MB. Envie um arquivo menor.");
  }
  const tipo = detectarTipo(buffer);
  const ext = extensao(arquivo.nome);
  if (tipo === "doc") {
    throw new AppError(415, "TIPO_NAO_SUPORTADO", "Arquivo .doc antigo não é suportado. Salve como PDF ou DOCX e envie de novo.");
  }
  if (tipo === "desconhecido") {
    throw new AppError(415, "TIPO_NAO_SUPORTADO", "Envie o currículo em PDF, DOCX, PNG, JPG ou WEBP.");
  }
  const esperados = EXTENSOES[ext];
  if (esperados && !esperados.includes(tipo)) {
    throw new AppError(415, "TIPO_DIVERGENTE", "O conteúdo do arquivo não corresponde à extensão informada.");
  }

  if (tipo === "pdf") {
    if (!buffer.includes("%%EOF")) throw new AppError(422, "ARQUIVO_INVALIDO", "O PDF está incompleto ou corrompido.");
    return { tipo: "pdf", nome: arquivo.nome.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "curriculo.pdf", base64: buffer.toString("base64") };
  }
  if (tipo === "docx") {
    const texto = await textoDoDocx(buffer);
    if (texto.length < TEXTO_MINIMO) throw new AppError(422, "SEM_TEXTO", "O DOCX não tem texto legível.");
    return { tipo: "texto", texto };
  }
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) throw new Error("sem dimensões");
    if (meta.width * meta.height > PIXELS_MAXIMOS) {
      throw new AppError(413, "IMAGEM_GRANDE", "A imagem tem resolução grande demais. Envie uma foto menor.");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "ARQUIVO_INVALIDO", "A imagem está corrompida ou não pode ser lida.");
  }
  const mime = tipo === "png" ? "image/png" : tipo === "webp" ? "image/webp" : "image/jpeg";
  return { tipo: "imagem", mime, base64: buffer.toString("base64") };
}
