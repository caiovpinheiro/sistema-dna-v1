import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, money, regimeLabel, situacaoLabel } from "@/lib/format";

type Job = { id_vaga: string; cargo: string; id_empresa: string; nome_fantasia: string | null; razao_social: string | null; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; salario: number | null; dataabertura: string | null; carga_horaria: string | null };
type Contract = { id_contratacao: number; candidato_nome: string | null; candidato_cpf: string | null; situacao: string; data_inicio: string | null };

export function VagaDetailPage() {
  const { id } = useParams();
  const job = useQuery({ queryKey: ["vaga", id], queryFn: () => api<Job>(`/api/v1/vagas/${id}`) });
  const contracts = useQuery({ queryKey: ["vaga-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/vagas/${id}/contratacoes`) });
  if (job.isLoading) return <Skeleton className="h-64" />;
  if (!job.data) return <p className="text-rose-600">Vaga não encontrada.</p>;
  const data = job.data.data;
  const total = data.quantidade_posicoes ?? 0;
  const width = total ? Math.min(100, Math.round((data.ocupadas / total) * 100)) : 0;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{data.cargo}</h1>
          <p className="text-sm text-slate-500"><Link className="text-cyan-800" to={`/empresas/${data.id_empresa}`}>{data.nome_fantasia || data.razao_social}</Link> · {regimeLabel[data.regime]} · {money(data.salario)}</p>
        </div>
        <div className="flex gap-2"><Link to={`/contratacoes/nova?vaga=${id}&empresa=${data.id_empresa}`}><Button>Contratar</Button></Link><Link to={`/vagas/${id}/editar`}><Button variant="secondary">Editar</Button></Link></div>
      </div>
      <Card>
        <div className="mb-2 flex items-center justify-between"><Badge value={data.situacao}>{situacaoLabel[data.situacao]}</Badge><span className="text-sm font-semibold">{data.quantidade_posicoes ?? "—"} posições · {data.ocupadas} preenchidas · {data.disponiveis ?? "—"} disponíveis</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-cyan-600" style={{ width: `${width}%` }} /></div>
        <p className="mt-3 text-sm text-slate-500">Aberta em {dateBr(data.dataabertura)} · Carga {data.carga_horaria || "não informada"}</p>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Candidatos contratados</h2>
        <div className="grid gap-2">{contracts.data?.data.length ? contracts.data.data.map((item) => (
          <Link key={item.id_contratacao} to={`/contratacoes/${item.id_contratacao}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
            <span><strong>{item.candidato_nome}</strong><span className="ml-2 text-sm text-slate-500">{formatCpf(item.candidato_cpf)} · {dateBr(item.data_inicio)}</span></span>
            <Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
          </Link>
        )) : <p className="text-sm text-slate-500">Nenhum candidato contratado nesta vaga.</p>}</div>
      </Card>
    </div>
  );
}
