import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { money, regimeLabel, situacaoLabel } from "@/lib/format";

type Row = { id_vaga: string; cargo: string; nome_fantasia: string | null; razao_social: string | null; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; salario: number | null };
type Company = { id_empresa: string; nome_fantasia: string | null; razao_social: string };
type Mode = { id: number; descricao: string };

export function VagasPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const result = useQuery({ queryKey: ["vagas", query], queryFn: () => api<Row[]>(`/api/v1/vagas?${new URLSearchParams({ page: "1", pageSize: "20", ...query })}`) });
  const companies = useQuery({ queryKey: ["empresas-opcoes"], queryFn: () => api<Company[]>("/api/v1/empresas?pageSize=100") });
  const modes = useQuery({ queryKey: ["modalidades"], queryFn: () => api<Mode[]>("/api/v1/modalidades") });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Vagas</h1><p className="text-sm text-slate-500">Cada vaga tem capacidade própria, mesmo com cargos iguais.</p></div>
        <Link to="/vagas/nova"><Button>Nova vaga</Button></Link>
      </div>
      <Card className="grid gap-3 md:grid-cols-4">
        <Input aria-label="Cargo" placeholder="Cargo" defaultValue={params.get("cargo") ?? ""} onBlur={(event) => update("cargo", event.target.value)} />
        <Select aria-label="Empresa" defaultValue={params.get("id_empresa") ?? ""} onChange={(event) => update("id_empresa", event.target.value)}>
          <option value="">Empresa</option>
          {companies.data?.data.map((item) => <option key={item.id_empresa} value={item.id_empresa}>{item.nome_fantasia || item.razao_social}</option>)}
        </Select>
        <Select aria-label="Modalidade" defaultValue={params.get("tipo_vaga") ?? ""} onChange={(event) => update("tipo_vaga", event.target.value)}>
          <option value="">Modalidade</option>
          {modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}
        </Select>
        <Select aria-label="Situação" defaultValue={params.get("situacao") ?? ""} onChange={(event) => update("situacao", event.target.value)}>
          <option value="">Situação</option>
          <option value="aberta">Aberta</option>
          <option value="preenchida">Preenchida</option>
          <option value="encerrada">Encerrada</option>
          <option value="capacidade_pendente">Capacidade pendente</option>
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao listar vagas. Se a migration de quantidade ainda não foi aplicada, a consulta fica indisponível.</p> : result.data?.data.length ? (
        <div className="grid gap-3">
          {result.data.data.map((item) => (
            <Link key={item.id_vaga} to={`/vagas/${item.id_vaga}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-cyan-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">{item.cargo}</h2>
                  <p className="text-sm text-slate-500">{item.nome_fantasia || item.razao_social} · {money(item.salario)}</p>
                </div>
                <Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold text-navy-900">{item.quantidade_posicoes ?? "—"} posições · {item.ocupadas} preenchidas · {item.disponiveis ?? "—"} disponíveis</p>
              <p className="text-xs text-slate-500">{regimeLabel[item.regime]}</p>
            </Link>
          ))}
          <p className="text-xs text-slate-500">{result.data.meta?.total ?? 0} registros</p>
        </div>
      ) : <Empty title="Nenhuma vaga" text="Crie uma vaga vinculada a uma empresa existente." />}
    </div>
  );
}
