import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr } from "@/lib/format";

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
};

export function DocumentosContratacao({ id }: { id: string }) {
  const [aberto, setAberto] = useState<number | null>(null);
  const [erro, setErro] = useState("");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["contratacao-documentos", id],
    queryFn: () => api<DocumentoGerado[]>(`/api/v1/contratacoes/${id}/documentos`),
  });
  const assinar = useMutation({
    mutationFn: () => api<{ assinatura: string; sign_url: string | null }>(`/api/v1/contratacoes/${id}/assinatura`, { method: "POST" }),
    onSuccess: async () => {
      setErro("");
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "A ZapSign não enviou a assinatura."),
  });
  const linhas = query.data?.data ?? [];

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
                <Fragment key={`${item.status}-${item.id}`}>
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-3 font-semibold">
                      <button type="button" className="text-left text-cyan-800" onClick={() => setAberto(aberto === item.id ? null : item.id)}>
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
                        {item.pode_assinar ? (
                          <Button className="h-8 bg-orange-500 px-2 text-navy-950 hover:bg-orange-400" disabled={assinar.isPending} onClick={() => assinar.mutate()}>
                            {assinar.isPending ? "Enviando…" : "Obter assinatura digital"}
                          </Button>
                        ) : null}
                        {item.sign_url ? <a className="font-semibold text-cyan-800" href={item.sign_url} target="_blank" rel="noreferrer">Abrir assinatura</a> : null}
                      </div>
                    </td>
                    <td>{item.status}</td>
                  </tr>
                  {aberto === item.id ? (
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
    </Card>
  );
}
