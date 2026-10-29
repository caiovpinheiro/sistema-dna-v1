import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { GeradorTce } from "@/components/gerador-tce";
import { Badge, Card, Empty, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Termo = {
  id: string;
  id_contratacao: number | null;
  nome: string;
  status: string;
  criado_em: string;
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

export function GerarTcePage() {
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Gerar TCE</h1>
        <p className="text-sm text-slate-500">Primeiro o PDF é gerado para conferência. A assinatura só é enviada no passo seguinte.</p>
      </div>
      <ol className="flex flex-wrap gap-3 text-sm font-semibold">
        <li className="rounded-full bg-navy-900 px-3 py-1.5 text-white">1. Gerar o TCE</li>
        <li className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-500">2. Enviar para assinatura</li>
      </ol>
      <Card><GeradorTce /></Card>
    </div>
  );
}

export function TermosPage() {
  const [params, setParams] = useSearchParams();
  const [erro, setErro] = useState("");
  const client = useQueryClient();
  const status = params.get("status") ?? "";
  const query = useQuery({
    queryKey: ["termos", status],
    queryFn: () => api<Termo[]>(`/api/v1/termos${status ? `?status=${status}` : ""}`),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/api/v1/termos/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setErro("");
      await client.invalidateQueries({ queryKey: ["termos"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível excluir o termo."),
  });
  const rows = query.data?.data ?? [];
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Termos e documentos</h1>
        <p className="text-sm text-slate-500">Documentos enviados à ZapSign e os que já foram assinados.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["", "gerado", "enviado", "assinado", "recusado"].map((value) => (
          <button key={value || "todos"} type="button" onClick={() => setParams(value ? { status: value } : {})}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${status === value ? "bg-navy-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {value ? labels[value] : "Todos"}
          </button>
        ))}
      </div>
      {query.isLoading ? <Skeleton className="h-48" /> : null}
      {query.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os termos. Confira se a migration já rodou no deploy.</p> : null}
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      {!query.isLoading && !query.isError && rows.length === 0 ? <Empty title="Nenhum termo" text="Abra uma contratação de estágio e envie o termo para assinatura." /> : null}
      {rows.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Estagiário</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Enviado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold">
                    <Link className="text-cyan-800" to={`/termos/${row.id}`}>{row.candidato_nome || row.nome}</Link>
                  </td>
                  <td className="px-4 py-3">{row.empresa_nome || "—"}</td>
                  <td className="px-4 py-3"><Badge value={row.status}>{labels[row.status] ?? row.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex w-full items-center justify-between gap-6 pr-1">
                      <span>{new Date(row.criado_em).toLocaleDateString("pt-BR")}</span>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                        aria-label={`Excluir TCE de ${row.candidato_nome || row.nome}`}
                        disabled={excluir.isPending}
                        onClick={() => {
                          const nome = row.candidato_nome || row.nome;
                          if (!window.confirm(`Excluir o TCE de ${nome}?`)) return;
                          excluir.mutate(row.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
