import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  COR, CurvaPermanencia, DIAS_POR_MES, FaixasSaida, Indicador, NotaDescartes, Secao, TabelaPorAno,
  dataBr, diasTxt, eixo, eixoReais, meses, num, reais, rotuloMes, textoTooltip, tooltip, type ResumoPermanencia,
} from "@/components/metricas";
import { MetricasClt } from "@/components/metricas-clt";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";

type Modo = "inicio" | "ativos";
type Tipo = "estagio" | "clt";
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
type Permanencia = ResumoPermanencia & {
  periodo: { de: string | null; ate: string | null; modo: Modo };
  receita: Receita;
  receitaMensal: Array<{ mes: string; realizado: number | null; projetado: number | null; estagiarios: number; mesesCheios: number }>;
};

/** Pela lei do estágio (Lei 11.788/2008, art. 11), o contrato na mesma empresa não passa de 2 anos. */
const MESES_MAXIMOS = 24;
const COR_PROJECAO = "rgba(103, 232, 249, 0.4)";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Atalhos de período. */
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

const DESCRICAO: Record<Tipo, string> = {
  estagio: "Quanto tempo os estagiários ficam contratados e quanto eles rendem. Calculado pelo método Kaplan-Meier: quem ainda está ativo conta como “ainda não saiu”, para a média não ficar abaixo da real.",
  clt: "Contratações CLT e quanto elas rendem. A taxa é cobrada uma vez, no mês da contratação (% do salário ou valor fixo), sem mensalidade.",
};

/** Métricas de estágio e CLT. Página só para o administrador. */
export function MetricasPage() {
  const [params, setParams] = useSearchParams();
  const tipo: Tipo = params.get("tipo") === "clt" ? "clt" : "estagio";
  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";
  const comPeriodo = Boolean(de || ate);
  const modo: Modo = params.get("modo") === "ativos" ? "ativos" : "inicio";
  const invertido = Boolean(de && ate && de > ate);

  function trocar(mudancas: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) next.set(chave, valor); else next.delete(chave);
    }
    setParams(next, { replace: true });
  }

  return (
    <div className="grid gap-5">
      <CabecalhoPagina titulo="Métricas" descricao={DESCRICAO[tipo]} />
      <div className="flex w-fit rounded-xl bg-[#12141a] p-1 ring-1 ring-white/10" role="tablist" aria-label="Tipo de contratação">
        {([["estagio", "Estágio"], ["clt", "CLT"]] as const).map(([valor, rotulo]) => (
          <button key={valor} type="button" role="tab" aria-selected={tipo === valor} onClick={() => trocar({ tipo: valor === "clt" ? "clt" : "" })}
            className={cn("h-9 rounded-lg px-5 text-sm", tipo === valor ? "bg-cyan-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10")}>
            {rotulo}
          </button>
        ))}
      </div>
      <section className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl bg-[#12141a] px-4 py-3 ring-1 ring-white/10">
        <div className="grid gap-1">
          <span className="text-xs text-slate-400">{tipo === "estagio" && comPeriodo && modo === "ativos" ? "Contratos ativos entre" : "Contratos que começaram"}</span>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Início do período" type="date" value={de} max={ate || undefined} onChange={(e) => trocar({ de: e.target.value })} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
            <span className="text-sm text-slate-400">até</span>
            <input aria-label="Fim do período" type="date" value={ate} min={de || undefined} onChange={(e) => trocar({ ate: e.target.value })} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {atalhos().map((a) => {
            const ativo = a.de === de && a.ate === ate;
            return (
              <button key={a.rotulo} type="button" aria-pressed={ativo} onClick={() => trocar({ de: a.de, ate: a.ate })}
                className={cn("h-8 rounded-lg px-3 text-sm", ativo ? "bg-cyan-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10")}>
                {a.rotulo}
              </button>
            );
          })}
        </div>
        {tipo === "estagio" && comPeriodo ? (
          <div className="grid gap-1">
            <span className="text-xs text-slate-400">Considerar</span>
            <div className="flex rounded-lg bg-white/5 p-0.5" role="group" aria-label="Quais contratos considerar">
              {([["inicio", "Só quem entrou no período"], ["ativos", "Todos ativos no período"]] as const).map(([valor, rotulo]) => (
                <button key={valor} type="button" aria-pressed={modo === valor} onClick={() => trocar({ modo: valor === "ativos" ? "ativos" : "" })}
                  className={cn("h-7 rounded-md px-3 text-sm", modo === valor ? "bg-cyan-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10")}>
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {tipo === "estagio" && comPeriodo ? (
          <p className="w-full text-xs text-slate-500">
            {modo === "inicio"
              ? "Entram só os contratos que começaram no período. A receita por mês mostra só o que eles renderam."
              : "Entram todos que estiveram contratados em algum dia do período, inclusive quem começou antes. A receita por mês fica igual à de “Tudo”; a permanência tende a ficar maior, porque contratos longos têm mais chance de cruzar o período."}
          </p>
        ) : null}
        {tipo === "clt" && comPeriodo ? <p className="w-full text-xs text-slate-500">Entram as contratações CLT que começaram no período, porque a taxa é cobrada nesse mês.</p> : null}
        {invertido ? <p className="w-full text-xs text-rose-300">A data inicial é depois da final.</p> : null}
      </section>
      {tipo === "estagio"
        ? <MetricasEstagio de={de} ate={ate} modo={comPeriodo ? modo : "inicio"} ativo={!invertido} comPeriodo={comPeriodo} />
        : <MetricasClt de={de} ate={ate} ativo={!invertido} />}
    </div>
  );
}

/** Aba Estágio: permanência (Kaplan-Meier, até 24 meses) e receita recorrente. */
function MetricasEstagio({ de, ate, modo, ativo, comPeriodo }: { de: string; ate: string; modo: Modo; ativo: boolean; comPeriodo: boolean }) {
  const query = useQuery({
    queryKey: ["metricas-permanencia", de, ate, modo],
    queryFn: () => {
      const busca = new URLSearchParams();
      if (de) busca.set("de", de);
      if (ate) busca.set("ate", ate);
      if (modo === "ativos") busca.set("modo", "ativos");
      const texto = busca.toString();
      return api<Permanencia>(`/api/v1/metricas/permanencia-estagio${texto ? `?${texto}` : ""}`);
    },
    enabled: ativo,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
  });
  const data = query.data?.data;

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <Alerta>Não foi possível calcular as métricas. Atualize a página; se continuar, avise o suporte.</Alerta>;
  if (!data) return null;
  return (
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
                <YAxis {...eixo} width={64} tickFormatter={eixoReais} />
                <Tooltip
                  contentStyle={tooltip} itemStyle={textoTooltip}
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
          <CurvaPermanencia data={data} mesesMax={MESES_MAXIMOS} texto="% dos estagiários que ainda não saíram depois de X meses, até 24 meses (limite do contrato de estágio na mesma empresa). A linha tracejada marca 50%." />
        </div>
        <div className="xl:col-span-2"><FaixasSaida data={data} /></div>
      </div>

      <TabelaPorAno data={data} />

      <NotaDescartes data={data} origem="Contratos de estágio de dna_work.conratacaovaga (vaga.tipo_vaga = 1)." />
    </>
  );
}
