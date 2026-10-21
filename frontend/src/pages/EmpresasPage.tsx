import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCnpj } from "@/lib/format";

type Row = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string; cidade: string | null; uf: string | null; status: number | null };

export function EmpresasPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const result = useQuery({ queryKey: ["empresas", query], queryFn: () => api<Row[]>(`/api/v1/empresas?${new URLSearchParams({ page: "1", pageSize: "20", ...query })}`) });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Empresas</h1><p className="text-sm text-slate-500">Pesquisa por CNPJ, razão social ou nome fantasia.</p></div>
        <Link to="/empresas/nova"><Button>Nova empresa</Button></Link>
      </div>
      <Card className="grid gap-3 md:grid-cols-4">
        <Input aria-label="Busca" placeholder="CNPJ, razão ou fantasia" defaultValue={params.get("q") ?? ""} onBlur={(event) => update("q", event.target.value)} />
        <Input aria-label="Cidade" placeholder="Cidade" defaultValue={params.get("cidade") ?? ""} onBlur={(event) => update("cidade", event.target.value)} />
        <Input aria-label="UF" placeholder="UF" maxLength={2} defaultValue={params.get("uf") ?? ""} onBlur={(event) => update("uf", event.target.value)} />
        <Select aria-label="Status" defaultValue={params.get("status") ?? ""} onChange={(event) => update("status", event.target.value)}>
          <option value="">Status</option><option value="1">1</option><option value="0">0</option>
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao pesquisar empresas.</p> : result.data?.data.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr className="border-b"><th className="px-4 py-3">Razão social</th><th>Fantasia</th><th>CNPJ</th><th>Cidade</th></tr></thead>
            <tbody>
              {result.data.data.map((item) => (
                <tr key={item.id_empresa} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/empresas/${item.id_empresa}`}>{item.razao_social}</Link></td>
                  <td>{item.nome_fantasia || "—"}</td>
                  <td>{formatCnpj(item.cnpj)}</td>
                  <td>{[item.cidade, item.uf].filter(Boolean).join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-slate-500">{result.data.meta?.total ?? 0} registros</p>
        </Card>
      ) : <Empty title="Nenhuma empresa" text="Cadastre a primeira empresa cliente." />}
    </div>
  );
}
