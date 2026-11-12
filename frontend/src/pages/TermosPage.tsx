import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { GeradorTce } from "@/components/gerador-tce";
import { CabecalhoPagina } from "@/components/pagina";
import { Badge, Card, Empty, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Signatario = { nome?: string; email?: string; url?: string | null };
type Termo = {
  id: string;
  id_contratacao: number | null;
  nome: string;
  status: string;
  criado_em: string;
  candidato_nome: string | null;
  empresa_nome: string | null;
  signatarios?: Signatario[] | string | null;
};

function linksDoTermo(row: Termo) {
  let bruto: unknown = row.signatarios;
  if (typeof bruto === "string") {
    try {
      bruto = JSON.parse(bruto) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(bruto)) return [];
  return bruto.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const signer = item as Signatario;
    const url = signer.url?.trim();
    if (!url) return [];
    return [{ nome: signer.nome?.trim() || signer.email?.trim() || "Signatário", url }];
  });
}

const labels: Record<string, string> = {
  gerado: "Gerado",
  enviado: "Aguardando",
  assinado: "Assinado",
  recusado: "Recusado",
  cancelado: "Cancelado",
};

export function EditarTcePage() {
  const { id } = useParams();
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Editar termo</h1>
        <p className="text-sm text-slate-500">Altere os dados e salve. O PDF é gerado de novo com o que estiver neste formulário.</p>
      </div>
      {id ? <GeradorTce editarId={id} /> : null}
    </div>
  );
}

export function GerarTcePage() {
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Gerar termo de compromisso de estágio"
        descricao="Pesquise a empresa, o candidato e a escola para preencher o termo sozinho; depois confira e complete as condições do estágio."
      >
        <ol className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <li className="rounded-full bg-cyan-700 px-3 py-1 text-white">Agora: gerar o PDF para conferir</li>
          <li className="rounded-full bg-slate-100 px-3 py-1 text-slate-500">Depois: enviar para assinatura</li>
        </ol>
      </CabecalhoPagina>
      <GeradorTce />
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
  const [copiado, setCopiado] = useState("");
  const rows = query.data?.data ?? [];

  async function copiar(chave: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setErro("");
      setCopiado(chave);
      window.setTimeout(() => setCopiado((atual) => atual === chave ? "" : atual), 2000);
    } catch {
      setErro("Não foi possível copiar o link. Copie pelo endereço que aparece ao abrir o termo.");
    }
  }
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
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Estagiário</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Enviado</th>
                <th className="px-4 py-3">Assinatura</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const links = linksDoTermo(row);
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 font-semibold">
                      <Link className="text-cyan-800" to={`/termos/${row.id}`}>{row.candidato_nome || row.nome}</Link>
                    </td>
                    <td className="px-4 py-3">{row.empresa_nome || "—"}</td>
                    <td className="px-4 py-3"><Badge value={row.status}>{labels[row.status] ?? row.status}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3">{new Date(row.criado_em).toLocaleDateString("pt-BR")}</td>
                    <td className="px-4 py-3">
                      {links.length === 0 ? <span className="text-slate-400">—</span> : (
                        <ul className="grid gap-1">
                          {links.map((link) => {
                            const chave = `${row.id}:${link.url}`;
                            return (
                              <li key={link.url}>
                                <button
                                  type="button"
                                  className="inline-flex max-w-56 items-center gap-1.5 text-left text-xs font-semibold text-cyan-800"
                                  title={`Copiar link de ${link.nome}`}
                                  onClick={() => void copiar(chave, link.url)}
                                >
                                  <Copy className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{copiado === chave ? "Copiado" : link.nome}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link className="text-slate-400 hover:text-cyan-700" to={`/termos/${row.id}/editar`} aria-label={`Editar TCE de ${row.candidato_nome || row.nome}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
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
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
