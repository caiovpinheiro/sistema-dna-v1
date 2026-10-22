import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

type Signatario = { nome: string; email: string; status: string; url: string | null };
type Termo = {
  id: string;
  id_contratacao: number;
  nome: string;
  status: string;
  arquivo_assinado: string | null;
  signatarios: Signatario[];
  candidato_nome: string | null;
  empresa_nome: string | null;
};

const labels: Record<string, string> = {
  enviado: "Aguardando",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

export function TermoDetailPage() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ["termo", id], queryFn: () => api<Termo>(`/api/v1/termos/${id}`) });
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (!query.data) return <p className="text-rose-600">Termo não encontrado.</p>;
  const data = query.data.data;
  const signers = Array.isArray(data.signatarios) ? data.signatarios : [];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Termo de estágio</p>
          <h1 className="text-2xl font-extrabold">{data.candidato_nome || data.nome}</h1>
          <p className="text-sm text-slate-500">{data.empresa_nome || "Empresa não informada"}</p>
        </div>
        <Badge value={data.status}>{labels[data.status] ?? data.status}</Badge>
      </div>
      <Card className="grid gap-3">
        {signers.map((signer) => (
          <div key={signer.email} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 last:border-0">
            <div>
              <p className="font-semibold">{signer.nome}</p>
              <p className="text-sm text-slate-500">{signer.email}</p>
            </div>
            {signer.url && data.status !== "assinado" ? (
              <a className="text-sm font-semibold text-cyan-800" href={signer.url} target="_blank" rel="noreferrer">Abrir assinatura</a>
            ) : <span className="text-sm text-slate-500">{signer.status}</span>}
          </div>
        ))}
        {data.arquivo_assinado ? (
          <a className="font-semibold text-cyan-800" href={data.arquivo_assinado} target="_blank" rel="noreferrer">Baixar PDF assinado</a>
        ) : null}
        <Link className="text-sm font-semibold text-cyan-800" to={`/contratacoes/${data.id_contratacao}`}>Abrir contratação</Link>
      </Card>
    </div>
  );
}
