import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCpf, formatPhone } from "@/lib/format";

type Row = { id_candidato: string; nome: string; cpf: string; email: string; celular: string | null; cidade: string | null; estado: string | null };

export function CandidatosPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const result = useQuery({
    queryKey: ["candidatos", query],
    queryFn: () => api<Row[]>(`/api/v1/candidatos?${new URLSearchParams({ page: "1", pageSize: "20", ...query })}`),
  });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Candidatos</h1><p className="text-sm text-slate-500">Cadastro independente da empresa.</p></div>
        <Link to="/candidatos/novo"><Button>Novo candidato</Button></Link>
      </div>
      <Card className="grid gap-3 md:grid-cols-4">
        <Input aria-label="Nome" placeholder="Nome" defaultValue={params.get("nome") ?? ""} onBlur={(event) => update("nome", event.target.value)} />
        <Input aria-label="CPF" placeholder="CPF" defaultValue={params.get("cpf") ?? ""} onBlur={(event) => update("cpf", event.target.value)} />
        <Input aria-label="E-mail" placeholder="E-mail" defaultValue={params.get("email") ?? ""} onBlur={(event) => update("email", event.target.value)} />
        <Input aria-label="Telefone" placeholder="Telefone" defaultValue={params.get("telefone") ?? ""} onBlur={(event) => update("telefone", event.target.value)} />
        <Input aria-label="Cidade" placeholder="Cidade" defaultValue={params.get("cidade") ?? ""} onBlur={(event) => update("cidade", event.target.value)} />
        <Input aria-label="UF" placeholder="UF" maxLength={2} defaultValue={params.get("uf") ?? ""} onBlur={(event) => update("uf", event.target.value)} />
        <Select aria-label="Situação" defaultValue={params.get("situacao") ?? ""} onChange={(event) => update("situacao", event.target.value)}>
          <option value="">Situação do vínculo</option>
          <option value="ativo">Ativo</option>
          <option value="encerrado">Encerrado</option>
          <option value="sem_vinculo">Sem vínculo</option>
        </Select>
        <Select aria-label="Regime" defaultValue={params.get("regime") ?? ""} onChange={(event) => update("regime", event.target.value)}>
          <option value="">Regime</option>
          <option value="clt">CLT</option>
          <option value="estagio">Estágio</option>
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao pesquisar candidatos.</p> : result.data?.data.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr className="border-b"><th className="px-4 py-3">Nome</th><th>CPF</th><th>Contato</th><th>Cidade</th></tr></thead>
            <tbody>
              {result.data.data.map((item) => (
                <tr key={item.id_candidato} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/candidatos/${item.id_candidato}`}>{item.nome}</Link></td>
                  <td>{formatCpf(item.cpf)}</td>
                  <td>{item.email}<div className="text-slate-500">{formatPhone(item.celular)}</div></td>
                  <td>{[item.cidade, item.estado].filter(Boolean).join(" / ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-slate-500">{result.data.meta?.total ?? 0} registros</p>
        </Card>
      ) : <Empty title="Nenhum candidato" text="Ajuste a pesquisa ou cadastre um novo." />}
    </div>
  );
}
