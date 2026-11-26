import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { blocoQueCabe, fillTceTemplate, medidasDoPlano, tamanhoQueCabe } from "../src/lib/tce-pdf.js";

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

// Jornadas reais que saíam cortadas no Anexo I (a da tela e a maior gravada, com 235 letras).
const jornadaDaTela = "Segunda à Domingo das 14:00 às 19:00 com 15 minutos de pausa, e uma folga alternada na semana ou no final de semana a definir pela empresa.";
const jornadaMaior = "Segunda a sexta-feira, das 08h00 às 15h00, com 1 hora de intervalo para refeição e descanso. Folgas fixas aos finais de semana. Caso haja necessidade de trabalho em algum final de semana, o colaborador será comunicado com antecedência.";

test("texto longo quebra em mais linhas em vez de ser cortado", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  // Anexo I: até 3 linhas em 22,5 pt de altura; cabe numa linha, fica numa linha.
  assert.deepEqual(blocoQueCabe(font, "Segunda a sexta das 08:00 às 14:00", 8, 252, 22.5, 3, 1.3), { tamanho: 8, linhas: ["Segunda a sexta das 08:00 às 14:00"] });
  const tela = blocoQueCabe(font, jornadaDaTela, 8, 252, 22.5, 3, 1.3);
  assert.equal(tela.linhas.length, 2);
  assert.ok(tela.tamanho >= 6.5, `letra ${tela.tamanho}`);
  assert.equal(tela.linhas.join(" "), jornadaDaTela);
  const maior = blocoQueCabe(font, jornadaMaior, 8, 252, 22.5, 3, 1.3);
  assert.ok(maior.linhas.length <= 3);
  assert.equal(maior.linhas.join(" "), jornadaMaior, "nada pode ficar de fora");
  for (const linha of maior.linhas) assert.ok(font.widthOfTextAtSize(linha, maior.tamanho) <= 252);
  // Sem espaço nem com a letra mínima: corta a última linha com "...".
  const enorme = blocoQueCabe(font, jornadaMaior.repeat(3), 8, 252, 22.5, 3, 1.3);
  assert.equal(enorme.linhas.length, 3);
  assert.match(enorme.linhas[2], /\.\.\.$/);
});

test("Anexo I e aditivo mostram a jornada inteira", { skip: !temPdftotext && "sem pdftotext" }, async () => {
  const pdf = await fillTceTemplate({
    jornada: jornadaMaior,
    escola_endereco: "Rua Professor Sebastião Nascimento Bastos, 1550 - Jardim Santa Terezinha",
    endereco: "Rua Doutor Antônio Bento de Amorim Ferreira, 1234 - Apto 56 Bloco C - Jardim Paulista",
  });
  const juntar = (texto: string) => texto.replace(/\s+/g, " ");
  for (const pagina of [7, 9]) assert.ok(juntar(textoDaPagina(pdf, pagina)).includes("o colaborador será comunicado com antecedência."), `página ${pagina}`);
  const capa = juntar(textoDaPagina(pdf, 1));
  assert.match(capa, /Jardim Santa Terezinha/);
  assert.match(capa, /Bloco C - Jardim Paulista/);
});
