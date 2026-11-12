/**
 * Permanência de estagiários pelo método Kaplan-Meier.
 * Contratos ativos entram como censurados ("ainda não saiu"); a média simples dos encerrados subestima a permanência.
 */

/** mensal = taxa mensal por estagiário da empresa; rs = taxa de recrutamento e seleção (uma vez). 0 quando a empresa não tem preço. */
export type ContratoBruto = { status: number | null; datainicio: string | null; data_contratacao: string | null; data_demicao: string | null; mensal?: number | string | null; rs?: number | string | null };
export type Observacao = { dias: number; saiu: boolean; ano: number; inicio: number; mensal: number; rs: number };
/**
 * Período (ms UTC, dias inteiros). `modo`:
 * - "inicio" (padrão): só os contratos que começaram no período;
 * - "ativos": todos que estiveram contratados em algum dia do período (inclui quem começou antes).
 */
export type Periodo = { de?: number | null; ate?: number | null; modo?: "inicio" | "ativos" };
export type PontoCurva = { dias: number; permanecem: number };
export type ResultadoKm = { contratos: number; sairam: number; ativos: number; medianaDias: number | null; mediaRestritaDias: number; ateDias: number; curva: PontoCurva[] };

export const DIAS_POR_MES = 30.44;
/** Estágio na mesma empresa não passa de 2 anos (Lei 11.788/2008, art. 11): a média restrita para em 24 meses. */
export const LIMITE_DIAS = 24 * DIAS_POR_MES;
const DIA_MS = 86_400_000;

export const FAIXAS = [
  { faixa: "Até 1 mês", de: 0, ate: DIAS_POR_MES },
  { faixa: "1 a 3 meses", de: DIAS_POR_MES, ate: 3 * DIAS_POR_MES },
  { faixa: "3 a 6 meses", de: 3 * DIAS_POR_MES, ate: 6 * DIAS_POR_MES },
  { faixa: "6 a 12 meses", de: 6 * DIAS_POR_MES, ate: 12 * DIAS_POR_MES },
  { faixa: "Mais de 1 ano", de: 12 * DIAS_POR_MES, ate: Number.POSITIVE_INFINITY },
] as const;

/** "AAAA/MM/DD" → milissegundos UTC. null quando vazio; undefined quando fora do formato ou data impossível. */
export function dataLegado(valor: string | null | undefined): number | null | undefined {
  const texto = valor?.trim();
  if (!texto) return null;
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(texto);
  if (!m) return undefined;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(ano, mes - 1, dia);
  const d = new Date(ms);
  if (ano < 1990 || d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
  return ms;
}

export type Descartes = { formato: number; demissaoAntesDoInicio: number; encerradoSemDemissao: number; inicioFuturo: number; outroStatus: number };

/** Início = datainicio (ou data_contratacao); status 2 termina em data_demicao; status 1 conta até `hoje`. Os descartes contam todos os contratos, não só os do período. */
export function observacoes(contratos: ContratoBruto[], hoje: number, periodo: Periodo = {}): { observacoes: Observacao[]; descartes: Descartes; foraDoPeriodo: number } {
  let foraDoPeriodo = 0;
  const descartes: Descartes = { formato: 0, demissaoAntesDoInicio: 0, encerradoSemDemissao: 0, inicioFuturo: 0, outroStatus: 0 };
  const lista: Observacao[] = [];
  for (const c of contratos) {
    if (c.status !== 1 && c.status !== 2) { descartes.outroStatus++; continue; }
    const inicio = dataLegado(c.datainicio?.trim() ? c.datainicio : c.data_contratacao);
    if (inicio == null) { descartes.formato++; continue; }
    const ano = new Date(inicio).getUTCFullYear();
    const valores = { inicio, mensal: valor(c.mensal), rs: valor(c.rs) };
    if (c.status === 2) {
      const fim = dataLegado(c.data_demicao);
      if (fim === null) { descartes.encerradoSemDemissao++; continue; }
      if (fim === undefined) { descartes.formato++; continue; }
      if (fim < inicio) { descartes.demissaoAntesDoInicio++; continue; }
      if (dentro(periodo, inicio, fim)) lista.push({ dias: (fim - inicio) / DIA_MS, saiu: true, ano, ...valores });
      else foraDoPeriodo++;
    } else {
      if (inicio > hoje) { descartes.inicioFuturo++; continue; }
      if (dentro(periodo, inicio, hoje)) lista.push({ dias: (hoje - inicio) / DIA_MS, saiu: false, ano, ...valores });
      else foraDoPeriodo++;
    }
  }
  return { observacoes: lista, descartes, foraDoPeriodo };
}

function dentro(periodo: Periodo, inicio: number, fim: number): boolean {
  const de = periodo.de ?? Number.NEGATIVE_INFINITY;
  const ate = periodo.ate ?? Number.POSITIVE_INFINITY;
  if (periodo.modo === "ativos") return inicio <= ate && fim >= de;
  return inicio >= de && inicio <= ate;
}

function valor(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Curva de Kaplan-Meier, mediana (primeiro tempo com S ≤ 0,5) e média restrita: área sob a curva até o maior tempo
 * observado, sem passar de `limiteDias` (24 meses). Contratos registrados com mais de 2 anos não inflam a média.
 */
export function kaplanMeier(obs: Observacao[], limiteDias = LIMITE_DIAS): ResultadoKm {
  const ordenadas = [...obs].sort((a, b) => a.dias - b.dias);
  const ateDias = Math.min(ordenadas.length ? ordenadas[ordenadas.length - 1].dias : 0, limiteDias);
  const curva: PontoCurva[] = [{ dias: 0, permanecem: 1 }];
  let emRisco = ordenadas.length;
  let s = 1;
  let i = 0;
  while (i < ordenadas.length) {
    const t = ordenadas[i].dias;
    let saidas = 0;
    let total = 0;
    while (i < ordenadas.length && ordenadas[i].dias === t) {
      if (ordenadas[i].saiu) saidas++;
      total++;
      i++;
    }
    if (saidas) {
      s *= 1 - saidas / emRisco;
      curva.push({ dias: t, permanecem: s });
    }
    emRisco -= total;
  }
  let area = 0;
  for (let k = 0; k < curva.length; k++) {
    const proximo = k + 1 < curva.length ? curva[k + 1].dias : ateDias;
    area += curva[k].permanecem * Math.max(0, Math.min(proximo, ateDias) - Math.min(curva[k].dias, ateDias));
  }
  const sairam = obs.filter((o) => o.saiu).length;
  return {
    contratos: obs.length,
    sairam,
    ativos: obs.length - sairam,
    medianaDias: curva.find((p) => p.permanecem <= 0.5)?.dias ?? null,
    mediaRestritaDias: area,
    ateDias,
    curva,
  };
}

function mediana(valores: number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

/** Tudo o que a página Métricas mostra sobre a permanência dos estagiários. Só contagens e médias, sem dados pessoais. */
export function permanenciaEstagio(contratos: ContratoBruto[], hoje: number, periodo: Periodo = {}) {
  const { observacoes: obs, descartes, foraDoPeriodo } = observacoes(contratos, hoje, periodo);
  const geral = kaplanMeier(obs);
  const encerrados = obs.filter((o) => o.saiu).map((o) => o.dias);
  const porAno = [...new Set(obs.map((o) => o.ano))].sort((a, b) => a - b).map((ano) => {
    const { curva: _curva, ...km } = kaplanMeier(obs.filter((o) => o.ano === ano));
    return { ano, ...km };
  });
  return {
    lidos: contratos.length,
    foraDoPeriodo,
    validos: obs.length,
    descartados: Object.values(descartes).reduce((a, b) => a + b, 0),
    descartes,
    geral,
    encerrados: {
      total: encerrados.length,
      mediaDias: encerrados.length ? encerrados.reduce((a, b) => a + b, 0) / encerrados.length : null,
      medianaDias: mediana(encerrados),
      faixas: FAIXAS.map(({ faixa, de, ate }) => ({ faixa, total: encerrados.filter((d) => d >= de && d < ate).length })),
    },
    porAno,
    receita: receita(obs, geral),
    receitaMensal: receitaMensal(obs, geral.curva, hoje, 12, periodo),
  };
}

/**
 * Quanto um estagiário rende, pelos preços de cada empresa (taxa mensal × permanência média + taxa de R&S).
 * Só entram contratos de empresa com taxa mensal; o resto é contado em `semValor`.
 * `realizado` = taxa mensal × meses já cumpridos (até a saída ou até hoje) + R&S, somado.
 */
export function receita(obs: Observacao[], geral: ResultadoKm) {
  const comValor = obs.filter((o) => o.mensal > 0);
  const n = comValor.length;
  const mensalMedio = n ? comValor.reduce((a, o) => a + o.mensal, 0) / n : null;
  const rsMedio = n ? comValor.reduce((a, o) => a + o.rs, 0) / n : null;
  const mesesMedios = geral.mediaRestritaDias / DIAS_POR_MES;
  const porEstagiario = mensalMedio == null ? null : mensalMedio * mesesMedios + (rsMedio ?? 0);
  const realizado = comValor.reduce((a, o) => a + o.mensal * (o.dias / DIAS_POR_MES) + o.rs, 0);
  return {
    contratosComValor: n,
    semValor: obs.length - n,
    mensalMedio,
    rsMedio,
    mesesMedios,
    porEstagiario,
    estimadoPeriodo: porEstagiario == null ? null : porEstagiario * n,
    realizado,
  };
}

/** S(t): fração que continua contratada no tempo t (dias), pela curva de Kaplan-Meier. Depois do fim da curva, mantém o último valor. */
export function sobrevivencia(curva: PontoCurva[], dias: number): number {
  let s = 1;
  for (const p of curva) {
    if (p.dias > dias) break;
    s = p.permanecem;
  }
  return s;
}

/**
 * `estagiarios` = quantos passaram pelo mês (no histórico) ou quantos se espera que continuem (na projeção).
 * `mesesCheios` = soma das frações do mês que cada um ficou: quem entrou ou saiu no meio do mês paga só a parte dele.
 * Por isso um mês com mais estagiários pode render menos que o seguinte.
 */
export type MesReceita = { mes: string; realizado: number | null; projetado: number | null; estagiarios: number; mesesCheios: number };

/**
 * Receita por mês dos contratos com taxa mensal.
 * Meses passados (até o mês anterior ao atual): taxa mensal proporcional aos dias ativos no mês + R&S no mês de início.
 * Mês atual e os seguintes (`mesesFuturos` no total): só os ativos de hoje, cada um com a chance de continuar
 * no meio do mês dada a permanência que já tem, S(a + Δ) / S(a). Não conta contratações novas.
 */
export function receitaMensal(obs: Observacao[], curva: PontoCurva[], hoje: number, mesesFuturos = 12, periodo: Periodo = {}): MesReceita[] {
  const comValor = obs.filter((o) => o.mensal > 0);
  if (!comValor.length) return [];
  const hojeData = new Date(hoje);
  const mesAtual = Date.UTC(hojeData.getUTCFullYear(), hojeData.getUTCMonth(), 1);
  const primeiro = new Date(Math.min(...comValor.map((o) => o.inicio)));
  const meses: MesReceita[] = [];
  const rotulo = (ms: number) => new Date(ms).toISOString().slice(0, 7);
  const proximoMes = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

  // Com período, o gráfico mostra só os meses do período (e a projeção só se o período chega até o mês atual).
  const inicioMes = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
  const desde = Math.max(inicioMes(primeiro.getTime()), periodo.de != null ? inicioMes(periodo.de) : Number.NEGATIVE_INFINITY);
  const limite = periodo.ate != null ? Math.min(mesAtual, proximoMes(inicioMes(periodo.ate))) : mesAtual;
  if (periodo.ate != null && periodo.ate < mesAtual) mesesFuturos = 0;
  for (let m = desde; m < limite; m = proximoMes(m)) {
    const fimMes = proximoMes(m);
    const diasMes = (fimMes - m) / DIA_MS;
    let total = 0;
    let estagiarios = 0;
    let mesesCheios = 0;
    for (const o of comValor) {
      const fim = o.inicio + o.dias * DIA_MS;
      const sobreposicao = Math.min(fim, fimMes) - Math.max(o.inicio, m);
      if (sobreposicao > 0) {
        const fracao = sobreposicao / DIA_MS / diasMes;
        total += o.mensal * fracao;
        mesesCheios += fracao;
        estagiarios++;
      }
      if (o.inicio >= m && o.inicio < fimMes) total += o.rs;
    }
    meses.push({ mes: rotulo(m), realizado: total, projetado: null, estagiarios, mesesCheios });
  }

  const ativos = comValor.filter((o) => !o.saiu);
  for (let i = 0, m = mesAtual; i < mesesFuturos; i++, m = proximoMes(m)) {
    const meio = m + (proximoMes(m) - m) / 2;
    const delta = Math.max(0, (meio - hoje) / DIA_MS);
    let total = 0;
    let esperados = 0;
    for (const o of ativos) {
      const base = sobrevivencia(curva, o.dias);
      const p = base > 0 ? sobrevivencia(curva, o.dias + delta) / base : 0;
      total += o.mensal * p;
      esperados += p;
    }
    meses.push({ mes: rotulo(m), realizado: null, projetado: total, estagiarios: esperados, mesesCheios: esperados });
  }
  return meses;
}
