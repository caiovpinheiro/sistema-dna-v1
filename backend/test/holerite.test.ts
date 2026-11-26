import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { calcularHolerite, calcularRescisaoEstagio, diasTrabalhados, gerarHoleritesPdf, gerarRecibosRescisaoPdf, linhasDoHolerite } from "../src/lib/holerite.js";

const vazio = { faltas: 0, auxilio_transporte: 0, acrescimos: 0, descricao_acrescimos: "", descontos: 0, descricao_descontos: "" };

test("dias trabalhados no mês: mês cheio, entrada e saída no meio, fora do mês", () => {
  assert.equal(diasTrabalhados("2026-11", "2025-03-01", null), 30);
  assert.equal(diasTrabalhados("2026-11", "2026-11-16", null), 15);
  assert.equal(diasTrabalhados("2026-11", "2026-01-10", "2026-11-10"), 10);
  assert.equal(diasTrabalhados("2026-11", "2026-12-01", null), 0);
  assert.equal(diasTrabalhados("2026-11", "2025-01-01", "2026-10-31"), 0);
  assert.equal(diasTrabalhados("2026-02", "2025-01-01", null), 28);
});

test("bolsa cheia, proporcional, faltas e lançamentos", () => {
  const cheio = calcularHolerite({ competencia: "2026-11", bolsa_base: 1200, inicio: "2025-01-01", demissao: null, lancamento: vazio });
  assert.equal(cheio.bolsa_proporcional, 1200);
  assert.equal(cheio.liquido, 1200);
  const metade = calcularHolerite({ competencia: "2026-11", bolsa_base: 1200, inicio: "2026-11-16", demissao: null, lancamento: vazio });
  assert.equal(metade.dias_trabalhados, 15);
  assert.equal(metade.bolsa_proporcional, 600);
  const completo = calcularHolerite({
    competencia: "2026-11", bolsa_base: 1200, inicio: "2025-01-01", demissao: null,
    lancamento: { faltas: 2, auxilio_transporte: 220, acrescimos: 50, descricao_acrescimos: "Reembolso", descontos: 30, descricao_descontos: "Adiantamento" },
  });
  assert.equal(completo.valor_faltas, 80);
  assert.equal(completo.proventos, 1470);
  assert.equal(completo.total_descontos, 110);
  assert.equal(completo.liquido, 1360);
});

test("faltas não passam dos dias trabalhados", () => {
  const r = calcularHolerite({ competencia: "2026-11", bolsa_base: 900, inicio: "2026-11-29", demissao: null, lancamento: { ...vazio, faltas: 10 } });
  assert.equal(r.dias_trabalhados, 2);
  assert.equal(r.valor_faltas, 60);
  assert.equal(r.liquido, 0);
});

test("PDF sai com uma página por estagiário e só as linhas com valor", async () => {
  const calculo = calcularHolerite({ competencia: "2026-11", bolsa_base: 1200, inicio: "2025-01-01", demissao: null, lancamento: { ...vazio, faltas: 1 } });
  const dados = { competencia: "2026-11", empresa: { razao_social: "Freire & Pinho Ltda", cnpj: "12.345.678/0001-90" }, estagiario: { nome: "José Ação", cpf: "123.456.789-09", cargo: "Estagiário administrativo", inicio: "2025-01-01" }, lancamento: { ...vazio, faltas: 1 }, calculo };
  assert.deepEqual(linhasDoHolerite(dados).map((linha) => linha[0]), ["Bolsa-auxílio", "Faltas"]);
  const bytes = await gerarHoleritesPdf([dados, dados]);
  assert.ok(Buffer.from(bytes).toString("latin1").startsWith("%PDF"));
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

test("rescisão: exemplo do usuário", () => {
  const r = calcularRescisaoEstagio({ inicio: "2026-01-01", demissao: "2026-03-30", bolsa_base: 1300 });
  assert.deepEqual(r, { bolsa_base: 1300, meses_fechados: 2, dias_trabalhados: 30, meses: 3, valor_dias: 1300, valor_ferias: 325, total: 1625 });
});

test("rescisão: início no meio do mês", () => {
  const r = calcularRescisaoEstagio({ inicio: "2026-01-15", demissao: "2026-03-30", bolsa_base: 1200 });
  assert.equal(r?.meses_fechados, 2);
  assert.equal(r?.dias_trabalhados, 16);
  assert.equal(r?.meses, 3);
  assert.equal(r?.valor_dias, 640);
  assert.equal(r?.valor_ferias, 300);
  assert.equal(r?.total, 940);
});

test("rescisão: meses exatos, sem sobra", () => {
  const r = calcularRescisaoEstagio({ inicio: "2026-01-15", demissao: "2026-03-14", bolsa_base: 1200 });
  assert.equal(r?.meses_fechados, 2);
  assert.equal(r?.dias_trabalhados, 0);
  assert.equal(r?.meses, 2);
  assert.equal(r?.valor_dias, 0);
  assert.equal(r?.valor_ferias, 200);
});

test("rescisão: sobra máxima de um mês de 31 dias", () => {
  const r = calcularRescisaoEstagio({ inicio: "2026-03-01", demissao: "2026-05-30", bolsa_base: 1200 });
  assert.equal(r?.meses_fechados, 2);
  assert.equal(r?.dias_trabalhados, 30);
  assert.equal(r?.meses, 3);
  assert.equal(r?.valor_dias, 1200);
});

test("rescisão: início no dia 31 e fevereiro", () => {
  const r = calcularRescisaoEstagio({ inicio: "2026-01-31", demissao: "2026-03-10", bolsa_base: 1200 });
  assert.equal(r?.meses_fechados, 1);
  assert.equal(r?.meses, 2);
});

test("rescisão: sem cálculo quando as datas não servem e bolsa zero", () => {
  assert.equal(calcularRescisaoEstagio({ inicio: "2026-03-10", demissao: "2026-03-10", bolsa_base: 1000 }), null);
  assert.equal(calcularRescisaoEstagio({ inicio: "2026-03-10", demissao: "2026-03-01", bolsa_base: 1000 }), null);
  assert.equal(calcularRescisaoEstagio({ inicio: null, demissao: "2026-03-01", bolsa_base: 1000 }), null);
  assert.equal(calcularRescisaoEstagio({ inicio: "2026-03-01", demissao: null, bolsa_base: 1000 }), null);
  assert.equal(calcularRescisaoEstagio({ inicio: "2026-01-01", demissao: "2026-03-30", bolsa_base: 0 })?.total, 0);
});

test("recibo de rescisão em PDF: uma página por estagiário", async () => {
  const calculo = calcularRescisaoEstagio({ inicio: "2026-01-01", demissao: "2026-03-30", bolsa_base: 1300 });
  assert.ok(calculo);
  const base = { empresa: { razao_social: "Empresa Teste Ltda", cnpj: "12.345.678/0001-90" }, calculo };
  const bytes = await gerarRecibosRescisaoPdf([
    { ...base, estagiario: { nome: "Ana Souza", cpf: "123.456.789-09", cargo: "Estagiária de Administração", inicio: "2026-01-01", demissao: "2026-03-30" } },
    { ...base, estagiario: { nome: "Bruno Lima", cpf: "987.654.321-00", cargo: "Estagiário", inicio: "2026-01-01", demissao: "2026-03-30" } },
  ]);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
});
