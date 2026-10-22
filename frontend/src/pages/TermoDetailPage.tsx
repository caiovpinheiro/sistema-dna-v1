import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Signatario = { nome: string; email: string; status: string; url: string | null };
type Termo = {
  id: string;
  id_contratacao: number | null;
  nome: string;
  status: string;
  arquivo_assinado: string | null;
  signatarios: Signatario[];
  candidato_nome: string | null;
  empresa_nome: string | null;
};

const labels: Record<string, string> = {
  gerado: "Gerado",
  enviado: "Aguardando",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

function PdfPreview({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState("");
  useEffect(() => {
    let objectUrl = "";
    let active = true;
    fetch(`/api/v1/tce/${id}/pdf`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.blob();
      })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setErro("Não foi possível abrir o PDF gerado."); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (erro) return <p className="text-sm text-rose-600">{erro}</p>;
  if (!url) return <Skeleton className="h-[720px]" />;
  return <iframe title="Prévia do TCE" src={url} className="h-[720px] w-full rounded-xl border border-slate-200" />;
}

export function TermoDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const [erro, setErro] = useState("");
  const query = useQuery({ queryKey: ["termo", id], queryFn: () => api<Termo>(`/api/v1/termos/${id}`) });
  const enviar = useMutation({
    mutationFn: () => api<Termo>(`/api/v1/tce/${id}/enviar`, { method: "POST" }),
    onSuccess: async () => {
      setErro("");
      await client.invalidateQueries({ queryKey: ["termo", id] });
      await client.invalidateQueries({ queryKey: ["termos"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível enviar para assinatura."),
  });
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (!query.data) return <p className="text-rose-600">Termo não encontrado.</p>;
  const data = query.data.data;
  const signers = Array.isArray(data.signatarios) ? data.signatarios : [];
  const gerado = data.status === "gerado";
  return (
    <div className="grid gap-5">
      {gerado ? (
        <ol className="flex flex-wrap gap-3 text-sm font-semibold">
          <li className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-800">1. TCE gerado</li>
          <li className="rounded-full bg-navy-900 px-3 py-1.5 text-white">2. Enviar para assinatura</li>
        </ol>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Termo de estágio</p>
          <h1 className="text-2xl font-extrabold">{data.candidato_nome || data.nome}</h1>
          <p className="text-sm text-slate-500">{data.empresa_nome || "Empresa não informada"}</p>
        </div>
        <Badge value={data.status}>{labels[data.status] ?? data.status}</Badge>
      </div>
      {gerado ? (
        <Card className="grid gap-4">
          <div>
            <h2 className="font-bold">Conferir o TCE</h2>
            <p className="text-sm text-slate-500">Se estiver certo, envie para os signatários. Nada é mandado para a ZapSign antes deste botão.</p>
          </div>
          <PdfPreview id={data.id} />
          {signers.map((signer) => (
            <p key={`${signer.nome}-${signer.email}`} className="text-sm"><span className="font-semibold">{signer.nome || "Signatário"}</span> · {signer.email || "sem e-mail"}</p>
          ))}
          {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
          <Button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate()}>{enviar.isPending ? "Enviando…" : "Enviar para assinatura"}</Button>
        </Card>
      ) : null}
      {!gerado ? <Card className="grid gap-3">
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
        {data.id_contratacao ? <Link className="text-sm font-semibold text-cyan-800" to={`/contratacoes/${data.id_contratacao}`}>Abrir contratação</Link> : null}
      </Card> : null}
    </div>
  );
}
