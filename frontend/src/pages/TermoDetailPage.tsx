import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, ExternalLink, GraduationCap, Mail, Pencil, RefreshCw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { textoPlano } from "@/lib/format";

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
  if (erro) return <Alerta>{erro}</Alerta>;
  if (!url) return <Skeleton className="h-[720px]" />;
  return <iframe title="Prévia do TCE" src={url} className="h-[720px] w-full rounded-xl border border-slate-200" />;
}

export function TermoDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [copiado, setCopiado] = useState("");
  const query = useQuery({ queryKey: ["termo", id], queryFn: () => api<Termo>(`/api/v1/termos/${id}`) });
  const email = useMutation({
    mutationFn: () => api(`/api/v1/tce/${id}/email`, { method: "POST" }),
    onSuccess: () => { setErro(""); setAviso("PDF enviado por documentos@dnawork.ai."); },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível enviar o e-mail."),
  });
  const assinatura = useMutation({
    mutationFn: () => api(`/api/v1/tce/${id}/email-assinatura`, { method: "POST" }),
    onSuccess: () => { setErro(""); setAviso("E-mails de assinatura enviados por contratos@dnawork.ai."); },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível enviar os e-mails de assinatura."),
  });
  const escola = useMutation({
    mutationFn: () => api(`/api/v1/tce/${id}/email-escola`, { method: "POST" }),
    onSuccess: () => { setErro(""); setAviso("Pedido de assinatura enviado para a escola, com cópia para documentos@dnawork.ai."); },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível enviar o pedido para a escola."),
  });
  const enviar = useMutation({
    mutationFn: () => api<Termo>(`/api/v1/tce/${id}/enviar`, { method: "POST" }),
    onSuccess: async (result) => {
      setErro("");
      const emailEnviado = Boolean((result.data as { email_enviado?: boolean }).email_enviado);
      setAviso(emailEnviado
        ? "TCE enviado para assinatura e os e-mails saíram por contratos@dnawork.ai."
        : "TCE enviado para a ZapSign. O e-mail automático não está configurado neste servidor: use os links de assinatura abaixo.");
      await client.invalidateQueries({ queryKey: ["termo", id] });
      await client.invalidateQueries({ queryKey: ["termos"] });
    },
    onError: async (error) => {
      setErro(error instanceof ApiError ? error.message : "Não foi possível enviar para assinatura.");
      await client.invalidateQueries({ queryKey: ["termo", id] });
    },
  });
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (!query.data) {
    return (
      <div className="grid gap-3">
        <Alerta>Termo não encontrado. Ele pode ter sido excluído.</Alerta>
        <Link className="text-sm font-semibold text-cyan-700" to="/termos">Voltar para os termos</Link>
      </div>
    );
  }
  const data = query.data.data;
  const signers = Array.isArray(data.signatarios) ? data.signatarios : [];

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setErro("");
      setCopiado(url);
      window.setTimeout(() => setCopiado((atual) => atual === url ? "" : atual), 2000);
    } catch {
      setErro("Não foi possível copiar o link de assinatura.");
    }
  }
  const gerado = data.status === "gerado";
  const assinaram = signers.filter((signer) => (signer.status ?? "").toLowerCase() === "signed").length;
  const mensagens = (
    <>
      {erro ? <Alerta>{erro}</Alerta> : null}
      {aviso ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p> : null}
    </>
  );
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo={data.candidato_nome || data.nome}
        descricao={data.empresa_nome ? textoPlano(data.empresa_nome) : "Empresa não informada"}
        acoes={(
          <>
            {data.id_contratacao ? <Link to={`/contratacoes/${data.id_contratacao}`}><Button type="button" variant="secondary"><ExternalLink size={16} /> Abrir contratação</Button></Link> : null}
            {data.status !== "assinado" ? <Link to={`/termos/${data.id}/editar`}><Button type="button" variant="secondary"><Pencil size={16} /> Editar dados</Button></Link> : null}
          </>
        )}
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Termo de compromisso de estágio</span>
          <Badge value={data.status}>{labels[data.status] ?? data.status}</Badge>
        </div>
        {gerado ? (
          <ol className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
            <li className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-800"><Check size={12} /> TCE gerado</li>
            <li className="rounded-full bg-cyan-700 px-3 py-1 text-white">Agora: enviar para assinatura</li>
          </ol>
        ) : null}
      </CabecalhoPagina>
      {gerado ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <Card className="grid gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-navy-900">Conferir o PDF</h2>
              <p className="text-sm text-slate-500">Se algo estiver errado, use “Editar dados” e gere de novo antes de enviar.</p>
            </div>
            <PdfPreview id={data.id} />
          </Card>
          <Card className="grid gap-4 xl:sticky xl:top-4">
            <div>
              <h2 className="text-[15px] font-bold text-navy-900">Enviar para assinatura</h2>
              <p className="text-sm text-slate-500">A ZapSign recebe o documento e cada pessoa abaixo recebe o e-mail de assinatura da DNA Work.</p>
            </div>
            <ul className="grid gap-2">
              {signers.map((signer) => (
                <li key={`${signer.nome}-${signer.email}`} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-sm font-semibold text-slate-700">{signer.nome || "Signatário"}</p>
                  <p className="truncate text-xs text-slate-500">{signer.email || "Sem e-mail"}</p>
                </li>
              ))}
            </ul>
            {mensagens}
            <div className="grid gap-2">
              <Button type="button" disabled={enviar.isPending} onClick={() => enviar.mutate()}><Send size={16} /> {enviar.isPending ? "Enviando…" : "Enviar para assinatura"}</Button>
              <Button type="button" variant="secondary" disabled={email.isPending} onClick={() => email.mutate()}><Mail size={16} /> {email.isPending ? "Enviando e-mail…" : "Enviar PDF por e-mail"}</Button>
              <Button type="button" variant="secondary" disabled={escola.isPending} onClick={() => escola.mutate()}><GraduationCap size={16} /> {escola.isPending ? "Enviando…" : "Pedir assinatura da escola"}</Button>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold text-navy-900">Assinaturas</h2>
              <p className="text-sm text-slate-500">
                <span className="font-semibold tabular-nums text-slate-700">{assinaram} de {signers.length}</span> {assinaram === 1 ? "assinou" : "assinaram"}. Copie o link de quem ainda não assinou para mandar por outro canal.
              </p>
            </div>
            {data.arquivo_assinado ? (
              <a href={data.arquivo_assinado} target="_blank" rel="noreferrer"><Button type="button"><Download size={16} /> Baixar PDF assinado</Button></a>
            ) : null}
          </div>
          <ul className="grid">
            {signers.map((signer) => (
              <li key={signer.email} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700">{signer.nome}</p>
                  <p className="truncate text-xs text-slate-500">{signer.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SituacaoSignatario status={signer.status} />
                  {signer.url && data.status !== "assinado" ? (
                    <>
                      <button type="button" className="acao acao-cyan inline-flex items-center gap-1" onClick={() => void copiar(signer.url!)}>
                        {copiado === signer.url ? <><Check size={13} /> Link copiado</> : <><Copy size={13} /> Copiar link</>}
                      </button>
                      <a className="acao acao-cyan inline-flex items-center gap-1" href={signer.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir assinatura</a>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {mensagens}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" disabled={assinatura.isPending} onClick={() => assinatura.mutate()}><RefreshCw size={16} /> {assinatura.isPending ? "Enviando…" : "Reenviar e-mails de assinatura"}</Button>
            <Button type="button" variant="secondary" disabled={escola.isPending} onClick={() => escola.mutate()}><GraduationCap size={16} /> {escola.isPending ? "Enviando…" : "Pedir assinatura da escola"}</Button>
            <Button type="button" variant="secondary" disabled={email.isPending} onClick={() => email.mutate()}><Mail size={16} /> {email.isPending ? "Enviando e-mail…" : "Enviar PDF por e-mail"}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Situação de cada signatário na ZapSign (signed, new, link-opened, refused…) em português. */
function SituacaoSignatario({ status }: { status: string | null | undefined }) {
  const valor = (status ?? "").toLowerCase();
  if (valor === "signed") return <Badge value="assinado">Assinou</Badge>;
  if (valor.includes("refus")) return <Badge value="recusado">Recusou</Badge>;
  if (valor === "link-opened") return <Badge value="enviado">Abriu o link</Badge>;
  return <Badge value="enviado">Aguardando</Badge>;
}
