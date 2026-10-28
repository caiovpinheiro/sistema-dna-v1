import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, regimeLabel, situacaoLabel } from "@/lib/format";

type Row = {
  id_contratacao: number;
  candidato_nome: string | null;
  empresa_fantasia: string | null;
  empresa_razao: string | null;
  cargo: string | null;
  regime: string;
  situacao: string;
  data_inicio: string | null;
  status: number;
};

export function RescisaoPage() {
  const [params, setParams] = useSearchParams();
  const pagina = numeroPagina(params);
  const q = params.get("q") ?? "";
  const regime = params.get("regime") ?? "";
  const result = useQuery({
    queryKey: ["rescisao", q, regime, pagina],
    queryFn: () => api<Row[]>(`/api/v1/contratacoes?${new URLSearchParams({
      status: "1",
      page: String(pagina),
      pageSize: "20",
      ...(q ? { q } : {}),
      ...(regime ? { regime } : {}),
    })}`),
  });

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
      <div>
        <h1 className="text-2xl font-extrabold">Rescisão</h1>
        <p className="text-sm text-slate-500">Pessoas com vínculo ativo. Abra o registro para consultar e demitir.</p>
      </div>
      <Card className="grid gap-3 md:grid-cols-3">
        <Input aria-label="Busca" placeholder="Candidato, empresa ou cargo" defaultValue={q} onBlur={(event) => update("q", event.target.value)} />
        <Select aria-label="Regime" defaultValue={regime} onChange={(event) => update("regime", event.target.value)}>
          <option value="">Regime</option>
          <option value="clt">CLT</option>
          <option value="estagio">Estágio</option>
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : null}
      {result.isError ? <p className="text-rose-600">Erro ao listar vínculos ativos.</p> : null}
      {!result.isLoading && !result.isError && lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr className="border-b">
                <th className="px-4 py-3">Candidato</th>
                <th>Empresa</th>
                <th>Vaga</th>
                <th>Regime</th>
                <th>Início</th>
                <th>Situação</th>
                <th className="pr-4 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.data.map((item) => (
                <tr key={item.id_contratacao} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-semibold">{item.candidato_nome}</td>
                  <td>{item.empresa_fantasia || item.empresa_razao}</td>
                  <td>{item.cargo}</td>
                  <td>{regimeLabel[item.regime]}</td>
                  <td>{dateBr(item.data_inicio)}</td>
                  <td><Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge></td>
                  <td className="pr-4 text-right">
                    <Link to={`/contratacoes/rescisao/${item.id_contratacao}`}>
                      <Button variant="secondary">Ver detalhes</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <p className="px-4 py-3 text-sm font-semibold text-slate-700">{lista.meta?.total ?? 0} vínculos ativos</p>
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : null}
      {!result.isLoading && !result.isError && (!lista || (!lista.data.length && Number(lista.meta?.total ?? 0) === 0)) ? (
        <Empty title="Nenhum vínculo ativo" text="Quando houver pessoas contratadas, elas aparecem aqui para consulta e demissão." />
      ) : null}
    </div>
  );
}
