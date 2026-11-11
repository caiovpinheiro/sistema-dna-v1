import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LinhaPreview, PreviewFlutuante, useLinhaPreview } from "@/components/preview";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Button, Badge, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
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
  const result = useQuery({ queryKey: ["empresas", query], queryFn: () => api<Row[]>(`/api/v1/empresas?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "20" })}`) });
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
    setParams(next);
  }
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  const lista = result.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Empresas</h1><p className="text-sm text-slate-500">Pesquisa por CNPJ, razão social ou nome fantasia.</p></div>
        <Link to="/grupos-empresas?aba=empresa"><Button>Nova empresa</Button></Link>
      </div>
      <Card>
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_5rem_8rem_12rem_auto] md:items-end" onSubmit={pesquisar}>
          <Input name="q" aria-label="Busca" placeholder="CNPJ, razão ou fantasia" defaultValue={params.get("q") ?? ""} />
          <Input name="cidade" aria-label="Cidade" placeholder="Cidade" defaultValue={params.get("cidade") ?? ""} />
          <Input name="uf" aria-label="UF" placeholder="UF" maxLength={2} defaultValue={params.get("uf") ?? ""} />
          <Select name="status" aria-label="Status" defaultValue={params.get("status") ?? ""}>
            <option value="">Status</option>
            <option value="1">Ativo</option>
            <option value="0">Inativo</option>
          </Select>
          <Select name="acesso" aria-label="Acesso ao portal" defaultValue={params.get("acesso") ?? ""}>
            <option value="">Acesso ao portal</option>
            <option value="acessou">Já acessou</option>
            <option value="nunca">Nunca acessou</option>
            <option value="sem">Sem login</option>
          </Select>
          <Button type="submit">Pesquisar</Button>
        </form>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao pesquisar empresas.</p> : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr className="border-b"><th className="px-4 py-3">Razão social</th><th>Fantasia</th><th>CNPJ</th><th>Cidade</th><th>Portal</th><th>Último uso</th><th>Status</th></tr></thead>
            <tbody>
              {lista.data.map((item) => {
                const uso = usoDoPortal(item);
                return (
                <tr key={item.id_empresa} className="border-b border-slate-100 last:border-0 hover:bg-slate-50" onMouseEnter={(event) => preview.mostrar(item.id_empresa, event)} onMouseLeave={preview.esconder}>
                  <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/empresas/${item.id_empresa}`}>{item.razao_social}</Link></td>
                  <td>{item.nome_fantasia || "—"}</td>
                  <td>{formatCnpj(item.cnpj)}</td>
                  <td>{[item.cidade, item.uf].filter(Boolean).join(" / ") || "—"}</td>
                  <td><Badge value={item.acesso_portal ? "ativa" : "encerrada"}>{item.acesso_portal ? "Com acesso" : "Sem acesso"}</Badge></td>
                  <td><Badge value={uso.valor}>{uso.texto}</Badge></td>
                  <td><Badge value={item.status === 1 ? "ativa" : "encerrada"}>{item.status === 1 ? "Ativo" : item.status === 0 ? "Inativo" : "—"}</Badge></td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <p className="px-4 py-3 text-xs text-slate-500">{lista.meta?.total ?? 0} registros</p>
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
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
      ) : <Empty title="Nenhuma empresa" text="Cadastre a primeira empresa cliente." />}
    </div>
  );
}
