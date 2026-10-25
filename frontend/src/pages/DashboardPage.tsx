import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, regimeLabel } from "@/lib/format";

type Contagem = { atual: number; anterior: number };
type Dashboard = {
  periodo: { inicio: string; fim: string; dias: number };
  candidatos_base: number;
  candidatos_sem_data: number;
  empresas_base: number;
  vagas_abertas_agora: number;
  contratacoes_ativas_agora: number;
  posicoes: { disponivel: boolean; total: number | null; com_capacidade: number; sem_capacidade: number; motivo: string | null };
  origem: {
    encaminhados_dnawork: Contagem;
    recebidos_empresa: Contagem;
    entrevistas: Contagem;
    contratacoes: Array<{ origem: string; total: number }>;
    conversao_dnawork: number | null;
    conversao_empresa: number | null;
  };
  cadastrados: Contagem;
  vagas_cadastradas: Contagem;
  vagas_abertas_periodo: Contagem;
  contratacoes: Contagem;
  encaminhamentos: Contagem;
  empresas_movimento: Contagem;
  regimes: Array<{ regime: string; total: number }>;
  serie: Array<{ dia: string; vagas: number; contratacoes: number }>;
  serie_origem: Array<{ dia: string; dnawork: number; empresa: number; entrevistas: number }>;
  ranking: Array<{ empresa: string; total: number }>;
  ultimas_contratacoes: Array<{ id_contratacao: number; candidato_nome: string | null; empresa_fantasia: string | null; empresa_razao: string | null; cargo: string | null; regime: string; data_contratacao: string | null; data_inicio: string | null; situacao: string }>;
};

const tooltip = { background: "#15181e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e7e9ee", fontSize: 12 };
const eixo = { stroke: "#8b95a7", fontSize: 11, tickLine: false, axisLine: false } as const;
const origemNome: Record<string, string> = { dnawork: "DNAWORK", empresa: "Empresa", nao_identificado: "Não identificado" };

export function DashboardPage() {
  const [dias, setDias] = useState<number | null>(30);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const personalizado = dias == null && de && ate;
  const query = useQuery({
    queryKey: ["dashboard", dias, de, ate],
    queryFn: () => api<Dashboard>(personalizado ? `/api/v1/dashboard?de=${de}&ate=${ate}` : `/api/v1/dashboard?dias=${dias ?? 30}`),
    enabled: dias != null || Boolean(de && ate),
  });
  const data = query.data?.data;
  const primarios = data
    ? [
        { titulo: "Vagas cadastradas", valor: data.vagas_cadastradas },
        { titulo: "Contratações realizadas", valor: data.contratacoes },
        { titulo: "Candidatos cadastrados", valor: data.cadastrados },
        { titulo: "Empresas com movimentação", valor: data.empresas_movimento },
      ]
    : [];
  const maxRanking = data?.ranking.reduce((maior, item) => Math.max(maior, item.total), 0) ?? 0;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Painel</h1>
          <p className="text-sm text-slate-400">{data ? `${dateBr(data.periodo.inicio)} a ${dateBr(somar(data.periodo.fim, -1))}` : "Movimento do período"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map((valor) => (
            <button
              key={valor}
              type="button"
              aria-pressed={dias === valor}
              className={`rounded-lg px-3 py-1.5 text-sm ${dias === valor ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:bg-white/5"}`}
              onClick={() => { setDias(valor); setDe(""); setAte(""); }}
            >
              {valor} dias
            </button>
          ))}
          <input aria-label="Data inicial" type="date" value={de} onChange={(event) => { setDe(event.target.value); setDias(null); }} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
          <input aria-label="Data final" type="date" value={ate} onChange={(event) => { setAte(event.target.value); setDias(null); }} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white [color-scheme:dark]" />
        </div>
      </div>
      {query.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 bg-[#12141a]" />
          <Skeleton className="h-40 bg-[#12141a]" />
        </div>
      ) : null}
      {query.isError ? <p className="text-sm text-rose-300">Não foi possível carregar os indicadores.</p> : null}
      {data ? (
        <>
          <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <div className="grid grid-cols-2 lg:grid-cols-4">
              {primarios.map((item, index) => (
                <article
                  key={item.titulo}
                  className={cn(
                    "min-w-0 px-4 py-3",
                    index > 0 && "lg:border-l lg:border-white/10",
                    index % 2 === 1 && "max-lg:border-l max-lg:border-white/10",
                    index > 1 && "max-lg:border-t max-lg:border-white/10",
                  )}
                >
                  <p className="text-[13px] text-slate-400">{item.titulo}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-2xl font-medium leading-none tabular-nums tracking-tight text-white">{item.valor.atual.toLocaleString("pt-BR")}</span>
                    <span className="text-xs tabular-nums text-slate-500">{deltaDe(item.valor)} vs anterior</span>
                  </p>
                </article>
              ))}
            </div>
            <p className="flex flex-wrap gap-x-5 gap-y-1 border-t border-white/10 px-4 py-2 text-xs text-slate-400">
              <span><span className="tabular-nums text-slate-200">{data.vagas_abertas_agora.toLocaleString("pt-BR")}</span> {data.vagas_abertas_agora === 1 ? "vaga aberta agora" : "vagas abertas agora"}</span>
              <span><span className="tabular-nums text-slate-200">{data.vagas_abertas_periodo.atual.toLocaleString("pt-BR")}</span> {data.vagas_abertas_periodo.atual === 1 ? "vaga aberta com cadastro no período" : "vagas abertas com cadastro no período"} <span className="text-slate-500">{deltaDe(data.vagas_abertas_periodo)} vs anterior</span></span>
            </p>
          </section>

          <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <div className="grid lg:grid-cols-5">
              <div className="min-w-0 p-3 lg:col-span-3 lg:border-r lg:border-white/10">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">Vagas e contratações</h2>
                  <p className="flex flex-wrap gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-0.5 w-3 rounded-full bg-[#67e8f9]" /> Vagas cadastradas</span>
                    <span className="inline-flex items-center gap-1.5"><i aria-hidden className="h-0.5 w-3 rounded-full bg-[#d8b4fe]" /> Contratações</span>
                  </p>
                </div>
                {data.serie.every((item) => item.vagas === 0 && item.contratacoes === 0) ? <Vazio /> : (
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.serie} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="dia" {...eixo} minTickGap={28} />
                        <YAxis {...eixo} allowDecimals={false} width={28} />
                        <Tooltip contentStyle={tooltip} />
                        <Line dataKey="vagas" name="Vagas cadastradas" stroke="#67e8f9" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="contratacoes" name="Contratações" stroke="#d8b4fe" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="min-w-0 border-t border-white/10 p-3 lg:col-span-2 lg:border-t-0">
                <h2 className="mb-2 text-sm font-semibold text-white">CLT e estágio</h2>
                {data.regimes.length === 0 ? <Vazio /> : (
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.regimes} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                        <XAxis type="number" {...eixo} allowDecimals={false} />
                        <YAxis type="category" dataKey="regime" {...eixo} width={108} />
                        <Tooltip contentStyle={tooltip} />
                        <Bar dataKey="total" name="Contratações" fill="#67e8f9" barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-white/10 p-3">
              <h2 className="mb-2 text-sm font-semibold text-white">Empresas que mais contrataram</h2>
              {data.ranking.length === 0 ? <Vazio /> : (
                <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  {data.ranking.map((item) => (
                    <li key={item.empresa} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-200">{item.empresa}</p>
                        <div className="mt-1 h-1 rounded-full bg-white/10">
                          <div className="h-1 rounded-full bg-[#22d3ee]" style={{ width: `${maxRanking === 0 ? 0 : (item.total / maxRanking) * 100}%` }} />
                        </div>
                      </div>
                      <span className="tabular-nums text-sm text-white">{item.total.toLocaleString("pt-BR")}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <h2 className="px-4 pt-3 text-sm font-semibold text-white">Análise detalhada</h2>
            <dl className="grid gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2 xl:grid-cols-3">
              <Medida titulo="Encaminhados pela DNAWORK" valor={data.origem.encaminhados_dnawork} />
              <Medida titulo="Candidatos recebidos das empresas" valor={data.origem.recebidos_empresa} />
              <Medida titulo="Entrevistas realizadas" valor={data.origem.entrevistas} />
              <Conversao titulo="Conversão DNAWORK" taxa={data.origem.conversao_dnawork} />
              <Conversao titulo="Conversão da empresa" taxa={data.origem.conversao_empresa} />
              {data.posicoes.disponivel ? (
                <div>
                  <dt className="text-xs text-slate-400">Posições disponíveis</dt>
                  <dd className="mt-0.5 text-lg font-medium leading-none tabular-nums text-white">{(data.posicoes.total ?? 0).toLocaleString("pt-BR")}</dd>
                  {data.posicoes.sem_capacidade > 0 ? <p className="mt-1 text-xs text-slate-500">{contagem(data.posicoes.sem_capacidade, "vaga aberta ainda sem quantidade definida", "vagas abertas ainda sem quantidade definida")}.</p> : null}
                </div>
              ) : (
                <Indisponivel titulo="Posições disponíveis" nota={data.posicoes.motivo ?? "Nenhuma vaga aberta tem a quantidade de posições preenchida."} />
              )}
            </dl>
            <div className="grid gap-4 border-t border-white/10 p-3 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-2 text-[13px] font-semibold text-slate-200">Origem no período</h3>
                {data.serie_origem.every((item) => item.dnawork === 0 && item.empresa === 0 && item.entrevistas === 0) ? <Vazio /> : (
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.serie_origem} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="dia" {...eixo} minTickGap={28} />
                        <YAxis {...eixo} allowDecimals={false} width={28} />
                        <Tooltip contentStyle={tooltip} />
                        <Line dataKey="dnawork" name="Encaminhados pela DNAWORK" stroke="#67e8f9" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="empresa" name="Recebidos das empresas" stroke="#d8b4fe" strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line dataKey="entrevistas" name="Entrevistas realizadas" stroke="#f4f6f8" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-[13px] font-semibold text-slate-200">Contratações por origem</h3>
                {data.origem.contratacoes.every((item) => item.total === 0) ? <Vazio /> : (
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.origem.contratacoes.map((item) => ({ ...item, nome: origemNome[item.origem] ?? item.origem }))} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
                        <XAxis type="number" {...eixo} allowDecimals={false} />
                        <YAxis type="category" dataKey="nome" {...eixo} width={108} />
                        <Tooltip contentStyle={tooltip} />
                        <Bar dataKey="total" name="Contratações" fill="#67e8f9" barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
            <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-500">
              Registro antigo de entrevistas, sem origem: <span className="tabular-nums text-slate-300">{data.encaminhamentos.atual.toLocaleString("pt-BR")}</span> no período ({deltaDe(data.encaminhamentos)} vs anterior).
            </p>
            <p className="px-4 pb-3 text-xs text-slate-500">
              {contagem(data.candidatos_sem_data, "candidato sem data de inclusão fica fora do período", "candidatos sem data de inclusão ficam fora do período")}. A base tem {contagem(data.candidatos_base, "registro", "registros")} e {contagem(data.empresas_base, "empresa", "empresas")}. {contagem(data.contratacoes_ativas_agora, "vínculo ativo agora", "vínculos ativos agora")}.
            </p>
          </section>

          <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Contratações recentes</h2>
                <p className="text-xs text-slate-500">Mais recentes da base, fora do período.</p>
              </div>
              <Link className="text-sm font-semibold text-cyan-300" to="/contratacoes">Ver todas</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table compact">
                <thead>
                  <tr><th>Candidato</th><th>Empresa</th><th>Cargo</th><th>Regime</th><th>Contratação</th><th>Início</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {data.ultimas_contratacoes.length === 0 ? <tr><td className="text-slate-400" colSpan={7}>Nenhuma contratação registrada.</td></tr> : data.ultimas_contratacoes.map((item) => (
                    <tr key={item.id_contratacao}>
                      <td><Link to={`/contratacoes/${item.id_contratacao}`}>{item.candidato_nome}</Link></td>
                      <td>{item.empresa_fantasia || item.empresa_razao}</td>
                      <td>{item.cargo}</td>
                      <td>{regimeLabel[item.regime] ?? item.regime}</td>
                      <td className="tabular-nums">{dateBr(item.data_contratacao)}</td>
                      <td className="tabular-nums">{dateBr(item.data_inicio)}</td>
                      <td><Badge value={item.situacao}>{item.situacao === "ativa" ? "Ativa" : item.situacao === "encerrada" ? "Encerrada" : "Não identificada"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Medida({ titulo, valor }: { titulo: string; valor: Contagem }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{titulo}</dt>
      <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-lg font-medium leading-none tabular-nums text-white">{valor.atual.toLocaleString("pt-BR")}</span>
        <span className="text-xs tabular-nums text-slate-500">{deltaDe(valor)} vs anterior</span>
      </dd>
    </div>
  );
}

function Conversao({ titulo, taxa }: { titulo: string; taxa: number | null }) {
  if (taxa == null) return <Indisponivel titulo={titulo} nota="Entradas insuficientes no período." />;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{titulo}</dt>
      <dd className="mt-0.5 text-lg font-medium leading-none tabular-nums text-white">{taxa.toLocaleString("pt-BR")}%</dd>
    </div>
  );
}

function Indisponivel({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{titulo}</dt>
      <dd className="mt-0.5 text-sm text-slate-300">Dados indisponíveis</dd>
      <p className="mt-0.5 text-xs text-slate-500">{nota}</p>
    </div>
  );
}

function Vazio() {
  return <p className="text-sm text-slate-400">Nenhum movimento neste período.</p>;
}

function contagem(valor: number, singular: string, plural: string) {
  return `${valor.toLocaleString("pt-BR")} ${valor === 1 ? singular : plural}`;
}

function deltaDe(valor: Contagem) {
  const delta = valor.atual - valor.anterior;
  return `${delta > 0 ? "+" : ""}${delta.toLocaleString("pt-BR")}`;
}

function somar(iso: string, dias: number) {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}
