import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Button, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, etapaLabel, origemLabel } from "@/lib/format";

type Row = {
  id: string;
  candidato_nome: string | null;
  empresa_nome: string | null;
  cargo: string | null;
  origem: string;
  etapa: string;
  data_recebimento: string;
  data_encaminhamento: string | null;
};

export function ProcessosPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  const result = useQuery({
    queryKey: ["processos", query],
    queryFn: () => api<Row[]>(`/api/v1/processos?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "30" })}`),
  });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Processos</h1>
          <p className="text-sm text-slate-400">A origem fica no processo, não no cadastro do candidato.</p>
        </div>
        <Link to="/processos/novo"><Button>Novo processo</Button></Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Nome do candidato" placeholder="Nome do candidato" defaultValue={params.get("nome") ?? ""} onBlur={(event) => update("nome", event.target.value)} className="max-w-xs" />
        <Select aria-label="Origem" defaultValue={params.get("origem") ?? ""} onChange={(event) => update("origem", event.target.value)} className="max-w-48">
          <option value="">Origem</option>
          <option value="dnawork">DNAWORK</option>
          <option value="empresa">Empresa</option>
        </Select>
        <Select aria-label="Etapa" defaultValue={params.get("etapa") ?? ""} onChange={(event) => update("etapa", event.target.value)} className="max-w-56">
          <option value="">Etapa</option>
          {Object.entries(etapaLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>
      {result.isLoading ? <Skeleton className="h-40 bg-[#12141a]" /> : null}
      {result.isError ? <p className="text-sm text-rose-300">Não foi possível carregar os processos.</p> : null}
      {result.data ? (
        <div className="grid gap-3">
          <Lista linhas={result.data.data} />
          <Paginacao pagina={pagina} tamanho={30} total={Number(result.data.meta?.total ?? 0)} onPagina={irPara} />
        </div>
      ) : null}
    </div>
  );
}

export function ProcessosRelacionados({ filtro }: { filtro: string }) {
  const result = useQuery({
    queryKey: ["processos", filtro],
    queryFn: () => api<Row[]>(`/api/v1/processos?page=1&pageSize=20&${filtro}`),
  });
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-semibold text-white">Processos seletivos</h2>
      {result.isLoading ? <Skeleton className="h-16 bg-[#12141a]" /> : null}
      {result.data ? <Lista linhas={result.data.data} /> : null}
    </section>
  );
}

function Lista({ linhas }: { linhas: Row[] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
      <table className="data-table">
        <thead>
          <tr><th>Candidato</th><th>Empresa</th><th>Vaga</th><th>Origem</th><th>Etapa</th><th>Recebido</th><th>Encaminhado</th></tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? <tr><td colSpan={7} className="text-slate-400">Nenhum processo com esses filtros.</td></tr> : linhas.map((item) => (
            <tr key={item.id}>
              <td><Link to={`/processos/${item.id}`}>{item.candidato_nome}</Link></td>
              <td>{item.empresa_nome}</td>
              <td>{item.cargo}</td>
              <td>{origemLabel[item.origem]}</td>
              <td>{etapaLabel[item.etapa]}</td>
              <td className="tabular-nums">{dateBr(item.data_recebimento)}</td>
              <td className="tabular-nums">{dateBr(item.data_encaminhamento)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
