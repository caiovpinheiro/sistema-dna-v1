/**
 * Aba Geral da página Métricas: estágio e CLT juntos. Não tem API própria: soma as respostas das abas
 * Estágio (useMetricasEstagio) e CLT (useMetricasClt), com o mesmo cache.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alerta } from "@/components/pagina";
import { Skeleton } from "@/components/ui";
import { Indicador, Secao, dataBr, eixo, eixoReais, num, reais, rotuloMes, tooltip, useMetricasEstagio, type Modo } from "@/components/metricas";
import { useMetricasClt } from "@/components/metricas-clt";

const CORES = {
  estagio: "#67e8f9",
  clt: "#d8b4fe",
  estagioProjetado: "rgba(103, 232, 249, 0.4)",
  estagioSimulado: "rgba(52, 211, 153, 0.6)",
  cltProjetado: "rgba(216, 180, 254, 0.4)",
} as const;
const NOMES: Record<keyof typeof CORES, string> = {
  estagio: "Estágio",
  clt: "CLT",
  estagioProjetado: "Estágio (ativos de hoje)",
  estagioSimulado: "Estágio (novas contratações simuladas)",
  cltProjetado: "CLT (projeção)",
};

type Serie = keyof typeof CORES;
/** Um mês do gráfico: valor de cada série, quantidade de cada série e a parte única (R&S) dentro do estágio. */
type Linha = Record<Serie, number | null> & {
  mes: string;
  qtd: Partial<Record<Serie, number>>;
  rsEstagio: number;
  rsSimulado: number;
};
type Simulacao = { contratacoesPorMes: number; mensalMedio: number; rsMedio: number; permanencia: number[] };

/**
 * Receita das turmas novas de estágio em cada mês projetado (índice 0 = mês atual).
 * Turma do mês j (j = 1..n, a partir do mês seguinte) = novos × (1 + crescimento)^(j − 1) estagiários.
 * No mês em que começa, paga meio mês (entra, em média, no meio do mês) + R&S; k meses depois, taxa mensal × permanencia[k].
 * Depois de 24 meses o estágio acaba (permanencia não vai além disso).
 */
export function simularEstagio(base: Simulacao, novos: number, crescimentoPct: number, meses: number) {
  const turmas = Array.from({ length: meses }, (_, j) => (j === 0 ? 0 : novos * (1 + crescimentoPct / 100) ** (j - 1)));
  return Array.from({ length: meses }, (_, t) => {
    let receita = 0;
    let estagiarios = 0;
    let rs = 0;
    for (let j = 1; j <= t; j++) {
      const k = t - j;
      const ficam = turmas[j] * (base.permanencia[k] ?? 0);
      estagiarios += ficam;
      if (k === 0) {
        receita += turmas[j] * (base.mensalMedio * 0.5 + base.rsMedio);
        rs += turmas[j] * base.rsMedio;
      } else receita += ficam * base.mensalMedio;
    }
    return { receita, estagiarios, rs };
  });
}

/** Parte recorrente (mensalidades de estágio) e parte única (CLT + R&S) de um mês do gráfico. */
function partes(l: Linha) {
  const recorrente = (l.estagio ?? 0) - l.rsEstagio + (l.estagioProjetado ?? 0) + (l.estagioSimulado ?? 0) - l.rsSimulado;
  const unico = (l.clt ?? 0) + (l.cltProjetado ?? 0) + l.rsEstagio + l.rsSimulado;
  return { recorrente, unico };
}

const QTD: Record<Serie, (n: number) => string> = {
  estagio: (n) => `${num(n)} ${n === 1 ? "estagiário" : "estagiários"}`,
  estagioProjetado: (n) => `≈ ${num(Math.round(n))} estagiários`,
  estagioSimulado: (n) => `≈ ${num(Math.round(n))} estagiários novos`,
  clt: (n) => `${num(n)} ${n === 1 ? "contratação" : "contratações"}`,
  cltProjetado: (n) => `≈ ${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} contratações`,
};

/** Dica do gráfico: valor e quantidade de cada parte, total, recorrente e único. */
function DicaMes({ active, payload }: { active?: boolean; payload?: Array<{ payload: Linha }> }) {
  if (!active || !payload?.length) return null;
  const l = payload[0].payload;
  const visiveis = (Object.keys(CORES) as Serie[]).filter((s) => l[s] != null && l[s] !== 0);
  const { recorrente, unico } = partes(l);
  return (
    <div style={tooltip} className="grid gap-1 px-3 py-2">
      <p className="font-semibold">{rotuloMes(l.mes)} · total {reais(recorrente + unico)}</p>
      {visiveis.map((s) => (
        <p key={s} className="flex items-center gap-1.5">
          <i aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CORES[s] }} />
          <span>{NOMES[s]}: {reais(l[s])}{l.qtd[s] != null ? ` · ${QTD[s](l.qtd[s]!)}` : ""}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-white/10 pt-1">Recorrente (mensalidades de estágio): {reais(recorrente)}</p>
      <p>Único (CLT + taxa de R&S): {reais(unico)}</p>
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const somar = (valores: Array<number | null | undefined>) => valores.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Mês "AAAA-MM" deslocado de `n` meses. */
function mesMais(mes: string, n: number) {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function Conta({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-3 text-[11px] leading-snug text-slate-500">{children}</p>;
}

export function MetricasGeral({ de, ate, modo, ativo }: { de: string; ate: string; modo: Modo; ativo: boolean }) {
  const [params, setParams] = useSearchParams();
  const simular = params.get("simular") === "1";
  const estagio = useMetricasEstagio(de, ate, modo, ativo);
  const clt = useMetricasClt(de, ate, ativo);
  const e = estagio.data?.data;
  const c = clt.data?.data;
  const novosPadrao = e ? Math.round(e.simulacao.contratacoesPorMes) : 0;
  const novos = Math.max(0, Number(params.get("novos") ?? novosPadrao) || 0);
  const crescimento = Math.max(-50, Math.min(50, Number(params.get("crescimento") ?? 0) || 0));

  function trocarSimulacao(mudancas: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) next.set(chave, valor); else next.delete(chave);
    }
    setParams(next, { replace: true });
  }

  const calc = useMemo(() => {
    if (!e || !c) return null;
    const mesAtual = c.calculadoEm.slice(0, 7);
    const linhas = new Map<string, Linha>();
    const linha = (mes: string) => {
      if (!linhas.has(mes)) linhas.set(mes, { mes, estagio: null, clt: null, estagioProjetado: null, estagioSimulado: null, cltProjetado: null, qtd: {}, rsEstagio: 0, rsSimulado: 0 });
      return linhas.get(mes)!;
    };
    for (const m of e.receitaMensal) {
      const l = linha(m.mes);
      if (m.realizado != null) { l.estagio = m.realizado; l.qtd.estagio = m.estagiarios; l.rsEstagio = m.rs ?? 0; }
      if (m.projetado != null) { l.estagioProjetado = m.projetado; l.qtd.estagioProjetado = m.estagiarios; }
    }
    for (const m of c.receitaMensal) { linha(m.mes).clt = m.receita; linha(m.mes).qtd.clt = m.contratacoes; }
    // A projeção só entra quando o período chega ao mês atual (o estágio já segue essa regra no backend).
    const temProjecao = e.receitaMensal.some((m) => m.projetado != null);
    if (temProjecao) for (const m of c.projecao.serie) { linha(m.mes).cltProjetado = m.receita; linha(m.mes).qtd.cltProjetado = m.contratacoes; }
    // Simulação: turmas novas de estágio a partir do mês seguinte, nos mesmos meses projetados.
    if (temProjecao && simular) {
      const mesesProjetados = e.receitaMensal.filter((m) => m.projetado != null).map((m) => m.mes);
      const valores = simularEstagio(e.simulacao, novos, crescimento, mesesProjetados.length);
      mesesProjetados.forEach((mes, i) => {
        const l = linha(mes);
        l.estagioSimulado = valores[i].receita || null;
        if (valores[i].receita) { l.qtd.estagioSimulado = valores[i].estagiarios; l.rsSimulado = valores[i].rs; }
      });
    }
    const grafico = [...linhas.values()].sort((a, b) => a.mes.localeCompare(b.mes));

    const realizadoEstagio = somar(grafico.map((l) => l.estagio));
    const realizadoClt = c.receita.total;

    // Próximos 12 meses: do mês seguinte ao atual, as 12 barras projetadas das duas partes.
    const proximos = c.projecao.serie.map((m) => m.mes);
    const proxEstagio = somar(grafico.filter((l) => proximos.includes(l.mes)).map((l) => l.estagioProjetado));
    const proxClt = c.projecao.proximos12.receita;
    const proxSimulado = somar(grafico.filter((l) => proximos.includes(l.mes)).map((l) => l.estagioSimulado));

    // Média por mês dos últimos 12 meses completos.
    const ultimos = Array.from({ length: 12 }, (_, i) => mesMais(mesAtual, i - 12));
    const mediaEstagio = somar(grafico.filter((l) => ultimos.includes(l.mes)).map((l) => l.estagio)) / 12;
    const mediaClt = c.projecao.ritmo12.receitaPorMes;

    // Fechamento do ano: só quando o gráfico cobre o ano todo (Tudo ou um período que começa até 1º de janeiro).
    const ano = mesAtual.slice(0, 4);
    const cobreAno = temProjecao && grafico.some((l) => l.mes === `${ano}-01`) && (!de || de <= `${ano}-01-01`);
    const fechamentoEstagio = cobreAno ? somar(grafico.filter((l) => l.mes.startsWith(ano)).map((l) => (l.estagio ?? 0) + (l.estagioProjetado ?? 0))) : null;
    const fechamentoClt = c.projecao.ano.fechamento;
    const fechamentoSimulado = cobreAno ? somar(grafico.filter((l) => l.mes.startsWith(ano)).map((l) => l.estagioSimulado)) : 0;

    // Recorrente: mensalidades de estágio (sem R&S) nos últimos 12 meses completos e no último mês completo.
    const linhasUltimos = grafico.filter((l) => ultimos.includes(l.mes));
    const recorrenteMedio = somar(linhasUltimos.map((l) => partes(l).recorrente)) / 12;
    const ultimoMes = grafico.find((l) => l.mes === mesMais(mesAtual, -1));
    const recorrenteUltimo = ultimoMes ? partes(ultimoMes).recorrente : null;

    return {
      grafico, temProjecao, ano, proximos,
      realizadoEstagio, realizadoClt,
      proxEstagio, proxClt, proxSimulado, fechamentoSimulado,
      mediaEstagio, mediaClt,
      fechamentoEstagio, fechamentoClt,
      recorrenteMedio, recorrenteUltimo, ultimoMes: mesMais(mesAtual, -1),
    };
  }, [e, c, de, simular, novos, crescimento]);

  if (estagio.isLoading || clt.isLoading) return <Skeleton className="h-64" />;
  if (estagio.isError || clt.isError) return <Alerta>Não foi possível calcular as métricas. Atualize a página; se continuar, avise o suporte.</Alerta>;
  if (!e || !c || !calc) return null;

  const realizado = calc.realizadoEstagio + calc.realizadoClt;
  const comPeriodo = Boolean(de || ate);
  const fechamento = calc.fechamentoEstagio == null ? null : calc.fechamentoEstagio + calc.fechamentoClt + calc.fechamentoSimulado;
  const comSimulacao = simular && calc.temProjecao;
  const series = (calc.temProjecao
    ? ["estagio", "clt", "estagioProjetado", ...(comSimulacao ? ["estagioSimulado"] : []), "cltProjetado"]
    : ["estagio", "clt"]) as Array<keyof typeof CORES>;
  const sim = e.simulacao;

  return (
    <>
      <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Indicador titulo="Receita realizada" valor={reais(realizado)} detalhe={`${reais(calc.realizadoEstagio)} estágio · ${reais(calc.realizadoClt)} CLT`} />
          <Indicador
            titulo={modo === "ativos" && comPeriodo ? "Contratos no período" : "Contratações"}
            valor={num(e.validos + c.validos)}
            detalhe={`${num(e.validos)} estágio${modo === "ativos" && comPeriodo ? " (ativos no período)" : ""} · ${num(c.validos)} CLT`}
            className="border-l border-white/10"
          />
          <Indicador titulo="Estágio na receita" valor={pct(realizado ? (calc.realizadoEstagio / realizado) * 100 : null)} detalhe={`CLT: ${pct(realizado ? (calc.realizadoClt / realizado) * 100 : null)}`} className="max-lg:border-t lg:border-l border-white/10" />
          <Indicador titulo="Estagiários ativos" valor={num(e.geral.ativos)} detalhe={comPeriodo ? "ainda ativos, entre os contratos de estágio do período" : "pagam todo mês"} className="border-l max-lg:border-t border-white/10" />
        </div>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
          Estágio: taxa mensal proporcional aos dias de cada estagiário + R&S, até o mês passado. CLT: taxa única de cada contratação, no mês em que começou (inclui o mês atual).
          {comPeriodo ? ` Período${de ? ` de ${dataBr(de)}` : ""}${ate ? ` até ${dataBr(ate)}` : ""}.` : ""} Calculado em {dataBr(c.calculadoEm)}.
        </p>
      </section>

      <Secao
        titulo="Projeções"
        texto="Soma das projeções das abas Estágio e CLT. Atenção: são contas diferentes. No estágio, só os estagiários ativos hoje, descontando as saídas (sem contratações novas). No CLT, contratações novas no ritmo do último ano (cada mês = mesmo mês do último ano × variação do ano)."
      >
        {calc.temProjecao ? (
          <div className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-[#12141a]">
              <Indicador titulo="Próximos 12 meses" valor={reais(calc.proxEstagio + calc.proxClt + calc.proxSimulado)} detalhe={`de ${rotuloMes(calc.proximos[0])} a ${rotuloMes(calc.proximos[11])}`} />
              <Conta>
                {reais(calc.proxEstagio)} do estágio (ativos de hoje){comSimulacao ? ` + ${reais(calc.proxSimulado)} das novas contratações simuladas` : ""} + {reais(calc.proxClt)} do CLT (contratações novas).
              </Conta>
            </div>
            <div className="bg-[#12141a]">
              <Indicador titulo={`Fechamento de ${calc.ano}`} valor={reais(fechamento)} detalhe="realizado + projetado até 31/12" />
              <Conta>
                {calc.fechamentoEstagio == null
                  ? "Escolha Tudo ou um período que comece até 1º de janeiro para ver o ano inteiro."
                  : `${reais(calc.fechamentoEstagio)} do estágio${comSimulacao ? ` + ${reais(calc.fechamentoSimulado)} simulados` : ""} + ${reais(calc.fechamentoClt)} do CLT.`}
              </Conta>
            </div>
            <div className="bg-[#12141a]">
              <Indicador titulo="Média por mês" valor={reais(calc.mediaEstagio + calc.mediaClt)} detalhe="últimos 12 meses completos" />
              <Conta>{reais(calc.mediaEstagio)} do estágio + {reais(calc.mediaClt)} do CLT, por mês.</Conta>
            </div>
            <div className="bg-[#12141a]">
              <Indicador
                titulo="Receita recorrente"
                valor={reais(calc.recorrenteMedio)}
                detalhe={`por mês · ${pct(calc.mediaEstagio + calc.mediaClt ? (calc.recorrenteMedio / (calc.mediaEstagio + calc.mediaClt)) * 100 : null)} da média por mês`}
              />
              <Conta>
                Mensalidades de estágio (sem R&S), média dos últimos 12 meses completos.
                {calc.recorrenteUltimo != null ? ` Em ${rotuloMes(calc.ultimoMes)}: ${reais(calc.recorrenteUltimo)}.` : ""} CLT e R&S são pagos uma vez só.
              </Conta>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">As projeções aparecem quando o período chega até o mês atual (por exemplo, Tudo, Últimos 12 meses ou o ano atual).</p>
        )}
      </Secao>

      {calc.grafico.length ? (
        <Secao titulo="Receita por mês" texto="Estágio e CLT empilhados em cada mês. Barras claras: projeção de cada parte. Passe o mouse para ver, em cada mês, o valor e a quantidade de estagiários e de contratações CLT, e quanto é recorrente (mensalidades) e quanto é único (CLT e R&S).">
          {calc.temProjecao ? (
            <div className="mb-3 grid gap-2 rounded-lg bg-white/5 px-3 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={simular} onChange={(ev) => trocarSimulacao({ simular: ev.target.checked ? "1" : "", novos: "", crescimento: "" })} />
                Simular novas contratações de estágio
              </label>
              {simular ? (
                <>
                  <div className="flex flex-wrap items-end gap-4">
                    <label className="grid gap-1 text-xs text-slate-400">
                      Novos estagiários por mês
                      <input type="number" min={0} max={500} value={novos} onChange={(ev) => trocarSimulacao({ novos: ev.target.value })}
                        className="h-8 w-28 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white" />
                    </label>
                    <label className="grid gap-1 text-xs text-slate-400">
                      Crescimento ao mês (%)
                      <input type="number" min={-50} max={50} step={1} value={crescimento} onChange={(ev) => trocarSimulacao({ crescimento: ev.target.value })}
                        className="h-8 w-28 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white" />
                    </label>
                    <button type="button" onClick={() => trocarSimulacao({ novos: "", crescimento: "" })} className="h-8 rounded-lg px-3 text-sm text-slate-300 hover:bg-white/10">
                      Voltar ao ritmo atual ({num(novosPadrao)} por mês)
                    </button>
                  </div>
                  <p className="text-[11px] leading-snug text-slate-500">
                    Hoje entram, em média, {sim.contratacoesPorMes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} estagiários por mês (últimos 12 meses). Cada turma nova começa no mês seguinte,
                    paga meio mês no primeiro mês ({reais(sim.mensalMedio)} × 0,5) + R&S ({reais(sim.rsMedio)}) e depois {reais(sim.mensalMedio)} por mês por quem continua, saindo pela curva real de
                    permanência (depois de 3 meses ficam {Math.round((sim.permanencia[3] ?? 0) * 100)}%, depois de 6 meses {Math.round((sim.permanencia[6] ?? 0) * 100)}%). Crescimento de X% aumenta a turma de cada mês em X% sobre a do mês anterior.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          <p className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
            {series.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: CORES[s] }} /> {NOMES[s]}</span>
            ))}
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calc.grafico} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="mes" {...eixo} tickFormatter={rotuloMes} minTickGap={24} />
                <YAxis {...eixo} width={64} tickFormatter={eixoReais} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<DicaMes />} />
                {series.map((s, i) => (
                  <Bar key={s} dataKey={s} stackId="r" fill={CORES[s]} radius={i === series.length - 1 || s === "clt" ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>
      ) : null}

      <p className="text-xs text-slate-500">
        Soma das abas Estágio (vaga.tipo_vaga = 1) e CLT (vaga.tipo_vaga = 2), com os preços de cada empresa (os mesmos do Faturamento). É estimativa: não usa o que foi faturado de fato.
      </p>
    </>
  );
}
