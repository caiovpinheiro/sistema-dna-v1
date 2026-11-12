import assert from "node:assert/strict";
import test from "node:test";
import { dataLegado, kaplanMeier, observacoes, permanenciaEstagio, receitaMensal } from "../src/lib/metricas/permanencia.js";

const HOJE = Date.UTC(2026, 10, 12);

test("dataLegado aceita só AAAA/MM/DD válida", () => {
  assert.equal(dataLegado("2026/01/31"), Date.UTC(2026, 0, 31));
  assert.equal(dataLegado(""), null);
  assert.equal(dataLegado(null), null);
  assert.equal(dataLegado("31/01/2026"), undefined);
  assert.equal(dataLegado("2026/02/30"), undefined);
});

test("observacoes usa data_contratacao sem datainicio e descarta os inválidos", () => {
  const { observacoes: obs, descartes } = observacoes([
    { status: 2, datainicio: "", data_contratacao: "2026/01/01", data_demicao: "2026/01/31" },
    { status: 1, datainicio: "2026/11/02", data_contratacao: null, data_demicao: null },
    { status: 2, datainicio: "2026/03/10", data_contratacao: null, data_demicao: "2026/03/01" },
    { status: 2, datainicio: "2026/03/10", data_contratacao: null, data_demicao: null },
    { status: 2, datainicio: "10/03/2026", data_contratacao: null, data_demicao: "2026/04/01" },
  ], HOJE);
  assert.deepEqual(obs.map((o) => [o.dias, o.saiu]), [[30, true], [10, false]]);
  assert.deepEqual(descartes, { formato: 1, demissaoAntesDoInicio: 1, encerradoSemDemissao: 1, inicioFuturo: 0, outroStatus: 0 });
});

test("kaplanMeier sem censura vira a distribuição empírica", () => {
  const km = kaplanMeier([10, 20, 30, 40].map((dias) => ({ dias, saiu: true, ano: 2025 })));
  assert.equal(km.medianaDias, 20);
  // área: 1·10 + 0,75·10 + 0,5·10 + 0,25·10 = 25 = média simples
  assert.equal(km.mediaRestritaDias, 25);
});

test("ativos (censurados) aumentam a permanência em relação à média dos encerrados", () => {
  const km = kaplanMeier([
    { dias: 10, saiu: true, ano: 2025 },
    { dias: 20, saiu: false, ano: 2025 },
    { dias: 30, saiu: true, ano: 2025 },
  ]);
  // S(10) = 2/3; em 30 só resta 1 em risco → S(30) = 0
  assert.equal(km.medianaDias, 30);
  assert.ok(Math.abs(km.mediaRestritaDias - (10 + (2 / 3) * 20)) < 1e-9);
  assert.equal(km.ativos, 1);
});

test("permanenciaEstagio monta faixas e anos", () => {
  const r = permanenciaEstagio([
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/01/11" },
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/03/01" },
    { status: 1, datainicio: "2026/01/01", data_contratacao: null, data_demicao: null },
  ], HOJE);
  assert.equal(r.validos, 3);
  assert.deepEqual(r.encerrados.faixas.map((f) => f.total), [1, 1, 0, 0, 0]);
  assert.deepEqual(r.porAno.map((a) => [a.ano, a.contratos]), [[2025, 2], [2026, 1]]);
});

test("período filtra pela data de início e conta os de fora", () => {
  const r = permanenciaEstagio([
    { status: 2, datainicio: "2024/06/01", data_contratacao: null, data_demicao: "2024/07/01" },
    { status: 2, datainicio: "2025/06/01", data_contratacao: null, data_demicao: "2025/07/01" },
  ], HOJE, { de: Date.UTC(2025, 0, 1), ate: Date.UTC(2025, 11, 31) });
  assert.equal(r.validos, 1);
  assert.equal(r.foraDoPeriodo, 1);
});

test("receita = taxa mensal média × permanência média + R&S média, só com empresas que têm preço", () => {
  const r = permanenciaEstagio([
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/01/31", mensal: 100, rs: 50 },
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/01/31", mensal: "200", rs: 0 },
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/01/31", mensal: 0, rs: 0 },
  ], HOJE);
  assert.equal(r.receita.contratosComValor, 2);
  assert.equal(r.receita.semValor, 1);
  assert.equal(r.receita.mensalMedio, 150);
  assert.equal(r.receita.rsMedio, 25);
  // todos ficaram 30 dias → média restrita 30 dias
  assert.ok(Math.abs(r.receita.porEstagiario! - (150 * 30 / 30.44 + 25)) < 1e-9);
  assert.ok(Math.abs(r.receita.realizado - (100 * 30 / 30.44 + 50 + 200 * 30 / 30.44)) < 1e-9);
});

test("receitaMensal: passado proporcional aos dias, R&S no mês de início e projeção só dos ativos", () => {
  const hoje = Date.UTC(2026, 2, 15); // 15/03/2026
  const obs = [
    // saiu: 01/01 a 31/01 (30 dias), R$ 310/mês, R&S 100
    { dias: 30, saiu: true, ano: 2026, inicio: Date.UTC(2026, 0, 1), mensal: 310, rs: 100 },
    // ativo desde 01/02/2026
    { dias: (hoje - Date.UTC(2026, 1, 1)) / 86_400_000, saiu: false, ano: 2026, inicio: Date.UTC(2026, 1, 1), mensal: 280, rs: 0 },
  ];
  const curva = [{ dias: 0, permanecem: 1 }, { dias: 30, permanecem: 0.5 }];
  const meses = receitaMensal(obs, curva, hoje, 2);
  assert.deepEqual(meses.map((m) => m.mes), ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.ok(Math.abs(meses[0].realizado! - (310 * 30 / 31 + 100)) < 1e-9);
  assert.equal(meses[1].realizado, 280);
  // o ativo já passou dos 30 dias: depois do fim da curva a chance de continuar fica 1
  assert.equal(meses[2].projetado, 280);
  assert.equal(meses[3].estagiarios, 1);
});

test("modo ativos inclui quem começou antes e estava contratado no período", () => {
  const contratos = [
    { status: 1, datainicio: "2025/06/01", data_contratacao: null, data_demicao: null, mensal: 100 },
    { status: 2, datainicio: "2025/01/01", data_contratacao: null, data_demicao: "2025/03/01", mensal: 100 },
    { status: 2, datainicio: "2026/02/01", data_contratacao: null, data_demicao: "2026/04/01", mensal: 100 },
  ];
  const periodo = { de: Date.UTC(2026, 0, 1), ate: Date.UTC(2026, 11, 31) };
  assert.equal(permanenciaEstagio(contratos, HOJE, periodo).validos, 1);
  const ativos = permanenciaEstagio(contratos, HOJE, { ...periodo, modo: "ativos" as const });
  assert.equal(ativos.validos, 2);
  assert.equal(ativos.foraDoPeriodo, 1);
  // o gráfico começa no mês do período, não no início do contrato mais antigo
  assert.equal(ativos.receitaMensal[0].mes, "2026-01");
  assert.equal(ativos.receitaMensal[0].realizado, 100);
});

test("média restrita para em 24 meses mesmo com contrato registrado mais longo", () => {
  const km = kaplanMeier([
    { dias: 100, saiu: true, ano: 2025 },
    { dias: 1600, saiu: false, ano: 2022 },
  ] as never);
  // S = 1 até 100 dias, 0,5 depois; corta em 24 × 30,44 dias
  const limite = 24 * 30.44;
  assert.ok(Math.abs(km.mediaRestritaDias - (100 + 0.5 * (limite - 100))) < 1e-9);
  assert.equal(km.ateDias, limite);
});
