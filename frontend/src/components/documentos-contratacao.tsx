import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr } from "@/lib/format";

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
  return `${dia} as ${hora}`;
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
    <Card>
      <h2 className="mb-3 font-bold">Documentos gerados</h2>
      {query.isLoading ? <Skeleton className="h-16" /> : null}
      {query.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os documentos.</p> : null}
      {!query.isLoading && !query.isError && linhas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          Nenhum documento gerado para esta contratação.
        </div>
      ) : null}
      {linhas.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr className="border-b">
                <th className="px-3 py-2">Nome</th>
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
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-3 font-semibold">
                      <button
                        type="button"
                        className="text-left text-cyan-800"
                        onClick={() => {
                          if (item.origem === "rescisao") {
                            setPainel(true);
                            setAviso("");
                            return;
                          }
                          setAberto(aberto === item.id ? null : item.id);
                        }}
                      >
                        {item.nome}
                      </button>
                    </td>
                    <td>{item.vaga || "—"}</td>
                    <td>{item.empresa || "—"}</td>
                    <td>{dateBr(item.data)}</td>
                    <td>{item.devolvido_por || "—"}</td>
                    <td>
                      <div className="grid gap-1">
                        <span>{item.assinatura || "—"}</span>
                        {item.origem === "rescisao" ? (
                          <button type="button" className="text-left text-xs font-semibold text-cyan-800" onClick={() => setPainel(true)}>
                            Abrir assinatura
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>{item.status}</td>
                  </tr>
                  {aberto === item.id && item.origem !== "rescisao" ? (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td className="px-3 py-3 text-sm text-slate-600" colSpan={7}>
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
      {erro ? <p className="mt-3 text-sm text-rose-600">{erro}</p> : null}
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
      <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-5 text-slate-800 shadow-xl">
        {carregando ? <Skeleton className="h-40" /> : null}
        {falha ? <p className="text-sm text-rose-600">Não foi possível acompanhar a assinatura.</p> : null}
        {dados ? (
          <>
            <h3 className="text-xl font-extrabold text-navy-900">{dados.nome}.</h3>
            <p className="mt-1 font-semibold">Status: {dados.status}</p>
            {dados.enviado_em ? <p className="mt-3 text-sm">Enviado para assinatura {quando(dados.enviado_em)}</p> : null}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-500">
                  <tr className="border-b">
                    <th className="py-2 pr-3">Partes</th>
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3">E-mail</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Data Assinatura</th>
                    <th className="py-2">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {partes.map((item) => (
                    <Fragment key={`${item.papel}-${item.email}`}>
                      <tr className="border-b border-slate-100">
                        <td className="py-2 pr-3">{item.papel}</td>
                        <td className="py-2 pr-3">{item.nome || "—"}</td>
                        <td className="py-2 pr-3">{item.email || "—"}</td>
                        <td className="py-2 pr-3">{item.status}</td>
                        <td className="py-2 pr-3">{item.status === "Assinado" ? quando(item.assinado_em) || "Assinado" : ""}</td>
                        <td className="py-2">
                          {item.url && item.status !== "Assinado" ? (
                            <button type="button" className="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white" onClick={() => onCopiar(item.url!)}>
                              Copiar link
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {item.url && item.status !== "Assinado" ? (
                        <tr className="border-b border-slate-100">
                          <td className="py-2 pr-3 text-slate-500">{item.papel}</td>
                          <td className="py-2 text-cyan-800" colSpan={5}>{item.url}</td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {!enviado ? (
              <div className="mt-4">
                <Button className="bg-orange-500 text-navy-950 hover:bg-orange-400" disabled={enviando} onClick={onEnviar}>
                  {enviando ? "Enviando…" : "Enviar para assinatura"}
                </Button>
              </div>
            ) : null}
            {aviso ? <p className="mt-3 text-sm font-semibold text-emerald-700">{aviso}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-navy-950" href={`/api/v1/contratacoes/${id}/rescisao.pdf`} target="_blank" rel="noreferrer">
                Imprimir original
              </a>
              {dados.preview_url ? (
                <a className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white" href={dados.preview_url} target="_blank" rel="noreferrer">
                  Preview assinaturas
                </a>
              ) : null}
            </div>
          </>
        ) : null}
        <button type="button" className="mt-4 rounded-md px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </div>
  );
}
