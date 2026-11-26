import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { fillTceTemplate, medidasDoPlano, tamanhoQueCabe } from "../src/lib/tce-pdf.js";

const temPdftotext = (() => { try { execFileSync("pdftotext", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

function textoDaPagina(pdf: Uint8Array, pagina: number) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tce-caber-")), "tce.pdf");
  fs.writeFileSync(arquivo, pdf);
  return execFileSync("pdftotext", ["-layout", "-f", String(pagina), "-l", String(pagina), arquivo, "-"], { encoding: "utf8" });
}

const atividade = "Auxiliar, sob supervisão, no atendimento aos clientes, prestando informações básicas e encaminhando demandas aos colaboradores responsáveis";

test("campo de uma linha: a letra diminui só o necessário para o texto caber", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  assert.equal(tamanhoQueCabe(font, "Sao Paulo", 8, 153), 8);
  const escola = "E.E. Prof. Francisco De Paula Conceicao Junior";
  const tamanho = tamanhoQueCabe(font, escola, 8, 153);
  assert.ok(tamanho < 8 && tamanho >= 5.5);
  assert.ok(font.widthOfTextAtSize(escola, tamanho) <= 153);
});

test("plano de atividades: o quadro cresce para caber o texto todo", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  assert.deepEqual(medidasDoPlano(font, "Atender clientes"), { tamanho: 9, altura: 56 });
  const longo = medidasDoPlano(font, Array.from({ length: 6 }, () => atividade).join("\n"));
  assert.equal(longo.tamanho, 9);
  assert.ok(longo.altura > 56, "o quadro devia crescer");
  const enorme = medidasDoPlano(font, Array.from({ length: 80 }, () => atividade).join("\n"));
  assert.ok(enorme.tamanho < 9, "sem espaço na página, a letra diminui");
  assert.ok(enorme.altura <= 636 - 90);
});

test("termo aditivo: carga sem 'horas' repetido e jornada longa em duas linhas", { skip: !temPdftotext && "sem pdftotext" }, async () => {
  const pdf = await fillTceTemplate({
    carga_horaria_semanal: "30 horas",
    jornada: "Segunda à Domingo das 07:00 às 12:00 com 15 minutos de intervalo, conforme escala da loja",
    plano_atividades: Array.from({ length: 6 }, () => atividade).join("\n"),
  });
  const aditivo = textoDaPagina(pdf, 9);
  assert.match(aditivo, /30 horas/);
  assert.doesNotMatch(aditivo, /horas horas/);
  assert.match(aditivo, /Segunda à Domingo das 07:00 às 12:00 com 15/);
  assert.match(aditivo, /conforme escala da loja/);
});

test("texto com quebra de linha ou caractere invisível num campo de uma linha não derruba o PDF", async () => {
  // Antes: "WinAnsi cannot encode" ao medir o texto → "Erro interno" ao salvar o TCE.
  const pdf = await fillTceTemplate({
    jornada: "Segunda a sexta das 08:00 às 14:00\r\nSábado das 08:00 às 12:00",
    nome: "Maria\u0085Souza",
    plano_atividades: "Atender\u0085clientes\nRepor mercadorias",
  });
  assert.ok(pdf.length > 0);
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  assert.equal(tamanhoQueCabe(font, "Segunda\nSábado", 8, 250), 8);
});
