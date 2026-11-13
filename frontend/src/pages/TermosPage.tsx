import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { GeradorTce } from "@/components/gerador-tce";
import { Alerta, CabecalhoPagina, FiltroChips } from "@/components/pagina";
import { Badge, Button, Card, Empty, Skeleton, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, textoPlano } from "@/lib/format";

type Signatario = { nome?: string; email?: string; status?: string; url?: string | null };
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

type Assinante = { nome: string; url: string | null; assinou: boolean };

/** Todos os signatários do termo (a coluna vem como jsonb ou texto JSON), com o link quando já foi enviado à ZapSign. */
function signatariosDoTermo(row: Termo): Assinante[] {
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
    return [{
      nome: signer.nome?.trim() || signer.email?.trim() || "Signatário",
      url: signer.url?.trim() || null,
      assinou: (signer.status ?? "").toLowerCase() === "signed",
    }];
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

const FILTROS_STATUS: Array<{ id: string; rotulo: string }> = [
  { id: "", rotulo: "Todos" },
  { id: "gerado", rotulo: "Gerado" },
  { id: "enviado", rotulo: "Aguardando" },
  { id: "assinado", rotulo: "Assinado" },
  { id: "recusado", rotulo: "Recusado" },
];

function dataDoTermo(valor: string) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? dateBr(valor) : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
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
  function pedirExclusao(row: Termo) {
    const nome = row.candidato_nome || row.nome;
    if (!window.confirm(`Excluir o TCE de ${nome}?`)) return;
    excluir.mutate(row.id);
  }
  const statusOpcoes = FILTROS_STATUS.map((item) => ({ ...item, contagem: item.id === status && !query.isLoading && !query.isError ? rows.length : undefined }));
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Termos de estágio"
        descricao="TCEs gerados, enviados à ZapSign e assinados. Abra um termo para conferir o PDF e enviar para assinatura."
        acoes={<Link to="/termos/gerar"><Button><Plus size={16} /> Gerar TCE</Button></Link>}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltroChips rotulo="Situação do termo" opcoes={statusOpcoes} valor={status} onChange={(valor) => setParams(valor ? { status: valor } : {})} />
        <p className="text-sm text-slate-500" aria-live="polite">
          {query.isLoading ? "Carregando…" : query.isError ? null : (
            <><span className="font-bold tabular-nums text-navy-900">{rows.length.toLocaleString("pt-BR")}</span> {rows.length === 1 ? "termo" : "termos"}{rows.length >= 200 ? " (os 200 mais recentes)" : ""}</>
          )}
        </p>
      </div>
      {erro ? <Alerta>{erro}</Alerta> : null}
      {query.isLoading ? <Skeleton className="h-64" /> : query.isError ? (
        <Alerta>Não foi possível carregar os termos. Atualize a página; se continuar, avise o suporte.</Alerta>
      ) : rows.length === 0 ? (
        status ? (
          <Empty title={`Nenhum termo ${(labels[status] ?? status).toLowerCase()}`} text="Escolha outra situação ou “Todos” para ver os demais termos." />
        ) : <Empty title="Nenhum termo gerado" text="Use “Gerar TCE” ou abra uma contratação de estágio para gerar o primeiro termo." />
      ) : (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Estagiário</th>
                  <th>Empresa</th>
                  <th>Situação</th>
                  <th>Gerado em</th>
                  <th>Assinaturas</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const nome = row.candidato_nome || row.nome;
                  return (
                    <tr key={row.id}>
                      <td className="max-w-72"><Link className="block truncate" to={`/termos/${row.id}`}>{nome}</Link></td>
                      <td className="max-w-72"><p className="truncate text-slate-700">{row.empresa_nome ? textoPlano(row.empresa_nome) : "—"}</p></td>
                      <td className="whitespace-nowrap"><Badge value={row.status}>{labels[row.status] ?? row.status}</Badge></td>
                      <td className="whitespace-nowrap tabular-nums text-slate-600">{dataDoTermo(row.criado_em)}</td>
                      <td className="min-w-52"><Assinaturas row={row} copiado={copiado} onCopiar={copiar} /></td>
                      <td className="w-px whitespace-nowrap text-right">
                        <AcoesTermo row={row} nome={nome} excluindo={excluir.isPending} onExcluir={() => pedirExclusao(row)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Tela estreita: cada termo vira um bloco com as mesmas informações e ações. */}
          <ul className="lg:hidden">
            {rows.map((row) => {
              const nome = row.candidato_nome || row.nome;
              return (
                <li key={row.id} className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link className="font-semibold text-cyan-800" to={`/termos/${row.id}`}>{nome}</Link>
                      <p className="text-sm text-slate-700">{row.empresa_nome ? textoPlano(row.empresa_nome) : "Empresa não informada"}</p>
                      <p className="text-xs text-slate-500">Gerado em {dataDoTermo(row.criado_em)}</p>
                    </div>
                    <Badge value={row.status}>{labels[row.status] ?? row.status}</Badge>
                  </div>
                  <Assinaturas row={row} copiado={copiado} onCopiar={copiar} />
                  <AcoesTermo row={row} nome={nome} excluindo={excluir.isPending} onExcluir={() => pedirExclusao(row)} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Editar, excluir e abrir: os mesmos três em tabela e em bloco. */
function AcoesTermo({ row, nome, excluindo, onExcluir }: { row: Termo; nome: string; excluindo: boolean; onExcluir: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
      <Link className="acao acao-cyan inline-flex items-center gap-1" to={`/termos/${row.id}/editar`} aria-label={`Editar TCE de ${nome}`}>
        <Pencil size={13} /> Editar
      </Link>
      <button type="button" className="acao acao-rose inline-flex items-center gap-1" aria-label={`Excluir TCE de ${nome}`} disabled={excluindo} onClick={onExcluir}>
        <Trash2 size={13} /> Excluir
      </button>
      <Link to={`/termos/${row.id}`} aria-label={`Abrir TCE de ${nome}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-cyan-700">
        Abrir <ChevronRight size={14} />
      </Link>
    </div>
  );
}

/**
 * Coluna de assinaturas compacta: "2 de 4 assinaram" numa linha só.
 * Ao abrir, lista cada signatário com o botão de copiar o link de assinatura dele.
 */
function Assinaturas({ row, copiado, onCopiar }: { row: Termo; copiado: string; onCopiar: (chave: string, url: string) => void }) {
  const lista = signatariosDoTermo(row);
  const comLink = lista.filter((item) => item.url);
  if (lista.length === 0) return <span className="text-slate-400">—</span>;
  if (comLink.length === 0 && !lista.some((item) => item.assinou)) {
    return <span className="text-sm text-slate-500">{row.status === "gerado" ? "Ainda não enviado" : "Sem links de assinatura"}</span>;
  }
  const assinaram = lista.filter((item) => item.assinou).length;
  const todos = assinaram === lista.length;
  return (
    <details className="group">
      <summary className="-ml-1.5 inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm font-medium text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <span className={cn("tabular-nums", todos ? "text-emerald-800" : "")}>
          {assinaram} de {lista.length} {assinaram === 1 ? "assinou" : "assinaram"}
        </span>
        <ChevronDown size={14} className="text-slate-400 transition group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="mt-1.5 grid gap-1">
        {lista.map((item, indice) => {
          const chave = `${row.id}:${item.url ?? indice}`;
          return (
            <li key={chave} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-slate-600" title={item.nome}>{item.nome}</span>
              {item.assinou ? (
                <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-emerald-800"><Check size={12} /> Assinou</span>
              ) : item.url ? (
                <button type="button" className="acao acao-cyan inline-flex shrink-0 items-center gap-1" title={`Copiar link de ${item.nome}`} onClick={() => onCopiar(chave, item.url!)}>
                  {copiado === chave ? <><Check size={12} /> Copiado</> : <><Copy size={12} /> Copiar link</>}
                </button>
              ) : <span className="shrink-0 text-slate-400">Sem link</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
