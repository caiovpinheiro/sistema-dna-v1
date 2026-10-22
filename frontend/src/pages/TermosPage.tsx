import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { GeradorTce } from "@/components/gerador-tce";
import { Badge, Button, Card, Empty, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";

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
  enviado: "Aguardando",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

export function TermosPage() {
  const [aberto, setAberto] = useState(false);
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const query = useQuery({
    queryKey: ["termos", status],
    queryFn: () => api<Termo[]>(`/api/v1/termos${status ? `?status=${status}` : ""}`),
  });
  const rows = query.data?.data ?? [];
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Termos de estágio</h1>
        <p className="text-sm text-slate-500">Documentos enviados à ZapSign e os que já foram assinados.</p>
      </div>
      <div>
        <Button type="button" variant="secondary" onClick={() => setAberto((value) => !value)}>{aberto ? "Fechar gerador" : "Gerar TCE"}</Button>
        {aberto ? <Card className="mt-3"><GeradorTce /></Card> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {["", "enviado", "assinado", "recusado"].map((value) => (
          <button key={value || "todos"} type="button" onClick={() => setParams(value ? { status: value } : {})}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${status === value ? "bg-navy-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {value ? labels[value] : "Todos"}
          </button>
        ))}
      </div>
      {query.isLoading ? <Skeleton className="h-48" /> : null}
      {query.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os termos. Confira se a migration já rodou no deploy.</p> : null}
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
                  <td className="px-4 py-3">{new Date(row.criado_em).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
