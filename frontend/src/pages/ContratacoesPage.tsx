import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, regimeLabel, situacaoLabel } from "@/lib/format";

type Row = { id_contratacao: number; candidato_nome: string | null; empresa_fantasia: string | null; empresa_razao: string | null; cargo: string | null; regime: string; situacao: string; data_inicio: string | null; status: number };

export function ContratacoesPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  const result = useQuery({ queryKey: ["contratacoes", query], queryFn: () => api<Row[]>(`/api/v1/contratacoes?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "20" })}`) });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
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
        <div><h1 className="text-2xl font-extrabold">Consultar</h1><p className="text-sm text-slate-500">Todo vínculo nasce de uma vaga existente.</p></div>
        <Link to="/contratacoes/nova"><Button>Nova contratação</Button></Link>
      </div>
      <Card className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Input aria-label="Busca" placeholder="Candidato, empresa ou cargo" defaultValue={params.get("q") ?? ""} onBlur={(event) => update("q", event.target.value)} />
        <Select aria-label="Regime" defaultValue={params.get("regime") ?? ""} onChange={(event) => update("regime", event.target.value)}>
          <option value="">Regime</option><option value="clt">CLT</option><option value="estagio">Estágio</option>
        </Select>
        <Select aria-label="Status" defaultValue={params.get("status") ?? ""} onChange={(event) => update("status", event.target.value)}>
          <option value="">Status</option><option value="1">Ativa</option><option value="2">Encerrada</option>
        </Select>
        <Input aria-label="Início de" type="date" defaultValue={params.get("inicio_de") ?? ""} onChange={(event) => update("inicio_de", event.target.value)} />
        <Input aria-label="Início até" type="date" defaultValue={params.get("inicio_ate") ?? ""} onChange={(event) => update("inicio_ate", event.target.value)} />
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao pesquisar contratações.</p> : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr className="border-b"><th className="px-4 py-3">Candidato</th><th>Empresa</th><th>Vaga</th><th>Regime</th><th>Início</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.data.map((item) => (
                <tr key={item.id_contratacao} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/contratacoes/${item.id_contratacao}`}>{item.candidato_nome}</Link></td>
                  <td>{item.empresa_fantasia || item.empresa_razao}</td>
                  <td>{item.cargo}</td>
                  <td>{regimeLabel[item.regime]}</td>
                  <td>{dateBr(item.data_inicio)}</td>
                  <td><Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <p className="px-4 py-3 text-sm font-semibold text-slate-700">{lista.meta?.total ?? 0} contratações</p>
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : <Empty title="Nenhuma contratação" text="Registre um vínculo a partir de uma vaga com posição livre." />}
    </div>
  );
}
