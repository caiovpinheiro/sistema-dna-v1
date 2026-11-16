/** Aba CLT da página Métricas: contratações CLT, cobradas uma vez (sem mensalidade). */
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alerta } from "@/components/pagina";
import { Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import {
  COR, CurvaPermanencia, FaixasSaida, Indicador, NotaDescartes, Secao, TabelaPorAno,
  dataBr, diasTxt, eixo, eixoReais, meses, num, reais, rotuloMes, tooltip, type ResumoPermanencia,
} from "@/components/metricas";

type Clt = ResumoPermanencia & {
  periodo: { de: string | null; ate: string | null };
  receita: {
    contratacoesComValor: number;
    semValor: number;
    total: number;
    porContratacao: number | null;
    salarioMedio: number | null;
    percentualMedio: number | null;
  };
  receitaMensal: Array<{ mes: string; receita: number; contratacoes: number }>;
};

const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

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

  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError) return <Alerta>Não foi possível calcular as métricas de CLT. Atualize a página; se continuar, avise o suporte.</Alerta>;
  if (!data) return null;
  return (
    <>
      <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Indicador titulo="Contratações" valor={num(data.validos)} detalhe={comPeriodo ? "que começaram no período" : `${num(data.descartados)} descartadas de ${num(data.lidos)}`} />
          <Indicador titulo="Receita das contratações" valor={reais(data.receita.total)} detalhe={`${num(data.receita.contratacoesComValor)} com taxa cadastrada`} className="border-l border-white/10" />
          <Indicador titulo="Receita média por contratação" valor={reais(data.receita.porContratacao)} detalhe="cobrada uma vez, na contratação" className="max-lg:border-t lg:border-l border-white/10" />
          <Indicador titulo="Ainda contratados" valor={num(data.geral.ativos)} detalhe="contratações CLT em andamento" className="border-l max-lg:border-t border-white/10" />
        </div>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
          Salário médio das contratações com taxa: <span className="tabular-nums text-slate-200">{reais(data.receita.salarioMedio)}</span>; a taxa equivale, em média, a{" "}
          <span className="tabular-nums text-slate-200">{pct(data.receita.percentualMedio)}</span> do salário.
          {data.receita.semValor ? ` ${num(data.receita.semValor)} contratação(ões) de empresa sem taxa CLT cadastrada ficaram fora da receita.` : ""}
          {data.periodo.de || data.periodo.ate ? ` Período${data.periodo.de ? ` de ${dataBr(data.periodo.de)}` : ""}${data.periodo.ate ? ` até ${dataBr(data.periodo.ate)}` : ""}.` : ""} Calculado em {dataBr(data.calculadoEm)}.
        </p>
      </section>

      {data.validos === 0 ? <p className="text-sm text-slate-400">Nenhuma contratação CLT começou nesse período.</p> : null}

      {data.receitaMensal.length ? (
        <Secao titulo="Receita por mês" texto="Taxa de cada contratação CLT no mês em que ela começou (a mesma regra do Faturamento: % do salário ou valor fixo). Não há mensalidade nem projeção.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.receitaMensal} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap={1}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="mes" {...eixo} tickFormatter={rotuloMes} minTickGap={24} />
                <YAxis {...eixo} width={64} tickFormatter={eixoReais} />
                <Tooltip
                  contentStyle={tooltip}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  labelFormatter={(mes) => rotuloMes(String(mes))}
                  formatter={(v, _n, item) => {
                    const linha = item.payload as { contratacoes: number };
                    return [`${reais(Number(v))} · ${num(linha.contratacoes)} ${linha.contratacoes === 1 ? "contratação" : "contratações"}`, "Receita"];
                  }}
                />
                <Bar dataKey="receita" fill={COR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>
      ) : null}

      <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
        <div className="grid grid-cols-2">
          <Indicador titulo="Permanência média" valor={meses(data.geral.mediaRestritaDias)} detalhe={`${diasTxt(data.geral.mediaRestritaDias)} · média restrita`} />
          <Indicador titulo="Metade sai antes de" valor={meses(data.geral.medianaDias)} detalhe={`${diasTxt(data.geral.medianaDias)} · mediana`} className="border-l border-white/10" />
        </div>
        <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
          Quanto tempo o contratado CLT fica na empresa, pelo mesmo método do estágio (Kaplan-Meier), sem o limite de 24 meses. Não muda a receita, que é cobrada uma vez.
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <CurvaPermanencia data={data} mesesMax={36} texto="% dos contratados CLT que ainda não saíram depois de X meses, até 36 meses. A linha tracejada marca 50%." />
        </div>
        <div className="xl:col-span-2"><FaixasSaida data={data} /></div>
      </div>

      <TabelaPorAno data={data} minimo={20} />

      <NotaDescartes data={data} origem="Contratações CLT de dna_work.conratacaovaga (vaga.tipo_vaga = 2)." />
    </>
  );
}
