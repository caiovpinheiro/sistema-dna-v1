/**
 * Métricas de contratações CLT. A DNA Work cobra **uma vez**, no mês da contratação (taxa fixa ou % do salário),
 * sem mensalidade. A permanência é calculada (Kaplan-Meier, sem o limite de 24 meses), mas a aba CLT não mostra métricas de tempo;
 * ela mostra receita e projeções (`projecaoClt`).
 * O contrato chega com a taxa em `rs` (ver metricas.service.ts) e `mensal` = 0.
 */
import { observacoes, resumoPermanencia, type ContratoBruto, type Observacao, type Periodo } from "./permanencia.js";

export type MesClt = { mes: string; receita: number; contratacoes: number };

const media = (valores: number[]) => (valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null);
const soma = (valores: number[]) => valores.reduce((a, b) => a + b, 0);

/** Abaixo disso o salário da vaga é por hora (há vagas com "24,00" e "25,00"); fica fora do salário médio e do %. */
export const SALARIO_MENSAL_MINIMO = 500;

/** Receita das contratações: só entram as de empresa com taxa CLT cadastrada (> 0). */
export function receitaClt(obs: Observacao[]) {
  const comValor = obs.filter((o) => o.rs > 0);
  const comSalario = comValor.filter((o) => (o.salario ?? 0) >= SALARIO_MENSAL_MINIMO);
  const somaSalarios = soma(comSalario.map((o) => o.salario!));
  return {
    contratacoesComValor: comValor.length,
    semValor: obs.length - comValor.length,
    total: soma(comValor.map((o) => o.rs)),
    porContratacao: media(comValor.map((o) => o.rs)),
    salarioMedio: media(comSalario.map((o) => o.salario!)),
    /** Taxa como % do salário: soma das taxas ÷ soma dos salários, só com salário mensal informado. */
    percentualMedio: somaSalarios ? (soma(comSalario.map((o) => o.rs)) / somaSalarios) * 100 : null,
  };
}

/** Receita e contratações por mês de início, do início do período (ou do primeiro mês com contratação) até o mês atual ou o fim do período. */
export function receitaMensalClt(obs: Observacao[], hoje: number, periodo: Periodo = {}): MesClt[] {
  if (!obs.length) return [];
  const inicioMes = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const proximoMes = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
  const primeiro = Math.min(...obs.map((o) => o.inicio));
  // Com período, mostra o período inteiro (meses sem contratação aparecem zerados).
  const desde = periodo.de != null ? inicioMes(periodo.de) : inicioMes(primeiro);
  const ultimo = Math.min(inicioMes(hoje), periodo.ate != null ? inicioMes(periodo.ate) : Number.POSITIVE_INFINITY);
  const meses: MesClt[] = [];
  for (let m = desde; m <= ultimo; m = proximoMes(m)) {
    const fim = proximoMes(m);
    const doMes = obs.filter((o) => o.inicio >= m && o.inicio < fim);
    meses.push({ mes: new Date(m).toISOString().slice(0, 7), receita: doMes.reduce((a, o) => a + o.rs, 0), contratacoes: doMes.length });
  }
  return meses;
}

/** Tudo o que a aba CLT mostra. O período sempre filtra pela data de início (a taxa é cobrada nesse mês). */
export function metricasClt(contratos: ContratoBruto[], hoje: number, periodo: Periodo = {}) {
  const p = { ...periodo, modo: "inicio" as const };
  const { obs, resumo } = resumoPermanencia(contratos, hoje, p, Number.POSITIVE_INFINITY);
  return {
    ...resumo,
    receita: receitaClt(obs),
    receitaMensal: receitaMensalClt(obs, hoje, p),
    // As projeções olham para a frente: usam sempre todas as contratações, não o período filtrado.
    projecao: projecaoClt(observacoes(contratos, hoje).observacoes, hoje),
  };
}

export type Ritmo = { meses: number; contratacoesPorMes: number; receitaPorMes: number };

const inicioDoMes = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const somarMeses = (ms: number, n: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };

/** Média por mês dos `meses` meses completos antes do mês atual. */
export function ritmo(obs: Observacao[], hoje: number, meses: number): Ritmo {
  const fim = inicioDoMes(hoje);
  const inicio = somarMeses(fim, -meses);
  const doPeriodo = obs.filter((o) => o.inicio >= inicio && o.inicio < fim);
  return { meses, contratacoesPorMes: doPeriodo.length / meses, receitaPorMes: soma(doPeriodo.map((o) => o.rs)) / meses };
}

type MesBase = { mes: string; receita: number; contratacoes: number };

/** Receita e contratações de cada um dos `meses` meses que terminam antes de `fim` (início de mês). */
function janela(obs: Observacao[], fim: number, meses: number): MesBase[] {
  return Array.from({ length: meses }, (_, i) => {
    const m = somarMeses(fim, i - meses);
    const proximo = somarMeses(m, 1);
    const doMes = obs.filter((o) => o.inicio >= m && o.inicio < proximo);
    return { mes: new Date(m).toISOString().slice(0, 7), receita: soma(doMes.map((o) => o.rs)), contratacoes: doMes.length };
  });
}

const total = (lista: MesBase[], campo: "receita" | "contratacoes") => soma(lista.map((m) => m[campo]));

/**
 * Projeções de CLT, mês a mês, pelo **mesmo mês do ano anterior corrigido pela variação do último ano**:
 *   projeção(mês) = valor do mesmo mês nos últimos 12 meses completos × fator,
 *   fator = total dos últimos 12 meses ÷ total dos 12 meses antes deles (receita e contratações, cada um com o seu).
 * Assim a projeção repete a sazonalidade do último ano (meses fortes e fracos) e acompanha a tendência.
 * Não prevê vagas novas nem mudanças de preço; é ordem de grandeza.
 */
export function projecaoClt(obs: Observacao[], hoje: number) {
  const mesAtual = inicioDoMes(hoje);
  const ultimos12 = janela(obs, mesAtual, 12);
  const anteriores12 = janela(obs, somarMeses(mesAtual, -12), 12);
  const fatorReceita = total(anteriores12, "receita") ? total(ultimos12, "receita") / total(anteriores12, "receita") : 1;
  const fatorContratacoes = total(anteriores12, "contratacoes") ? total(ultimos12, "contratacoes") / total(anteriores12, "contratacoes") : 1;
  const base = (mes: number) => ultimos12[(new Date(mes).getUTCMonth() - new Date(somarMeses(mesAtual, -12)).getUTCMonth() + 12) % 12];
  const projetar = (mes: number) => {
    const b = base(mes);
    return { mes: new Date(mes).toISOString().slice(0, 7), receita: b.receita * fatorReceita, contratacoes: b.contratacoes * fatorContratacoes, base: b };
  };

  const r12 = ritmo(obs, hoje, 12);
  const r3 = ritmo(obs, hoje, 3);
  const d = new Date(hoje);
  const ano = d.getUTCFullYear();
  const doAno = obs.filter((o) => o.inicio >= Date.UTC(ano, 0, 1) && o.inicio <= hoje);
  const doMes = obs.filter((o) => o.inicio >= mesAtual && o.inicio <= hoje);
  const realizadoAno = soma(doAno.map((o) => o.rs));
  const realizadoMes = soma(doMes.map((o) => o.rs));
  const esperadoMes = projetar(mesAtual);
  /** Do mês seguinte ao atual, 12 meses. */
  const serie = Array.from({ length: 12 }, (_, i) => projetar(somarMeses(mesAtual, i + 1)));
  // Fechamento do ano: realizado + o que falta para o mês atual chegar no esperado + meses projetados que ainda são deste ano.
  const faltaMesAtual = Math.max(0, esperadoMes.receita - realizadoMes);
  const restoDoAno = soma(serie.filter((m) => m.mes.startsWith(String(ano))).map((m) => m.receita));
  return {
    ritmo12: r12,
    ritmo3: r3,
    /** Variação do ritmo de 3 meses sobre o de 12, em %. */
    tendencia: r12.receitaPorMes ? ((r3.receitaPorMes - r12.receitaPorMes) / r12.receitaPorMes) * 100 : null,
    base: {
      ultimos12: { de: ultimos12[0].mes, ate: ultimos12[11].mes, receita: total(ultimos12, "receita"), contratacoes: total(ultimos12, "contratacoes") },
      anteriores12: { de: anteriores12[0].mes, ate: anteriores12[11].mes, receita: total(anteriores12, "receita"), contratacoes: total(anteriores12, "contratacoes") },
      fatorReceita,
      fatorContratacoes,
    },
    mesAtual: { realizado: realizadoMes, contratacoes: doMes.length, esperado: esperadoMes.receita, base: esperadoMes.base },
    proximos12: { receita: soma(serie.map((m) => m.receita)), contratacoes: soma(serie.map((m) => m.contratacoes)) },
    ano: { ano, realizado: realizadoAno, contratacoes: doAno.length, faltaMesAtual, restoDoAno, fechamento: realizadoAno + faltaMesAtual + restoDoAno },
    serie,
  };
}
