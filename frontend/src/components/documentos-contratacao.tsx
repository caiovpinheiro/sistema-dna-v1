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
  data: string;
  status: string;
  motivo: string;
  motivo_interno: string | null;
  avaliacao: string | null;
  resumo: string | null;
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
                <th>Status</th>
                <th className="pr-3 text-right">Ver</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item) => (
                <Fragment key={item.id}>
                  <tr className="border-b border-slate-100">
                    <td className="px-3 py-3 font-semibold">{item.nome}</td>
                    <td>{item.vaga || "—"}</td>
                    <td>{item.empresa || "—"}</td>
                    <td>{dateBr(item.data)}</td>
                    <td>{item.status}</td>
                    <td className="pr-3 text-right">
                      <button type="button" className="font-semibold text-orange-500" onClick={() => setAberto(aberto === item.id ? null : item.id)}>
                        {aberto === item.id ? "Fechar" : "Ver"}
                      </button>
                    </td>
                  </tr>
                  {aberto === item.id ? (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td className="px-3 py-3 text-sm text-slate-600" colSpan={6}>
                        <p><span className="text-slate-500">Motivo:</span> {item.motivo}</p>
                        <p><span className="text-slate-500">Avaliação:</span> {item.avaliacao || "—"}</p>
                        <p className="mt-2 whitespace-pre-line"><span className="text-slate-500">Resumo das atividades:</span>{"\n"}{item.resumo || "—"}</p>
                        {item.motivo_interno ? <p className="mt-2 whitespace-pre-line"><span className="text-slate-500">Motivo interno:</span>{"\n"}{item.motivo_interno}</p> : null}
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
