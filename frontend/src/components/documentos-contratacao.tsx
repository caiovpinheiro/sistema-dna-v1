import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr } from "@/lib/format";

export type DocumentoGerado = {
  id: number;
  nome: string;
  vaga: string | null;
  empresa: string | null;
  data: string | null;
  devolvido_por: string | null;
  assinatura: string | null;
  status: string;
  motivo: string;
  motivo_interno: string | null;
  avaliacao: string | null;
  resumo: string | null;
  texto: string | null;
};

export function DocumentosContratacao({ id }: { id: string }) {
  const [aberto, setAberto] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["contratacao-documentos", id],
    queryFn: () => api<DocumentoGerado[]>(`/api/v1/contratacoes/${id}/documentos`),
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
                    <td>{item.assinatura || "—"}</td>
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
    </Card>
  );
}
