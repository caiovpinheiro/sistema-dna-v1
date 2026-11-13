import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus, Search } from "lucide-react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LinhaPreview, PreviewFlutuante, useLinhaPreview } from "@/components/preview";
import { Paginacao, numeroPagina, tamanhoPagina } from "@/components/paginacao";
import { CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Button, Badge, Card, Empty, Input, Select, Skeleton, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { dataHoraBr, formatCnpj, formatPhone } from "@/lib/format";

type UsoPortal = { ultimo_login: string | null; ultimo_uso: string | null; logins: number; email: string | null };
type Row = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string; cidade: string | null; uf: string | null; status: number | null; acesso_portal?: boolean; uso_portal?: UsoPortal | null };

function usoDoPortal(item: { acesso_portal?: boolean; uso_portal?: UsoPortal | null }) {
  const uso = item.uso_portal;
  if (!item.acesso_portal && !uso?.ultimo_login) return { valor: "encerrada", texto: "Sem login", detalhe: "Sem login no portal" };
  if (!uso?.ultimo_login) return { valor: "pausada", texto: "Nunca acessou", detalhe: "Login criado, ainda sem acesso" };
  const maisRecente = uso.ultimo_uso && uso.ultimo_uso > uso.ultimo_login ? uso.ultimo_uso : uso.ultimo_login;
  const acao = maisRecente === uso.ultimo_login ? "Entrou" : "Usou";
  const entradas = uso.logins === 1 ? "1 entrada" : `${uso.logins} entradas`;
  const quando = dataHoraBr(maisRecente);
  return { valor: "ativa", texto: quando, detalhe: `${acao} em ${quando} · ${entradas}` };
}
type Detail = Row & { email: string | null; telefone: string | null; celular: string | null; responsavel: string | null; bairro: string | null };

export function EmpresasPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  const tamanho = tamanhoPagina(params);
  const result = useQuery({ queryKey: ["empresas", query], queryFn: () => api<Row[]>(`/api/v1/empresas?${new URLSearchParams({ ...query, page: String(pagina), pageSize: String(tamanho) })}`) });
  const preview = useLinhaPreview();
  const detalhe = useQuery({
    queryKey: ["empresa", preview.id],
    queryFn: () => api<Detail>(`/api/v1/empresas/${preview.id}`),
    enabled: Boolean(preview.id),
    staleTime: 60_000,
  });
  const aberto = result.data?.data.find((item) => item.id_empresa === preview.id);
  const ficha = detalhe.data?.data;
  function pesquisar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ["q", "cidade", "uf", "status", "acesso"]) {
      const value = String(data.get(key) ?? "").trim();
      if (value) next.set(key, value);
    }
    if (tamanho !== 20) next.set("pageSize", String(tamanho));
    // Mesma busca de novo: recarrega a lista (senão o clique não faria nada).
    if (next.toString() === params.toString()) void result.refetch();
    else setParams(next);
  }
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  function trocarTamanho(novo: number) {
    const next = new URLSearchParams(params);
    if (novo === 20) next.delete("pageSize"); else next.set("pageSize", String(novo));
    next.delete("page");
    setParams(next);
  }
  const lista = result.data;
  const filtrando = ["q", "cidade", "uf", "status", "acesso"].some((chave) => params.get(chave));
  const total = lista ? Number(lista.meta?.total ?? lista.data.length) : null;
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Empresas"
        descricao="Empresas clientes com o acesso ao portal. Passe o mouse numa linha para ver o contato; clique no nome para abrir a ficha."
        acoes={<Link to="/grupos-empresas?aba=empresa"><Button><Plus size={16} /> Nova empresa</Button></Link>}
      />
      <Card>
        {/* key: ao limpar os filtros, os campos voltam ao vazio. */}
        <form key={params.toString()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-end" onSubmit={pesquisar}>
          <CampoFiltro rotulo="Buscar" className="sm:col-span-2 lg:col-span-1">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input name="q" aria-label="Busca" placeholder="CNPJ, razão social ou nome fantasia" defaultValue={params.get("q") ?? ""} className="pl-9" />
            </div>
          </CampoFiltro>
          <CampoFiltro rotulo="Cidade">
            <Input name="cidade" aria-label="Cidade" placeholder="Todas" defaultValue={params.get("cidade") ?? ""} />
          </CampoFiltro>
          <CampoFiltro rotulo="UF">
            <Input name="uf" aria-label="UF" placeholder="SP" maxLength={2} defaultValue={params.get("uf") ?? ""} className="uppercase" />
          </CampoFiltro>
          <CampoFiltro rotulo="Status">
            <Select name="status" aria-label="Status" defaultValue={params.get("status") ?? ""}>
              <option value="">Todos</option>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </CampoFiltro>
          <CampoFiltro rotulo="Portal da empresa">
            <Select name="acesso" aria-label="Acesso ao portal" defaultValue={params.get("acesso") ?? ""}>
              <option value="">Todos</option>
              <option value="acessou">Já acessou</option>
              <option value="nunca">Nunca acessou</option>
              <option value="sem">Sem login</option>
            </Select>
          </CampoFiltro>
          <Button type="submit" className="h-10 sm:col-span-2 lg:col-span-1">{result.isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {result.isFetching ? "Pesquisando…" : "Pesquisar"}</Button>
        </form>
      </Card>
      <ResumoResultados total={total} singular="empresa" plural="empresas" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => setParams(new URLSearchParams())} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Não foi possível pesquisar as empresas. Atualize a página; se continuar, avise o suporte.</p>
      ) : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Cidade</th>
                <th>Portal</th>
                <th>Status</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.data.map((item) => {
                const uso = usoDoPortal(item);
                return (
                <tr key={item.id_empresa} onMouseEnter={(event) => preview.mostrar(item.id_empresa, event)} onMouseLeave={preview.esconder}>
                  <td className="max-w-80">
                    <Link className="block truncate" to={`/empresas/${item.id_empresa}`}>{item.nome_fantasia || item.razao_social}</Link>
                    {item.nome_fantasia ? <p className="truncate text-xs text-slate-500">{item.razao_social}</p> : null}
                  </td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(item.cnpj)}</td>
                  <td className="whitespace-nowrap text-slate-600">{[item.cidade, item.uf].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="whitespace-nowrap">
                    <Badge value={!item.acesso_portal && uso.valor === "ativa" ? "encerrada" : uso.valor}>{rotuloPortal(item.acesso_portal, uso.valor)}</Badge>
                    {uso.valor === "ativa" ? <p className="mt-0.5 text-xs text-slate-500">Último uso {uso.texto}</p> : null}
                  </td>
                  <td className="whitespace-nowrap"><StatusEmpresa status={item.status} /></td>
                  <td className="w-px whitespace-nowrap text-right">
                    <Link to={`/empresas/${item.id_empresa}`} aria-label={`Abrir ${item.nome_fantasia || item.razao_social}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
                      Abrir <ChevronRight size={14} />
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={tamanho} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} onTamanho={trocarTamanho} />
          </div>
          <PreviewFlutuante box={preview.box}>
            {aberto ? (
              <LinhaPreview
                titulo={aberto.nome_fantasia || aberto.razao_social}
                linhas={[
                  aberto.nome_fantasia ? aberto.razao_social : null,
                  formatCnpj(aberto.cnpj),
                  ficha?.email,
                  ficha?.telefone ? formatPhone(ficha.telefone) : null,
                  ficha?.celular ? formatPhone(ficha.celular) : null,
                  [ficha?.bairro, aberto.cidade, aberto.uf].filter(Boolean).join(" / ") || null,
                  ficha?.responsavel ? `Responsável ${ficha.responsavel}` : null,
                  aberto.acesso_portal ? "Com acesso ao portal" : "Sem acesso ao portal",
                  usoDoPortal(aberto).detalhe,
                  aberto.status === 1 ? "Ativo" : "Inativo",
                ]}
              />
            ) : null}
          </PreviewFlutuante>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhuma empresa com esses filtros" text="Confira o CNPJ ou o nome digitado, ou limpe os filtros para ver todas." />
      ) : <Empty title="Nenhuma empresa cadastrada" text="Use “Nova empresa” para cadastrar a primeira empresa cliente." />}
    </div>
  );
}

/** Um selo só para o portal: sem login, login criado sem uso, em uso ou acesso removido depois de usar. */
function rotuloPortal(acesso: boolean | undefined, uso: string) {
  if (uso === "ativa") return acesso ? "Usa o portal" : "Acesso removido";
  return uso === "pausada" ? "Nunca acessou" : "Sem login";
}

/** Ativo/inativo com um ponto colorido: lê rápido sem competir com o selo do portal. */
function StatusEmpresa({ status }: { status: number | null }) {
  if (status !== 1 && status !== 0) return <span className="text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", status === 1 ? "text-emerald-800" : "text-slate-500")}>
      <span aria-hidden className={cn("h-2 w-2 rounded-full", status === 1 ? "bg-emerald-500" : "bg-slate-400")} />
      {status === 1 ? "Ativo" : "Inativo"}
    </span>
  );
}
