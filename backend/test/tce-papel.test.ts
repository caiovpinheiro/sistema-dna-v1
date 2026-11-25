import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { fillTceTemplate, paraAssinaturaEmPapel, partesDoTce } from "../src/lib/tce-pdf.js";

const temPdftotext = (() => { try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

function textoDaPagina(pdf: Uint8Array, pagina: number) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tce-papel-")), "tce.pdf");
  fs.writeFileSync(arquivo, pdf);
  return execFileSync("pdftotext", ["-layout", "-f", String(pagina), "-l", String(pagina), arquivo, "-"], { encoding: "utf8" });
}

const campos = {
  nome: "Maria Souza Lima", cpf: "12345678909", nome_responsavel: "José Lima", cpf_responsavel: "98765432100",
  nome_escola: "Escola Estadual Paulista", escola_cnpj_inep: "35012345", emissao_cidade_data: "São Paulo, 25 de novembro de 2026",
};
const concedente = { razao_social: "Mercado Bom Preço Ltda", cnpj: "11222333000181" };

test("partesDoTce: nome e documento de quem assina cada linha", () => {
  assert.deepEqual(partesDoTce(campos, concedente), {
    concedente: { nome: "Mercado Bom Preço Ltda", documento: "CNPJ 11.222.333/0001-81" },
    estagiario: { nome: "Maria Souza Lima", documento: "CPF 123.456.789-09" },
    escola: { nome: "Escola Estadual Paulista", documento: "CNPJ/INEP 35012345" },
    responsavel: { nome: "José Lima", documento: "CPF 987.654.321-00" },
  });
  assert.equal(partesDoTce({ ...campos, nome_responsavel: "", cpf_responsavel: "" }, concedente).responsavel, null);
});

test("versão em papel: mesmas páginas, nomes nas linhas e sem o rodapé da ZapSign", { skip: !temPdftotext && "sem pdftotext" }, async () => {
  const original = await fillTceTemplate({ nome: campos.nome, cpf: campos.cpf, nome_escola: campos.nome_escola, emissao_cidade_data: campos.emissao_cidade_data });
  const papel = await paraAssinaturaEmPapel(original, partesDoTce(campos, concedente));
  assert.equal((await PDFDocument.load(papel)).getPageCount(), (await PDFDocument.load(original)).getPageCount());

  const assinaturas = textoDaPagina(papel, 6);
  for (const trecho of ["Mercado Bom Preço Ltda", "CNPJ 11.222.333/0001-81", "Maria Souza Lima", "CPF 123.456.789-09", "Escola Estadual Paulista", "José Lima", "Data: ____/____/________"]) {
    assert.ok(assinaturas.includes(trecho), `falta "${trecho}" na página de assinaturas`);
  }
  // O rodapé "ZapSign ... assinado eletronicamente" vem desenhado no modelo (página 8): no papel ele fica coberto.
  assert.match(textoDaPagina(original, 8), /ZapSign/);
  assert.ok(escuroNoRodape(original, 8) > 0, "o modelo devia ter o rodapé da ZapSign");
  assert.equal(escuroNoRodape(papel, 8), 0);
});

/** Pixels escuros na faixa do rodapé da ZapSign (y de 818 a 830 pt), renderizada a 72 dpi em tons de cinza. */
function escuroNoRodape(pdf: Uint8Array, pagina: number) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "tce-papel-"));
  const arquivo = path.join(pasta, "tce.pdf");
  fs.writeFileSync(arquivo, pdf);
  execFileSync("pdftoppm", ["-f", String(pagina), "-l", String(pagina), "-r", "72", "-gray", "-x", "0", "-y", "818", "-W", "595", "-H", "12", arquivo, path.join(pasta, "faixa")]);
  const imagem = fs.readdirSync(pasta).find((nome) => nome.endsWith(".pgm"))!;
  const bytes = fs.readFileSync(path.join(pasta, imagem));
  // Cabeçalho PGM binário: "P5\n<largura> <altura>\n255\n".
  let fim = 0;
  for (let linhas = 0; linhas < 3; fim++) if (bytes[fim] === 0x0a) linhas++;
  let escuros = 0;
  for (let i = fim; i < bytes.length; i++) if (bytes[i] < 160) escuros++;
  return escuros;
}
