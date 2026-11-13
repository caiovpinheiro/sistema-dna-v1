import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";

const DIAS_POR_MES = 30.44;

type Km = { contratos: number; sairam: number; ativos: number; medianaDias: number | null; mediaRestritaDias: number; ateDias: number };
type Modo = "inicio" | "ativos";
type Receita = {
  contratosComValor: number;
  semValor: number;
  mensalMedio: number | null;
  rsMedio: number | null;
  mesesMedios: number;
  porEstagiario: number | null;
  estimadoPeriodo: number | null;
  realizado: number;
};
type Permanencia = {
  calculadoEm: string;
  periodo: { de: string | null; ate: string | null; modo: Modo };
  lidos: number;
  foraDoPeriodo: number;
  receita: Receita;
  receitaMensal: Array<{ mes: string; realizado: number | null; projetado: number | null; estagiarios: number; mesesCheios: number }>;
  validos: number;
  descartados: number;
  descartes: { formato: number; demissaoAntesDoInicio: number; encerradoSemDemissao: number; inicioFuturo: number; outroStatus: number };
  geral: Km & { curva: Array<{ dias: number; permanecem: number }> };
  encerrados: { total: number; mediaDias: number | null; medianaDias: number | null; faixas: Array<{ faixa: string; total: number }> };
  porAno: Array<Km & { ano: number }>;
};

const tooltip = { background: "#15181e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e7e9ee", fontSize: 12 };
const eixo = { stroke: "#8b95a7", fontSize: 11, tickLine: false, axisLine: false } as const;
const COR = "#67e8f9";
/** Pela lei do estágio (Lei 11.788/2008, art. 11), o contrato na mesma empresa não passa de 2 anos. */
const MESES_MAXIMOS = 24;
const COR_PROJECAO = "rgba(103, 232, 249, 0.4)";
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;

const meses = (dias: number | null) => (dias == null ? "—" : `${(dias / DIAS_POR_MES).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} meses`);
const diasTxt = (dias: number | null) => (dias == null ? "não atingida" : `${Math.round(dias).toLocaleString("pt-BR")} dias`);
const num = (valor: number) => valor.toLocaleString("pt-BR");
const reais = (valor: number | null) => (valor == null ? "—" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: valor >= 10_000 ? 0 : 2 }));
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Atalhos de período (pela data de início do contrato). */
function atalhos() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const dozeMeses = new Date(hoje);
  dozeMeses.setFullYear(ano - 1);
  return [
    { rotulo: "Tudo", de: "", ate: "" },
    { rotulo: "Últimos 12 meses", de: iso(dozeMeses), ate: iso(hoje) },
    { rotulo: String(ano), de: `${ano}-01-01`, ate: `${ano}-12-31` },
    { rotulo: String(ano - 1), de: `${ano - 1}-01-01`, ate: `${ano - 1}-12-31` },
  ];
}

function Indicador({ titulo, valor, detalhe, className }: { titulo: string; valor: string; detalhe: string; className?: string }) {
  return (
    <article className={cn("min-w-0 px-4 py-3", className)}>
      <p className="text-[13px] text-slate-400">{titulo}</p>
      <p className="mt-1 text-2xl font-medium leading-none tabular-nums tracking-tight text-white">{valor}</p>
      <p className="mt-1 text-xs text-slate-400">{detalhe}</p>
    </article>
  );
}

function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold text-white">{titulo}</h2>
      {texto ? <p className="mt-0.5 text-xs text-slate-400">{texto}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Permanência dos estagiários (Kaplan-Meier). Página só para o administrador. */
export function MetricasPage() {
  const [params, setParams] = useSearchParams();
  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";
  const comPeriodo = Boolean(de || ate);
  const modo: Modo = params.get("modo") === "ativos" ? "ativos" : "inicio";
  const invertido = Boolean(de && ate && de > ate);
  const query = useQuery({
    queryKey: ["metricas-permanencia", de, ate, comPeriodo ? modo : "inicio"],
    queryFn: () => {
      const busca = new URLSearchParams();
      if (de) busca.set("de", de);
      if (ate) busca.set("ate", ate);
      if (comPeriodo && modo === "ativos") busca.set("modo", "ativos");
      const texto = busca.toString();
      return api<Permanencia>(`/api/v1/metricas/permanencia-estagio${texto ? `?${texto}` : ""}`);
    },
    enabled: !invertido,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
  });
  const data = query.data?.data;

  function trocarModo(novo: Modo) {
    const next = new URLSearchParams(params);
    if (novo === "ativos") next.set("modo", "ativos"); else next.delete("modo");
    setParams(next, { replace: true });
  }

  function trocarPeriodo(novoDe: string, novoAte: string) {
    const next = new URLSearchParams(params);
    if (novoDe) next.set("de", novoDe); else next.delete("de");
    if (novoAte) next.set("ate", novoAte); else next.delete("ate");
    setParams(next, { replace: true });
  }

  // Curva em degraus, em meses e em %, reduzida a um ponto por dia inteiro.
  const curva = useMemo(() => {
    if (!data) return [];
    const porDia = new Map<number, number>();
    const limite = MESES_MAXIMOS * DIAS_POR_MES;
    for (const p of data.geral.curva) if (p.dias <= limite) porDia.set(Math.round(p.dias), p.permanecem);
    const pontos = [...porDia].map(([dias, s]) => ({ meses: dias / DIAS_POR_MES, permanecem: Math.round(s * 1000) / 10 }));
    // A linha segue reta até o fim do eixo (24 meses) ou até o último tempo observado, o que vier antes.
    pontos.push({ meses: Math.min(data.geral.ateDias, limite) / DIAS_POR_MES, permanecem: pontos[pontos.length - 1]?.permanecem ?? 100 });
    return pontos;
  }, [data]);

  const faixas = useMemo(() => {
    if (!data) return [];
    const total = data.encerrados.total || 1;
    return data.encerrados.faixas.map((f) => ({ ...f, pct: Math.round((f.total / total) * 1000) / 10 }));
  }, [data]);

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Métricas"
        descricao="Quanto tempo os estagiários ficam contratados e quanto eles rendem. Calculado pelo método Kaplan-Meier: quem ainda está ativo conta como “ainda não saiu”, para a média não ficar abaixo da real."
      />
      <section className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl bg-[#12141a] px-4 py-3 ring-1 ring-white/10">
        <div className="grid gap-1">
          <span className="text-xs text-slate-400">{comPeriodo && modo === "ativos" ? "Contratos ativos entre" : "Contratos que começaram"}</span>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Início do período" type="date" value={de} max={ate || undefined} onChange={(e) => trocarPeriodo(e.target.value, ate)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
            <span className="text-sm text-slate-400">até</span>
            <input aria-label="Fim do período" type="date" value={ate} min={de || undefined} onChange={(e) => trocarPeriodo(de, e.target.value)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {atalhos().map((a) => {
            const ativo = a.de === de && a.ate === ate;
            return (
              <button key={a.rotulo} type="button" aria-pressed={ativo} onClick={() => trocarPeriodo(a.de, a.ate)}
                className={cn("h-8 rounded-lg px-3 text-sm", ativo ? "bg-cyan-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10")}>
                {a.rotulo}
              </button>
            );
          })}
        </div>
        {comPeriodo ? (
          <div className="grid gap-1">
            <span className="text-xs text-slate-400">Considerar</span>
            <div className="flex rounded-lg bg-white/5 p-0.5" role="group" aria-label="Quais contratos considerar">
              {([["inicio", "Só quem entrou no período"], ["ativos", "Todos ativos no período"]] as const).map(([valor, rotulo]) => (
                <button key={valor} type="button" aria-pressed={modo === valor} onClick={() => trocarModo(valor)}
                  className={cn("h-7 rounded-md px-3 text-sm", modo === valor ? "bg-cyan-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10")}>
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {query.isFetching && data ? <span className="text-xs text-slate-400">Atualizando…</span> : null}
        {comPeriodo ? (
          <p className="w-full text-xs text-slate-500">
            {modo === "inicio"
              ? "Entram só os contratos que começaram no período. A receita por mês mostra só o que eles renderam."
              : "Entram todos que estiveram contratados em algum dia do período, inclusive quem começou antes. A receita por mês fica igual à de “Tudo”; a permanência tende a ficar maior, porque contratos longos têm mais chance de cruzar o período."}
          </p>
        ) : null}
        {invertido ? <p className="w-full text-xs text-rose-300">A data inicial é depois da final.</p> : null}
      </section>
      {query.isLoading ? <Skeleton className="h-64" /> : null}
      {query.isError ? <Alerta>Não foi possível calcular as métricas. Atualize a página; se continuar, avise o suporte.</Alerta> : null}
      {data ? (
        <>
          <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              <Indicador titulo="Permanência média" valor={meses(data.geral.mediaRestritaDias)} detalhe={`${diasTxt(data.geral.mediaRestritaDias)} · média restrita`} />
              <Indicador titulo="Metade sai antes de" valor={meses(data.geral.medianaDias)} detalhe={`${diasTxt(data.geral.medianaDias)} · mediana`} className="border-l border-white/10" />
              <Indicador titulo="Estagiários ativos" valor={num(data.geral.ativos)} detalhe="contratos de estágio em andamento" className="max-lg:border-t lg:border-l border-white/10" />
              <Indicador titulo="Contratos analisados" valor={num(data.validos)} detalhe={comPeriodo ? (modo === "ativos" ? "ativos em algum dia do período" : "que começaram no período") : `${num(data.descartados)} descartados de ${num(data.lidos)}`} className="border-l max-lg:border-t border-white/10" />
            </div>
            <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
              Só quem já saiu ({num(data.encerrados.total)}): média de <span className="tabular-nums text-slate-200">{meses(data.encerrados.mediaDias)}</span> e mediana de{" "}
              <span className="tabular-nums text-slate-200">{meses(data.encerrados.medianaDias)}</span>. Essa conta ignora os ativos e por isso fica mais baixa.
              {data.periodo.de || data.periodo.ate ? ` Período${data.periodo.de ? ` de ${dataBr(data.periodo.de)}` : ""}${data.periodo.ate ? ` até ${dataBr(data.periodo.ate)}` : ""} (${data.periodo.modo === "ativos" ? "todos ativos no período" : "só quem entrou no período"}).` : ""} Calculado em {dataBr(data.calculadoEm)}.
            </p>
          </section>

          {data.validos === 0 ? <p className="text-sm text-slate-400">Nenhum contrato de estágio começou nesse período.</p> : null}

          <Secao titulo="Quanto um estagiário rende" texto="Pelos preços de cada empresa (os mesmos do Faturamento): taxa mensal × permanência média + taxa de recrutamento e seleção.">
            <div className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-3">
              <Indicador className="bg-[#12141a]" titulo="Receita média por estagiário" valor={reais(data.receita.porEstagiario)} detalhe={`${meses(data.receita.mesesMedios * DIAS_POR_MES)} × taxa mensal + R&S`} />
              <Indicador className="bg-[#12141a]" titulo="Taxa mensal média" valor={reais(data.receita.mensalMedio)} detalhe="por estagiário, média das empresas" />
              <Indicador className="bg-[#12141a]" titulo="Receita esperada dos contratos" valor={reais(data.receita.estimadoPeriodo)} detalhe={`${num(data.receita.contratosComValor)} contratos × receita média`} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Já rendido até hoje (taxa mensal × meses cumpridos + R&S): <span className="tabular-nums text-slate-200">{reais(data.receita.realizado)}</span>.
              {data.receita.semValor ? ` ${num(data.receita.semValor)} contrato(s) de empresa sem taxa mensal cadastrada ficaram fora da conta.` : ""} É uma estimativa: não considera atrasos, descontos nem meses parciais faturados de outro jeito.
            </p>
          </Secao>

          {data.receitaMensal.length ? (
            <Secao
              titulo="Receita por mês"
              texto="Meses passados: taxa mensal proporcional aos dias que cada estagiário ficou + R&S no mês da contratação. Do mês atual em diante: só os estagiários ativos hoje, descontando a chance de cada um sair (pela curva de permanência). Não inclui contratações novas. Quem entra ou sai no meio do mês paga só os dias dele, por isso um mês com mais estagiários pode render menos que o seguinte."
            >
              <p className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COR }} /> Estimado pelo histórico</span>
                <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_PROJECAO }} /> Projeção com as saídas</span>
              </p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.receitaMensal} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="mes" {...eixo} tickFormatter={rotuloMes} minTickGap={24} />
                    <YAxis {...eixo} width={64} tickFormatter={(v: number) => `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`} />
                    <Tooltip
                      contentStyle={tooltip}
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      labelFormatter={(mes) => rotuloMes(String(mes))}
                      formatter={(v, nome, item) => {
                        const linha = item.payload as { estagiarios: number; mesesCheios: number; projetado: number | null };
                        const qtd = linha.projetado != null
                          ? `≈ ${Math.round(linha.estagiarios)} estagiários esperados`
                          : `${num(linha.estagiarios)} estagiários, equivalente a ${num(Math.round(linha.mesesCheios))} o mês inteiro`;
                        return [`${reais(Number(v))} · ${qtd}`, nome === "projetado" ? "Projeção" : "Estimado"];
                      }}
                    />
                    <Bar dataKey="realizado" stackId="r" fill={COR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="projetado" stackId="r" fill={COR_PROJECAO} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Secao>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <Secao titulo="Quantos continuam contratados com o tempo" texto="% dos estagiários que ainda não saíram depois de X meses, até 24 meses (limite do contrato de estágio na mesma empresa). A linha tracejada marca 50%.">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curva} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="meses" type="number" domain={[0, MESES_MAXIMOS]} ticks={[0, 3, 6, 9, 12, 15, 18, 21, 24]} allowDataOverflow {...eixo} tickFormatter={(v: number) => `${v} ${v === 1 ? "mês" : "meses"}`} />
                      <YAxis {...eixo} domain={[0, 100]} width={36} tickFormatter={(v: number) => `${v}%`} />
                      <ReferenceLine y={50} stroke="#8b95a7" strokeDasharray="4 4" />
                      <Tooltip
                        contentStyle={tooltip}
                        labelFormatter={(v) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} meses`}
                        formatter={(v) => [`${Number(v).toLocaleString("pt-BR")}%`, "Ainda contratados"]}
                      />
                      <Line type="stepAfter" dataKey="permanecem" stroke={COR} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Secao>
            </div>
            <div className="xl:col-span-2">
              <Secao titulo="Tempo de quem já saiu" texto={`${num(data.encerrados.total)} contratos encerrados, por faixa de permanência.`}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={faixas} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                      <XAxis type="number" {...eixo} allowDecimals={false} />
                      <YAxis type="category" dataKey="faixa" {...eixo} width={92} />
                      <Tooltip contentStyle={tooltip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, _n, item) => [`${num(Number(v))} (${(item.payload as { pct: number }).pct.toLocaleString("pt-BR")}%)`, "Contratos"]} />
                      <Bar dataKey="total" fill={COR} barSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Secao>
            </div>
          </div>

          <Secao titulo="Por ano de início" texto="Kaplan-Meier calculado em cada ano. A média restrita só vai até o maior tempo observado no ano, então os anos recentes não são comparáveis por ela; use a mediana.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">Ano</th>
                    <th className="py-2 pr-3 text-right font-medium">Contratos</th>
                    <th className="py-2 pr-3 text-right font-medium">Saíram</th>
                    <th className="py-2 pr-3 text-right font-medium">Ativos</th>
                    <th className="py-2 pr-3 text-right font-medium">Mediana</th>
                    <th className="py-2 text-right font-medium">Média restrita</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-slate-200">
                  {data.porAno.map((a) => (
                    <tr key={a.ano} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 font-semibold">{a.ano}{a.contratos < 60 ? <span className="ml-2 text-xs font-normal text-slate-500">poucos contratos</span> : null}</td>
                      <td className="py-2 pr-3 text-right">{num(a.contratos)}</td>
                      <td className="py-2 pr-3 text-right">{num(a.sairam)}</td>
                      <td className="py-2 pr-3 text-right">{num(a.ativos)}</td>
                      <td className="py-2 pr-3 text-right">{meses(a.medianaDias)}</td>
                      <td className="py-2 text-right">{meses(a.mediaRestritaDias)} <span className="text-xs text-slate-500">até {num(Math.round(a.ateDias))} d</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Secao>

          <p className="text-xs text-slate-500">
            Contratos de estágio de dna_work.conratacaovaga (vaga.tipo_vaga = 1). Início: data de início ou, sem ela, data da contratação. Descartados: {num(data.descartes.formato)} com data fora do formato,{" "}
            {num(data.descartes.demissaoAntesDoInicio)} com demissão antes do início, {num(data.descartes.encerradoSemDemissao)} encerrado(s) sem data de demissão
            {data.descartes.inicioFuturo ? `, ${num(data.descartes.inicioFuturo)} com início no futuro` : ""}. Mês = 30,44 dias.
          </p>
        </>
      ) : null}
    </div>
  );
}
