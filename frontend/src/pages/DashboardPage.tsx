import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Skeleton } from "@/components/ui";
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

const tooltip = { background: "#15181e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e7e9ee" };

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

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Painel</h1>
          <p className="text-sm text-slate-400">{data ? `${dateBr(data.periodo.inicio)} a ${dateBr(somar(data.periodo.fim, -1))}` : "Movimento do período"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map((valor) => (
            <button key={valor} type="button" className={`rounded-lg px-3 py-1.5 text-sm ${dias === valor ? "bg-cyan-400/15 text-cyan-200" : "text-slate-400 hover:bg-white/5"}`} onClick={() => { setDias(valor); setDe(""); setAte(""); }}>{valor} dias</button>
          ))}
          <input aria-label="Data inicial" type="date" value={de} onChange={(event) => { setDe(event.target.value); setDias(null); }} className="h-9 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white" />
          <input aria-label="Data final" type="date" value={ate} onChange={(event) => { setAte(event.target.value); setDias(null); }} className="h-9 rounded-lg border border-white/10 bg-white/5 px-2 text-sm text-white" />
        </div>
      </div>
      {query.isLoading ? <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 bg-[#12141a]" />)}</div> : null}
      {query.isError ? <p className="text-sm text-rose-300">Não foi possível carregar os indicadores.</p> : null}
      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Kpi titulo="Cadastrados no período" valor={data.cadastrados} detalhe={`${data.candidatos_sem_data.toLocaleString("pt-BR")} ficam de fora por não terem data de inclusão. A base histórica tem ${data.candidatos_base.toLocaleString("pt-BR")} registros e não representa candidatos ativos.`} />
            <Kpi titulo="Vagas cadastradas" valor={data.vagas_cadastradas} detalhe="Pela data de cadastro da vaga." />
            <Kpi titulo="Vagas abertas no período" valor={data.vagas_abertas_periodo} detalhe={`${data.vagas_abertas_agora.toLocaleString("pt-BR")} estão abertas agora, independente do período.`} />
            <Kpi titulo="Contratações no período" valor={data.contratacoes} detalhe={`${data.contratacoes_ativas_agora.toLocaleString("pt-BR")} vínculos ativos agora. A data usada é a da contratação.`} />
            <Kpi titulo="Encaminhados pela DNAWORK" valor={data.origem.encaminhados_dnawork} detalhe="Pela data de encaminhamento do processo." />
            <Kpi titulo="Recebidos das empresas" valor={data.origem.recebidos_empresa} detalhe="Pela data de recebimento do processo." />
            <Kpi titulo="Entrevistas realizadas" valor={data.origem.entrevistas} detalhe="Movimentações para entrevista realizada no período." />
            <Kpi titulo="Empresas com movimento" valor={data.empresas_movimento} detalhe={`${data.empresas_base.toLocaleString("pt-BR")} empresas na base. O registro antigo de entrevista, sem origem, teve ${data.encaminhamentos.atual.toLocaleString("pt-BR")} lançamentos.`} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {data.posicoes.disponivel ? (
              <article className="rounded-xl bg-[#12141a] px-5 py-4 ring-1 ring-white/10">
                <p className="text-[13px] text-slate-400">Posições disponíveis</p>
                <p className="mt-2 text-[2rem] font-medium leading-none tabular-nums text-white">{data.posicoes.total?.toLocaleString("pt-BR")}</p>
                <p className="mt-2 text-xs text-slate-500">{data.vagas_abertas_agora.toLocaleString("pt-BR")} vagas abertas agora. {data.posicoes.sem_capacidade.toLocaleString("pt-BR")} ainda não têm quantidade definida e ficam de fora desta conta.</p>
              </article>
            ) : <Painel titulo="Posições disponíveis" texto={data.posicoes.motivo ?? ""} />}
            <Conversao titulo="Conversão DNAWORK" taxa={data.origem.conversao_dnawork} texto="Contratações da DNAWORK divididas pelos encaminhamentos do período." />
            <Conversao titulo="Conversão da empresa" taxa={data.origem.conversao_empresa} texto="Contratações de intermediação divididas pelos candidatos recebidos no período." />
          </div>
          <section className="rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
            <h2 className="mb-3 text-sm font-semibold text-white">Vagas e contratações</h2>
            {data.serie.every((item) => item.vagas === 0 && item.contratacoes === 0) ? <Vazio /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.serie}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="dia" stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={tooltip} />
                    <Line dataKey="vagas" name="Vagas cadastradas" stroke="#67e8f9" strokeWidth={2} dot={false} />
                    <Line dataKey="contratacoes" name="Contratações" stroke="#d8b4fe" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
              <h2 className="mb-3 text-sm font-semibold text-white">Origem no período</h2>
              {data.serie_origem.every((item) => item.dnawork === 0 && item.empresa === 0 && item.entrevistas === 0) ? <Vazio /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.serie_origem}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="dia" stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <Tooltip contentStyle={tooltip} />
                      <Line dataKey="dnawork" name="Encaminhados DNAWORK" stroke="#67e8f9" strokeWidth={2} dot={false} />
                      <Line dataKey="empresa" name="Recebidos da empresa" stroke="#d8b4fe" strokeWidth={2} dot={false} />
                      <Line dataKey="entrevistas" name="Entrevistas realizadas" stroke="#f4f6f8" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section className="rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
              <h2 className="mb-3 text-sm font-semibold text-white">Contratações por origem</h2>
              {data.origem.contratacoes.every((item) => item.total === 0) ? <Vazio /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.origem.contratacoes.map((item) => ({ ...item, nome: origemNome[item.origem] ?? item.origem }))}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="nome" stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <Tooltip contentStyle={tooltip} />
                      <Bar dataKey="total" name="Contratações" fill="#67e8f9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
              <h2 className="mb-3 text-sm font-semibold text-white">CLT e estágio</h2>
              {data.regimes.length === 0 ? <Vazio /> : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.regimes}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis dataKey="regime" stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#8b95a7" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
                      <Tooltip contentStyle={tooltip} />
                      <Bar dataKey="total" name="Contratações" fill="#67e8f9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section className="rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
              <h2 className="mb-3 text-sm font-semibold text-white">Empresas que mais contrataram</h2>
              {data.ranking.length === 0 ? <Vazio /> : (
                <ol className="grid gap-2">
                  {data.ranking.map((item) => (
                    <li key={item.empresa} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-slate-200">{item.empresa}</span>
                      <span className="tabular-nums text-white">{item.total}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <h2 className="text-sm font-semibold text-white">Contratações recentes</h2>
              <Link className="text-sm font-semibold text-cyan-300" to="/contratacoes">Ver todas</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
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

function Conversao({ titulo, taxa, texto }: { titulo: string; taxa: number | null; texto: string }) {
  return (
    <article className="rounded-xl bg-[#12141a] px-5 py-4 ring-1 ring-white/10">
      <p className="text-[13px] text-slate-400">{titulo}</p>
      <p className="mt-2 text-[2rem] font-medium leading-none tabular-nums text-white">{taxa == null ? "—" : `${taxa.toLocaleString("pt-BR")}%`}</p>
      <p className="mt-2 text-xs text-slate-500">{taxa == null ? `Dados indisponíveis. ${texto}` : texto}</p>
    </article>
  );
}

const origemNome: Record<string, string> = { dnawork: "DNAWORK", empresa: "Empresa", nao_identificado: "Não identificado" };

function Kpi({ titulo, valor, detalhe }: { titulo: string; valor: Contagem; detalhe: string }) {
  const delta = valor.atual - valor.anterior;
  return (
    <article className="rounded-xl bg-[#12141a] px-5 py-4 ring-1 ring-white/10">
      <p className="text-[13px] text-slate-400">{titulo}</p>
      <p className="mt-2 text-[2rem] font-medium leading-none tabular-nums tracking-tight text-white">{valor.atual.toLocaleString("pt-BR")}</p>
      <p className="mt-2 text-xs text-slate-500">{delta >= 0 ? "+" : ""}{delta.toLocaleString("pt-BR")} em relação ao período anterior. {detalhe}</p>
    </article>
  );
}

function Painel({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <article className="rounded-xl bg-[#12141a] px-5 py-4 ring-1 ring-white/10">
      <h2 className="text-sm font-semibold text-white">{titulo}</h2>
      <p className="mt-2 text-sm text-slate-400">Dados indisponíveis. {texto}</p>
    </article>
  );
}

function Vazio() {
  return <p className="text-sm text-slate-400">Nenhum movimento neste período.</p>;
}

function somar(iso: string, dias: number) {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}
