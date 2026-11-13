import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Copy, ExternalLink, FileText, Printer, Send, X } from "lucide-react";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, textoPlano } from "@/lib/format";

export type ParteAssinatura = {
  papel: string;
  nome: string;
  email: string;
  status: string;
  url: string | null;
  assinado_em: string | null;
};

export type DocumentoGerado = {
  id: number;
  nome: string;
  vaga: string | null;
  empresa: string | null;
  data: string | null;
  devolvido_por: string | null;
  assinatura: string | null;
  sign_url: string | null;
  pode_assinar: boolean;
  status: string;
  motivo: string;
  motivo_interno: string | null;
  avaliacao: string | null;
  resumo: string | null;
  texto: string | null;
  origem?: "rescisao" | "historico";
  signatarios?: ParteAssinatura[];
  preview_url?: string | null;
  enviado_em?: string | null;
};

type Acompanhamento = {
  nome: string;
  status: string;
  enviado_em: string | null;
  preview_url: string | null;
  signatarios: ParteAssinatura[];
};

function quando(value: string | null) {
  if (!value) return "";
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return dateBr(value);
  const dia = data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = data.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${dia} às ${hora}`;
}

export function DocumentosContratacao({ id }: { id: string }) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [painel, setPainel] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["contratacao-documentos", id],
    queryFn: () => api<DocumentoGerado[]>(`/api/v1/contratacoes/${id}/documentos`),
  });
  const acompanhamento = useQuery({
    queryKey: ["contratacao-assinatura", id],
    enabled: painel,
    queryFn: () => api<Acompanhamento>(`/api/v1/contratacoes/${id}/assinatura`),
  });
  const assinar = useMutation({
    mutationFn: () => api<Acompanhamento>(`/api/v1/contratacoes/${id}/assinatura`, { method: "POST" }),
    onSuccess: async () => {
      setErro("");
      setAviso("Documento enviado para assinatura. Envelope enviado.");
      setPainel(true);
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-assinatura", id] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "A ZapSign não enviou a assinatura."),
  });
  const linhas = query.data?.data ?? [];

  async function copiar(url: string) {
    await navigator.clipboard.writeText(url);
    setAviso("Link copiado.");
  }

  return (
    <Card className="p-0">
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-[15px] font-bold text-navy-900">Documentos gerados</h2>
        <p className="text-sm text-slate-500">Rescisão gerada aqui e contratos do sistema antigo. Clique no nome para ver a assinatura ou o texto.</p>
      </div>
      {query.isLoading ? <div className="px-4 pb-4"><Skeleton className="h-16" /></div> : null}
      {query.isError ? <div className="px-4 pb-4"><Alerta>Não foi possível carregar os documentos.</Alerta></div> : null}
      {!query.isLoading && !query.isError && linhas.length === 0 ? (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            Nenhum documento gerado para esta contratação.
          </div>
        </div>
      ) : null}
      {linhas.length > 0 ? (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="data-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Vaga</th>
                <th>Empresa</th>
                <th>Data</th>
                <th>Devolvido por</th>
                <th>Assinatura digital</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item) => (
                <Fragment key={`${item.origem ?? item.status}-${item.id}`}>
                  <tr>
                    <td className="max-w-64">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left font-semibold text-cyan-700 hover:underline"
                        aria-expanded={item.origem === "rescisao" ? undefined : aberto === item.id}
                        onClick={() => {
                          if (item.origem === "rescisao") {
                            setPainel(true);
                            setAviso("");
                            return;
                          }
                          setAberto(aberto === item.id ? null : item.id);
                        }}
                      >
                        <FileText size={14} className="shrink-0" />
                        {item.nome}
                      </button>
                      {item.origem === "historico" ? <p className="text-xs text-slate-500">Sistema antigo</p> : null}
                    </td>
                    <td className="max-w-56 text-slate-700">{textoPlano(item.vaga) || "—"}</td>
                    <td className="max-w-56 text-slate-700">{textoPlano(item.empresa) || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data)}</td>
                    <td className="text-slate-600">{item.devolvido_por || "—"}</td>
                    <td>
                      <div className="grid justify-items-start gap-1">
                        {item.assinatura ? <Badge value={valorAssinatura(item.assinatura)}>{item.assinatura}</Badge> : <span className="text-slate-400">—</span>}
                        {item.origem === "rescisao" ? (
                          <button type="button" className="text-left text-xs font-semibold text-cyan-700 hover:underline" onClick={() => setPainel(true)}>
                            Abrir assinatura
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate-700">{item.status}</td>
                  </tr>
                  {aberto === item.id && item.origem !== "rescisao" ? (
                    <tr>
                      <td className="bg-slate-50 text-sm text-slate-600" colSpan={7}>
                        <p className="whitespace-pre-line">{item.texto || item.resumo || "Documento sem texto gravado."}</p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {erro ? <div className="px-4 pb-4 pt-3"><Alerta>{erro}</Alerta></div> : null}
      {painel ? (
        <AssinaturaPainel
          id={id}
          carregando={acompanhamento.isLoading}
          dados={acompanhamento.data?.data}
          falha={acompanhamento.isError}
          aviso={aviso}
          enviando={assinar.isPending}
          onFechar={() => setPainel(false)}
          onCopiar={(url) => void copiar(url)}
          onEnviar={() => assinar.mutate()}
        />
      ) : null}
    </Card>
  );
}

/** Cor do selo pelo texto da assinatura: assinado, recusado, aguardando/enviado. */
function valorAssinatura(texto: string) {
  const valor = texto.toLowerCase();
  if (valor.startsWith("assinad")) return "assinado";
  if (valor.startsWith("recusad")) return "recusado";
  if (valor.startsWith("aguard") || valor.startsWith("enviad")) return "enviado";
  return "";
}

function AssinaturaPainel({ id, carregando, dados, falha, aviso, enviando, onFechar, onCopiar, onEnviar }: {
  id: string;
  carregando: boolean;
  dados?: Acompanhamento;
  falha: boolean;
  aviso: string;
  enviando: boolean;
  onFechar: () => void;
  onCopiar: (url: string) => void;
  onEnviar: () => void;
}) {
  const partes = dados?.signatarios ?? [];
  const enviado = Boolean(dados?.enviado_em) || partes.some((item) => item.url);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Assinatura digital">
      <div className="grid max-h-[90vh] w-full max-w-5xl gap-4 overflow-auto rounded-2xl border border-slate-200 bg-white p-5 text-slate-700 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-xs font-semibold text-slate-500">Assinatura digital</p>
            <h3 className="text-xl font-extrabold text-navy-900">{dados?.nome ?? "Documento"}</h3>
            {dados ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <Badge value={valorAssinatura(dados.status)}>{dados.status}</Badge>
                {dados.enviado_em ? <span>Enviado para assinatura em {quando(dados.enviado_em)}</span> : <span>Ainda não enviado</span>}
              </div>
            ) : null}
          </div>
          <button type="button" aria-label="Fechar" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={onFechar}><X size={18} /></button>
        </div>
        {carregando ? <Skeleton className="h-40" /> : null}
        {falha ? <Alerta>Não foi possível acompanhar a assinatura.</Alerta> : null}
        {dados ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Parte</th>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Status</th>
                    <th>Data da assinatura</th>
                    <th><span className="sr-only">Link</span></th>
                  </tr>
                </thead>
                <tbody>
                  {partes.length === 0 ? <tr><td colSpan={6} className="text-slate-500">Nenhum signatário com e-mail cadastrado.</td></tr> : null}
                  {partes.map((item) => (
                    <Fragment key={`${item.papel}-${item.email}`}>
                      <tr>
                        <td className="whitespace-nowrap font-semibold text-slate-700">{item.papel}</td>
                        <td className="text-slate-700">{item.nome || "—"}</td>
                        <td className="text-slate-600">{item.email || "—"}</td>
                        <td className="whitespace-nowrap"><Badge value={valorAssinatura(item.status)}>{item.status}</Badge></td>
                        <td className="whitespace-nowrap tabular-nums text-slate-600">{item.status === "Assinado" ? quando(item.assinado_em) || "Assinado" : ""}</td>
                        <td className="w-px whitespace-nowrap text-right">
                          {item.url && item.status !== "Assinado" ? (
                            <button type="button" className="acao acao-cyan inline-flex items-center gap-1" onClick={() => onCopiar(item.url!)}>
                              <Copy size={14} /> Copiar link
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {item.url && item.status !== "Assinado" ? (
                        <tr>
                          <td className="text-xs text-slate-500">Link de {item.papel.toLowerCase()}</td>
                          <td className="break-all text-xs text-cyan-700" colSpan={5}>{item.url}</td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              {!enviado ? (
                <Button disabled={enviando} onClick={onEnviar}>
                  <Send size={16} /> {enviando ? "Enviando…" : "Enviar para assinatura"}
                </Button>
              ) : null}
              <a className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50" href={`/api/v1/contratacoes/${id}/rescisao.pdf`} target="_blank" rel="noreferrer">
                <Printer size={16} /> Imprimir original
              </a>
              {dados.preview_url ? (
                <a className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-navy-900 ring-1 ring-slate-200 hover:bg-slate-50" href={dados.preview_url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Ver assinaturas na ZapSign
                </a>
              ) : null}
              <Button variant="ghost" className="ml-auto" onClick={onFechar}>Fechar</Button>
            </div>
          </>
        ) : (
          <div className="flex justify-end"><Button variant="ghost" onClick={onFechar}>Fechar</Button></div>
        )}
      </div>
    </div>
  );
}
