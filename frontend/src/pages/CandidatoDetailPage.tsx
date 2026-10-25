import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";

type Candidate = {
  id_candidato: string; nome: string; cpf: string; email: string; celular: string | null; telefonefixo: string | null;
  cidade: string | null; estado: string | null; curso: string | null; nome_escola: string | null; ctps: string | null; datanascimento: string | null;
};
type Contract = { id_contratacao: number; cargo: string | null; empresa_fantasia: string | null; empresa_razao: string | null; regime: string; situacao: string; data_inicio: string | null; data_encerramento: string | null };

export function CandidatoDetailPage() {
  const { id } = useParams();
  const person = useQuery({ queryKey: ["candidato", id], queryFn: () => api<Candidate>(`/api/v1/candidatos/${id}`) });
  const history = useQuery({ queryKey: ["candidato-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/candidatos/${id}/contratacoes`) });
  if (person.isLoading) return <Skeleton className="h-64" />;
  if (!person.data) return <p className="text-rose-600">Candidato não encontrado.</p>;
  const data = person.data.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">{data.nome}</h1><p className="text-sm text-slate-500">{formatCpf(data.cpf)} · {data.email}</p></div>
        <div className="flex gap-2"><Link to={`/processos/novo?candidato=${id}`}><Button variant="secondary">Novo processo</Button></Link><Link to={`/candidatos/${id}/editar`}><Button variant="secondary">Editar</Button></Link></div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Celular</p><p className="font-semibold">{formatPhone(data.celular)}</p></Card>
        <Card><p className="text-xs text-slate-500">Cidade</p><p className="font-semibold">{[data.cidade, data.estado].filter(Boolean).join(" / ") || "—"}</p></Card>
        <Card><p className="text-xs text-slate-500">Nascimento</p><p className="font-semibold">{dateBr(data.datanascimento)}</p></Card>
      </div>
      <Card>
        <h2 className="mb-3 font-bold">Histórico de contratações</h2>
        {history.isLoading ? <Skeleton className="h-20" /> : history.data?.data.length ? (
          <div className="grid gap-3">
            {history.data.data.map((item) => (
              <Link key={item.id_contratacao} to={`/contratacoes/${item.id_contratacao}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
                <span><strong>{item.cargo}</strong><span className="block text-sm text-slate-500">{item.empresa_fantasia || item.empresa_razao} · {regimeLabel[item.regime]}</span></span>
                <Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge>
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">Este candidato ainda não tem contratações.</p>}
      </Card>
      <ProcessosRelacionados filtro={`id_candidato=${id}`} />
    </div>
  );
}
