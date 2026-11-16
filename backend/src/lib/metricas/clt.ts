/**
 * Métricas de contratações CLT. A DNA Work cobra **uma vez**, no mês da contratação (taxa fixa ou % do salário),
 * sem mensalidade. A permanência usa o mesmo Kaplan-Meier do estágio, sem o limite de 24 meses.
 * O contrato chega com a taxa em `rs` (ver metricas.service.ts) e `mensal` = 0.
 */
import { resumoPermanencia, type ContratoBruto, type Observacao, type Periodo } from "./permanencia.js";

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
  };
}
