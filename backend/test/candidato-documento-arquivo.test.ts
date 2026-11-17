import assert from "node:assert/strict";
import test from "node:test";
import { prepararArquivoDocumento } from "../src/repositories/candidato-documento.repository.js";

const b64 = (bytes: number[] | string) => Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");

test("aceita PDF, PNG, JPG e WEBP pelo conteúdo e grava o content-type certo", () => {
  assert.equal(prepararArquivoDocumento({ nome: "rg.pdf", base64: b64("%PDF-1.4 x") }).mime, "application/pdf");
  assert.equal(prepararArquivoDocumento({ nome: "rg.png", base64: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) }).mime, "image/png");
  // Extensão errada não importa: vale o conteúdo.
  assert.equal(prepararArquivoDocumento({ nome: "rg.pdf", base64: b64([0xff, 0xd8, 0xff, 0xe0]) }).mime, "image/jpeg");
  assert.equal(prepararArquivoDocumento({ nome: "rg.webp", base64: b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]) }).mime, "image/webp");
});

test("recusa outro tipo, arquivo vazio, grande demais ou base64 inválido", () => {
  assert.throws(() => prepararArquivoDocumento({ nome: "x.docx", base64: b64([0x50, 0x4b, 0x03, 0x04]) }), /PDF, PNG, JPG ou WEBP/);
  assert.throws(() => prepararArquivoDocumento({ nome: "x.html", base64: b64("<html><script>") }), /PDF, PNG, JPG ou WEBP/);
  assert.throws(() => prepararArquivoDocumento({ nome: "x.pdf", base64: "@@@" }), /base64/);
  const grande = Buffer.alloc(5 * 1024 * 1024 + 1);
  grande.write("%PDF-");
  assert.throws(() => prepararArquivoDocumento({ nome: "x.pdf", base64: grande.toString("base64") }), /5 MB/);
});

test("limpa o nome do arquivo", () => {
  assert.equal(prepararArquivoDocumento({ nome: "../pasta/rg  frente.pdf", base64: b64("%PDF-1") }).nome, ".._pasta_rg frente.pdf");
});
