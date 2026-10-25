import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Badge, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, regimeLabel } from "@/lib/format";

type Dashboard = {
  candidatos: number;
  empresas: number;
  vagas_abertas: number;
  posicoes_disponiveis: number;
  contratacoes_ativas: number;
  ultimas_contratacoes: Array<{ id_contratacao: number; candidato_nome: string | null; empresa_fantasia: string | null; empresa_razao: string | null; cargo: string | null; regime: string; data_inicio: string | null; situacao: string }>;
};

export function DashboardPage() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/v1/dashboard") });
  if (query.isLoading) return <div className="grid gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[4.5rem] rounded-none bg-[#12141a]" />)}</div>;
  if (query.isError || !query.data) return <p className="text-sm text-rose-600">Não foi possível carregar os indicadores.</p>;
  const data = query.data.data;
  const cards = [
    ["Candidatos", data.candidatos],
    ["Empresas", data.empresas],
    ["Vagas abertas", data.vagas_abertas],
    ["Posições disponíveis", data.posicoes_disponiveis],
    ["Contratações ativas", data.contratacoes_ativas],
  ];
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Painel</h1>
        <p className="text-sm text-slate-500">Números lidos agora do banco.</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="bg-[#12141a] px-5 py-4">
            <p className="text-[13px] text-slate-400">{label}</p>
            <p className="mt-2 text-[2rem] font-medium leading-none tabular-nums tracking-tight text-white">{value}</p>
          </div>
        ))}
      </div>
      <section className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Últimas contratações</h2>
          <Link className="text-sm font-semibold text-cyan-300" to="/contratacoes">Ver todas</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Candidato</th><th>Empresa</th><th>Cargo</th><th>Regime</th><th>Início</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {data.ultimas_contratacoes.length === 0 ? <tr><td className="text-slate-500" colSpan={6}>Nenhuma contratação registrada.</td></tr> : data.ultimas_contratacoes.map((item) => (
                <tr key={item.id_contratacao}>
                  <td><Link to={`/contratacoes/${item.id_contratacao}`}>{item.candidato_nome}</Link></td>
                  <td>{item.empresa_fantasia || item.empresa_razao}</td>
                  <td>{item.cargo}</td>
                  <td>{regimeLabel[item.regime] ?? item.regime}</td>
                  <td className="tabular-nums">{dateBr(item.data_inicio)}</td>
                  <td><Badge value={item.situacao}>{item.situacao === "ativa" ? "Ativa" : "Encerrada"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
