/** Aba CLT da página Métricas: contratações CLT, cobradas uma vez (sem mensalidade), e projeções. Sem métricas de tempo. */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alerta } from "@/components/pagina";
import { Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { COR, Indicador, Secao, dataBr, eixo, eixoReais, num, reais, rotuloMes, textoTooltip, tooltip } from "@/components/metricas";

type Ritmo = { meses: number; contratacoesPorMes: number; receitaPorMes: number };
type MesBase = { mes: string; receita: number; contratacoes: number };
type Janela = { de: string; ate: string; receita: number; contratacoes: number };
type MesProjetado = MesBase & { base: MesBase };
type Clt = {
  calculadoEm: string;
  periodo: { de: string | null; ate: string | null };
  lidos: number;
  validos: number;
  descartados: number;
  receita: {
    contratacoesComValor: number;
    semValor: number;
    total: number;
    porContratacao: number | null;
    salarioMedio: number | null;
    percentualMedio: number | null;
  };
  receitaMensal: Array<{ mes: string; receita: number; contratacoes: number }>;
  projecao: {
    ritmo12: Ritmo;
    ritmo3: Ritmo;
    tendencia: number | null;
    base: { ultimos12: Janela; anteriores12: Janela; fatorReceita: number; fatorContratacoes: number };
    mesAtual: { realizado: number; contratacoes: number; esperado: number; base: MesBase };
    proximos12: { receita: number; contratacoes: number };
    ano: { ano: number; realizado: number; contratacoes: number; faltaMesAtual: number; restoDoAno: number; fechamento: number };
    serie: MesProjetado[];
  };
};

const COR_PROJECAO = "rgba(103, 232, 249, 0.4)";
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const decimal = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fator = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const variacao = (v: number) => `${v >= 1 ? "+" : ""}${decimal((v - 1) * 100)}%`;
const faixaMeses = (j: Janela) => `${rotuloMes(j.de)} a ${rotuloMes(j.ate)}`;

/** Linha "como calculamos" embaixo de cada indicador. */
function Conta({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-3 text-[11px] leading-snug text-slate-500">{children}</p>;
}

export function MetricasClt({ de, ate, ativo }: { de: string; ate: string; ativo: boolean }) {
  const comPeriodo = Boolean(de || ate);
  const query = useQuery({
    queryKey: ["metricas-clt", de, ate],
    queryFn: () => {
      const busca = new URLSearchParams();
      if (de) busca.set("de", de);
      if (ate) busca.set("ate", ate);
      const texto = busca.toString();
      return api<Clt>(`/api/v1/metricas/contratacoes-clt${texto ? `?${texto}` : ""}`);
    },
    enabled: ativo,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
  });
  const data = query.data?.data;

  // Histórico do período + 12 meses projetados no ritmo dos últimos 12 meses (só quando o período chega ao mês atual).
  const grafico = useMemo(() => {
    if (!data) return [];
    const historico = data.receitaMensal.map((m) => ({ mes: m.mes, realizado: m.receita, projetado: null as number | null, contratacoes: m.contratacoes, base: null as MesBase | null }));
    const mesAtual = data.calculadoEm.slice(0, 7);
    const chegaHoje = !data.periodo.ate || data.periodo.ate.slice(0, 7) >= mesAtual;
    if (!chegaHoje) return historico;
    return [...historico, ...data.projecao.serie.map((m) => ({ mes: m.mes, realizado: null as number | null, projetado: m.receita, contratacoes: m.contratacoes, base: m.base as MesBase | null }))];
  }, [data]);

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <Alerta>Não foi possível calcular as métricas de CLT. Atualize a página; se continuar, avise o suporte.</Alerta>;
  if (!data) return null;
  const p = data.projecao;
  const tendencia = p.tendencia;
  return (
    <>
      <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Indicador titulo="Contratações" valor={num(data.validos)} detalhe={comPeriodo ? "que começaram no período" : `${num(data.descartados)} descartadas de ${num(data.lidos)}`} />
          <Indicador titulo="Receita das contratações" valor={reais(data.receita.total)} detalhe={`${num(data.receita.contratacoesComValor)} com taxa cadastrada`} className="border-l border-white/10" />
          <Indicador titulo="Receita média por contratação" valor={reais(data.receita.porContratacao)} detalhe="cobrada uma vez, na contratação" className="max-lg:border-t lg:border-l border-white/10" />
          <Indicador titulo="Taxa média sobre o salário" valor={pct(data.receita.percentualMedio)} detalhe={`salário médio ${reais(data.receita.salarioMedio)}`} className="border-l max-lg:border-t border-white/10" />
        </div>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
          {data.receita.semValor ? `${num(data.receita.semValor)} contratação(ões) de empresa sem taxa CLT cadastrada ficaram fora da receita. ` : ""}
          Salário médio e % só com salário mensal (vagas com salário por hora ficam de fora).
          {data.periodo.de || data.periodo.ate ? ` Período${data.periodo.de ? ` de ${dataBr(data.periodo.de)}` : ""}${data.periodo.ate ? ` até ${dataBr(data.periodo.ate)}` : ""}.` : ""} Calculado em {dataBr(data.calculadoEm)}.
        </p>
      </section>

      <Secao
        titulo="Projeções"
        texto="Quanto deve entrar com contratações CLT novas, se o próximo ano repetir o último: cada mês projetado parte do mesmo mês do último ano e é corrigido pela variação do último ano sobre o anterior. Não mudam com o filtro de período."
      >
        <p className="mb-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">
          Base: {faixaMeses(p.base.ultimos12)} rendeu <span className="tabular-nums text-white">{reais(p.base.ultimos12.receita)}</span> ({num(p.base.ultimos12.contratacoes)} contratações);
          {" "}{faixaMeses(p.base.anteriores12)} tinha rendido <span className="tabular-nums text-white">{reais(p.base.anteriores12.receita)}</span> ({num(p.base.anteriores12.contratacoes)}).
          {" "}Variação da receita: <span className="tabular-nums text-white">{reais(p.base.ultimos12.receita)} ÷ {reais(p.base.anteriores12.receita)} = {fator(p.base.fatorReceita)}</span> ({variacao(p.base.fatorReceita)}).
        </p>
        <div className="grid gap-px overflow-hidden rounded-lg bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[#12141a]">
            <Indicador titulo="Próximos 12 meses" valor={reais(p.proximos12.receita)} detalhe={`≈ ${num(Math.round(p.proximos12.contratacoes))} contratações, de ${rotuloMes(p.serie[0].mes)} a ${rotuloMes(p.serie[11].mes)}`} />
            <Conta>{reais(p.base.ultimos12.receita)} dos últimos 12 meses × {fator(p.base.fatorReceita)}. É a soma das barras claras do gráfico.</Conta>
          </div>
          <div className="bg-[#12141a]">
            <Indicador titulo={`Fechamento de ${p.ano.ano}`} valor={reais(p.ano.fechamento)} detalhe={`${reais(p.ano.realizado)} já realizados (${num(p.ano.contratacoes)} contratações)`} />
            <Conta>
              {reais(p.ano.realizado)} realizados + {reais(p.ano.faltaMesAtual)} que faltam para este mês chegar no esperado + {reais(p.ano.restoDoAno)} projetados no resto do ano.
            </Conta>
          </div>
          <div className="bg-[#12141a]">
            <Indicador titulo="Média por mês" valor={reais(p.ritmo12.receitaPorMes)} detalhe={`${decimal(p.ritmo12.contratacoesPorMes)} contratações por mês`} />
            <Conta>{reais(p.base.ultimos12.receita)} ÷ 12 meses ({faixaMeses(p.base.ultimos12)}).</Conta>
          </div>
          <div className="bg-[#12141a]">
            <Indicador
              titulo="Últimos 3 meses"
              valor={reais(p.ritmo3.receitaPorMes)}
              detalhe={tendencia == null ? "por mês" : `por mês · ${tendencia >= 0 ? "+" : ""}${decimal(tendencia)}% sobre a média de 12 meses`}
            />
            <Conta>Receita dos 3 últimos meses completos ÷ 3. Mostra se o ritmo recente está acima ou abaixo da média.</Conta>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Este mês até agora: <span className="tabular-nums text-slate-200">{reais(p.mesAtual.realizado)}</span> em {num(p.mesAtual.contratacoes)} {p.mesAtual.contratacoes === 1 ? "contratação" : "contratações"}, contra{" "}
          <span className="tabular-nums text-slate-200">{reais(p.mesAtual.esperado)}</span> esperados ({rotuloMes(p.mesAtual.base.mes)}: {reais(p.mesAtual.base.receita)} × {fator(p.base.fatorReceita)}).
          {" "}Contratação CLT oscila muito de um mês para o outro; use as projeções como ordem de grandeza, não como meta.
        </p>
      </Secao>

      {grafico.length ? (
        <Secao titulo="Receita por mês" texto="Taxa de cada contratação CLT no mês em que ela começou (a mesma regra do Faturamento: % do salário ou valor fixo). Barras claras: projeção dos próximos 12 meses (mesmo mês do último ano × variação do último ano). Passe o mouse para ver a conta de cada mês.">
          <p className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COR }} /> Realizado</span>
            <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_PROJECAO }} /> Projeção</span>
          </p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={grafico} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="mes" {...eixo} tickFormatter={rotuloMes} minTickGap={24} />
                <YAxis {...eixo} width={64} tickFormatter={eixoReais} />
                <Tooltip
                  contentStyle={tooltip} itemStyle={textoTooltip}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  labelFormatter={(mes) => rotuloMes(String(mes))}
                  formatter={(v, nome, item) => {
                    const linha = item.payload as { contratacoes: number; base: MesBase | null };
                    if (nome === "projetado" && linha.base) {
                      return [`${reais(Number(v))} · ≈ ${decimal(linha.contratacoes)} contratações (${rotuloMes(linha.base.mes)}: ${reais(linha.base.receita)} × ${fator(p.base.fatorReceita)})`, "Projeção"];
                    }
                    return [`${reais(Number(v))} · ${num(linha.contratacoes)} ${linha.contratacoes === 1 ? "contratação" : "contratações"}`, "Realizado"];
                  }}
                />
                <Bar dataKey="realizado" stackId="r" fill={COR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="projetado" stackId="r" fill={COR_PROJECAO} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>
      ) : null}

      {data.validos === 0 ? <p className="text-sm text-slate-400">Nenhuma contratação CLT começou nesse período.</p> : null}

      <p className="text-xs text-slate-500">
        Contratações CLT de dna_work.conratacaovaga (vaga.tipo_vaga = 2), pela data de início (ou, sem ela, a da contratação). {num(data.descartados)} descartada(s) por data inválida.
      </p>
    </>
  );
}
