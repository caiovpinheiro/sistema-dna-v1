/** Peças comuns às abas Estágio e CLT da página Métricas (pages/MetricasPage.tsx). */
import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/components/ui";
import { api } from "@/lib/api";

export const DIAS_POR_MES = 30.44;

export type Km = { contratos: number; sairam: number; ativos: number; medianaDias: number | null; mediaRestritaDias: number; ateDias: number };
export type Descartes = { formato: number; demissaoAntesDoInicio: number; encerradoSemDemissao: number; inicioFuturo: number; outroStatus: number };
/** Parte da resposta que estágio e CLT têm em comum (resumoPermanencia no backend). */
export type ResumoPermanencia = {
  calculadoEm: string;
  lidos: number;
  foraDoPeriodo: number;
  validos: number;
  descartados: number;
  descartes: Descartes;
  geral: Km & { curva: Array<{ dias: number; permanecem: number }> };
  encerrados: { total: number; mediaDias: number | null; medianaDias: number | null; faixas: Array<{ faixa: string; total: number }> };
  porAno: Array<Km & { ano: number }>;
};

export type Modo = "inicio" | "ativos";
/** Resposta de GET /api/v1/metricas/permanencia-estagio. */
export type PermanenciaEstagio = ResumoPermanencia & {
  periodo: { de: string | null; ate: string | null; modo: Modo };
  receita: {
    contratosComValor: number;
    semValor: number;
    mensalMedio: number | null;
    rsMedio: number | null;
    mesesMedios: number;
    porEstagiario: number | null;
    estimadoPeriodo: number | null;
    realizado: number;
  };
  receitaMensal: Array<{ mes: string; realizado: number | null; projetado: number | null; estagiarios: number; mesesCheios: number; rs: number }>;
  /** Base para simular novas contratações (aba Geral). permanencia[k] = fração que continua k meses depois de começar. */
  simulacao: { contratacoesPorMes: number; mensalMedio: number; rsMedio: number; permanencia: number[] };
};

/** Consulta da aba Estágio (a aba Geral usa a mesma, com o mesmo cache). */
export function useMetricasEstagio(de: string, ate: string, modo: Modo, ativo: boolean) {
  return useQuery({
    queryKey: ["metricas-permanencia", de, ate, modo],
    queryFn: () => {
      const busca = new URLSearchParams();
      if (de) busca.set("de", de);
      if (ate) busca.set("ate", ate);
      if (modo === "ativos") busca.set("modo", "ativos");
      const texto = busca.toString();
      return api<PermanenciaEstagio>(`/api/v1/metricas/permanencia-estagio${texto ? `?${texto}` : ""}`);
    },
    enabled: ativo,
    staleTime: 5 * 60_000,
    placeholderData: (anterior) => anterior,
  });
}

export const tooltip = { background: "#15181e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e7e9ee", fontSize: 12 };
/** Texto das dicas sempre na cor de texto: a cor da série (ex.: a barra clara da projeção) fica ilegível no fundo escuro. */
export const textoTooltip = { color: "#e7e9ee" };
export const eixo = { stroke: "#8b95a7", fontSize: 11, tickLine: false, axisLine: false } as const;
export const COR = "#67e8f9";
const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;

export const meses = (dias: number | null) => (dias == null ? "—" : `${(dias / DIAS_POR_MES).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} meses`);
export const diasTxt = (dias: number | null) => (dias == null ? "não atingida" : `${Math.round(dias).toLocaleString("pt-BR")} dias`);
export const num = (valor: number) => valor.toLocaleString("pt-BR");
export const reais = (valor: number | null) => (valor == null ? "—" : valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: valor >= 10_000 ? 0 : 2 }));
export const dataBr = (iso: string) => iso.split("-").reverse().join("/");
export const eixoReais = (v: number) => `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;

export function Indicador({ titulo, valor, detalhe, className }: { titulo: string; valor: string; detalhe: string; className?: string }) {
  return (
    <article className={cn("min-w-0 px-4 py-3", className)}>
      <p className="text-[13px] text-slate-400">{titulo}</p>
      <p className="mt-1 text-2xl font-medium leading-none tabular-nums tracking-tight text-white">{valor}</p>
      <p className="mt-1 text-xs text-slate-400">{detalhe}</p>
    </article>
  );
}

export function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold text-white">{titulo}</h2>
      {texto ? <p className="mt-0.5 text-xs text-slate-400">{texto}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Curva de Kaplan-Meier em degraus, em meses e %, cortada em `mesesMax`. */
export function CurvaPermanencia({ data, mesesMax, texto }: { data: ResumoPermanencia; mesesMax: number; texto: string }) {
  const pontos = useMemo(() => {
    const porDia = new Map<number, number>();
    const limite = mesesMax * DIAS_POR_MES;
    for (const p of data.geral.curva) if (p.dias <= limite) porDia.set(Math.round(p.dias), p.permanecem);
    const lista = [...porDia].map(([dias, s]) => ({ meses: dias / DIAS_POR_MES, permanecem: Math.round(s * 1000) / 10 }));
    // A linha segue reta até o fim do eixo ou até o último tempo observado, o que vier antes.
    lista.push({ meses: Math.min(data.geral.ateDias, limite) / DIAS_POR_MES, permanecem: lista[lista.length - 1]?.permanecem ?? 100 });
    return lista;
  }, [data, mesesMax]);
  const passo = mesesMax <= 24 ? 3 : 6;
  const ticks = Array.from({ length: mesesMax / passo + 1 }, (_, i) => i * passo);
  return (
    <Secao titulo="Quantos continuam contratados com o tempo" texto={texto}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pontos} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="meses" type="number" domain={[0, mesesMax]} ticks={ticks} allowDataOverflow {...eixo} tickFormatter={(v: number) => `${v} ${v === 1 ? "mês" : "meses"}`} />
            <YAxis {...eixo} domain={[0, 100]} width={36} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine y={50} stroke="#8b95a7" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={tooltip} itemStyle={textoTooltip}
              labelFormatter={(v) => `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} meses`}
              formatter={(v) => [`${Number(v).toLocaleString("pt-BR")}%`, "Ainda contratados"]}
            />
            <Line type="stepAfter" dataKey="permanecem" stroke={COR} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Secao>
  );
}

export function FaixasSaida({ data }: { data: ResumoPermanencia }) {
  const faixas = useMemo(() => {
    const total = data.encerrados.total || 1;
    return data.encerrados.faixas.map((f) => ({ ...f, pct: Math.round((f.total / total) * 1000) / 10 }));
  }, [data]);
  return (
    <Secao titulo="Tempo de quem já saiu" texto={`${num(data.encerrados.total)} contratos encerrados, por faixa de permanência.`}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={faixas} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis type="number" {...eixo} allowDecimals={false} />
            <YAxis type="category" dataKey="faixa" {...eixo} width={92} />
            <Tooltip contentStyle={tooltip} itemStyle={textoTooltip} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v, _n, item) => [`${num(Number(v))} (${(item.payload as { pct: number }).pct.toLocaleString("pt-BR")}%)`, "Contratos"]} />
            <Bar dataKey="total" fill={COR} barSize={14} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Secao>
  );
}

export function TabelaPorAno({ data, minimo = 60 }: { data: ResumoPermanencia; minimo?: number }) {
  return (
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
                <td className="py-2 pr-3 font-semibold">{a.ano}{a.contratos < minimo ? <span className="ml-2 text-xs font-normal text-slate-500">poucos contratos</span> : null}</td>
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
  );
}

export function NotaDescartes({ data, origem }: { data: ResumoPermanencia; origem: string }) {
  return (
    <p className="text-xs text-slate-500">
      {origem} Início: data de início ou, sem ela, data da contratação. Descartados: {num(data.descartes.formato)} com data fora do formato,{" "}
      {num(data.descartes.demissaoAntesDoInicio)} com demissão antes do início, {num(data.descartes.encerradoSemDemissao)} encerrado(s) sem data de demissão
      {data.descartes.inicioFuturo ? `, ${num(data.descartes.inicioFuturo)} com início no futuro` : ""}. Mês = 30,44 dias.
    </p>
  );
}
