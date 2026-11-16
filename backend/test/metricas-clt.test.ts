import assert from "node:assert/strict";
import test from "node:test";
import { metricasClt } from "../src/lib/metricas/clt.js";

const HOJE = Date.UTC(2026, 10, 16);

test("CLT: taxa única no mês da contratação, sem mensalidade e sem projeção", () => {
  const r = metricasClt([
    { status: 2, datainicio: "2026/09/10", data_contratacao: null, data_demicao: "2026/10/10", mensal: 0, rs: 800, salario: 2000 },
    { status: 1, datainicio: "2026/09/20", data_contratacao: null, data_demicao: null, mensal: 0, rs: "200", salario: "2500" },
    { status: 1, datainicio: "2026/11/02", data_contratacao: null, data_demicao: null, mensal: 0, rs: 0, salario: 1800 },
  ], HOJE);
  assert.equal(r.validos, 3);
  assert.equal(r.receita.contratacoesComValor, 2);
  assert.equal(r.receita.semValor, 1);
  assert.equal(r.receita.total, 1000);
  assert.equal(r.receita.porContratacao, 500);
  assert.equal(r.receita.salarioMedio, 2250);
  assert.equal(r.receita.percentualMedio, (1000 / 4500) * 100);
  assert.deepEqual(r.receitaMensal.map((m) => [m.mes, m.receita, m.contratacoes]), [["2026-09", 1000, 2], ["2026-10", 0, 0], ["2026-11", 0, 1]]);
});

test("CLT: média restrita sem o limite de 24 meses do estágio", () => {
  const r = metricasClt([
    { status: 2, datainicio: "2022/01/01", data_contratacao: null, data_demicao: "2025/01/01", rs: 100 },
  ], HOJE);
  assert.ok(r.geral.mediaRestritaDias > 24 * 30.44);
});

test("CLT: período filtra sempre pela data de início", () => {
  const r = metricasClt([
    { status: 1, datainicio: "2025/06/01", data_contratacao: null, data_demicao: null, rs: 100 },
    { status: 1, datainicio: "2026/06/01", data_contratacao: null, data_demicao: null, rs: 100 },
  ], HOJE, { de: Date.UTC(2026, 0, 1), ate: Date.UTC(2026, 11, 31), modo: "ativos" });
  assert.equal(r.validos, 1);
  assert.equal(r.receitaMensal[0].mes, "2026-01");
});

test("CLT: salário por hora não entra no salário médio nem no %", () => {
  const r = metricasClt([
    { status: 1, datainicio: "2026/01/10", data_contratacao: null, data_demicao: null, rs: 690, salario: 24 },
    { status: 1, datainicio: "2026/01/10", data_contratacao: null, data_demicao: null, rs: 1000, salario: 2000 },
  ], HOJE);
  assert.equal(r.receita.total, 1690);
  assert.equal(r.receita.salarioMedio, 2000);
  assert.equal(r.receita.percentualMedio, 50);
});

test("CLT: projeção = mesmo mês do último ano × variação do último ano", () => {
  // hoje = 16/11/2026; últimos 12 meses completos = nov/2025 a out/2026; anteriores = nov/2024 a out/2025
  const c = (data: string, rs: number) => ({ status: 1, datainicio: data, data_contratacao: null, data_demicao: null, rs });
  const contratos = [
    c("2024/12/05", 2000), c("2025/03/05", 2000), // anteriores: R$ 4.000, 2 contratações
    c("2025/12/05", 2000), c("2026/03/05", 1000), // últimos 12: R$ 3.000, 2 contratações
    c("2026/11/03", 500), // mês atual
  ];
  const r = metricasClt(contratos, HOJE, { de: Date.UTC(2020, 0, 1), ate: Date.UTC(2020, 11, 31) });
  const p = r.projecao;
  assert.equal(r.validos, 0); // o filtro não afeta a projeção
  assert.equal(p.base.fatorReceita, 0.75);
  assert.equal(p.base.fatorContratacoes, 1);
  assert.equal(p.serie[0].mes, "2026-12");
  assert.equal(p.serie[0].receita, 1500); // dez/25 R$ 2.000 × 0,75
  assert.equal(p.serie[0].base.mes, "2025-12");
  assert.equal(p.serie[3].mes, "2027-03");
  assert.equal(p.serie[3].receita, 750); // mar/26 R$ 1.000 × 0,75
  assert.equal(p.serie[1].receita, 0); // jan/26 sem contratação
  assert.equal(p.proximos12.receita, 2250);
  assert.equal(p.proximos12.contratacoes, 2);
  // nov/26: base nov/25 = 0, então nada falta; fechamento = realizado em 2026 (mar 1.000 + nov 500) + dez/26 projetado
  assert.equal(p.mesAtual.realizado, 500);
  assert.equal(p.mesAtual.esperado, 0);
  assert.equal(p.ano.realizado, 1500);
  assert.equal(p.ano.restoDoAno, 1500);
  assert.equal(p.ano.fechamento, 3000);
});
