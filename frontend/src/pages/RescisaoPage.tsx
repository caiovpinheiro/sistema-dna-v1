import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Badge, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";

type Row = {
  id_contratacao: number;
  candidato_nome: string | null;
  candidato_cpf?: string | null;
  empresa_fantasia: string | null;
  empresa_razao: string | null;
  cargo: string | null;
  regime: string;
  situacao: string;
  data_inicio: string | null;
  data_fim_prevista?: string | null;
  status: number;
};

export function RescisaoPage() {
  const [params, setParams] = useSearchParams();
  const pagina = numeroPagina(params);
  const q = params.get("q") ?? "";
  const regime = params.get("regime") ?? "";
  // Muda só ao limpar: os campos (com defaultValue) voltam ao vazio.
  const [limpeza, setLimpeza] = useState(0);
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
  const filtrando = Boolean(q || regime);
  const total = lista ? Number(lista.meta?.total ?? lista.data.length) : null;

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Rescisão"
        descricao="Pessoas com vínculo ativo. Abra o registro para gerar a rescisão, demitir e enviar o documento para assinatura."
      />
      <Card key={limpeza} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:max-w-3xl">
        <CampoFiltro rotulo="Buscar">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Busca"
              placeholder="Candidato, CPF, empresa ou cargo"
              defaultValue={q}
              className="pl-9"
              onBlur={(event) => { if (event.target.value.trim() !== q) update("q", event.target.value.trim()); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          </div>
        </CampoFiltro>
        <CampoFiltro rotulo="Regime">
          <Select aria-label="Regime" defaultValue={regime} onChange={(event) => update("regime", event.target.value)}>
            <option value="">Todos</option>
            <option value="clt">CLT</option>
            <option value="estagio">Estágio</option>
          </Select>
        </CampoFiltro>
      </Card>
      <ResumoResultados total={total} singular="vínculo ativo" plural="vínculos ativos" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => { setParams(new URLSearchParams()); setLimpeza((valor) => valor + 1); }} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Não foi possível listar os vínculos ativos. Atualize a página; se continuar, avise o suporte.</p>
      ) : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Candidato</th>
                  <th>Empresa</th>
                  <th>Vaga</th>
                  <th>Regime</th>
                  <th>Início</th>
                  <th>Fim previsto</th>
                  <th>Situação</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((item) => (
                  <tr key={item.id_contratacao}>
                    <td className="max-w-72">
                      <Link className="block truncate" to={`/contratacoes/rescisao/${item.id_contratacao}`}>{textoPlano(item.candidato_nome) || "Sem nome"}</Link>
                      {item.candidato_cpf ? <p className="truncate text-xs tabular-nums text-slate-500">CPF {formatCpf(item.candidato_cpf)}</p> : null}
                    </td>
                    <td className="max-w-64"><p className="truncate text-slate-700">{empresaDe(item)}</p></td>
                    <td className="max-w-56"><p className="truncate text-slate-700">{textoPlano(item.cargo) || "—"}</p></td>
                    <td className="whitespace-nowrap"><Badge value={item.regime}>{regimeLabel[item.regime] ?? item.regime}</Badge></td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_inicio)}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_fim_prevista)}</td>
                    <td className="whitespace-nowrap"><Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge></td>
                    <td className="w-px whitespace-nowrap text-right">
                      <Link to={`/contratacoes/rescisao/${item.id_contratacao}`} aria-label={`Abrir rescisão de ${textoPlano(item.candidato_nome) || item.id_contratacao}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
                        Abrir <ChevronRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-100 lg:hidden">
            {lista.data.map((item) => (
              <li key={item.id_contratacao} className="grid gap-3 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link className="font-semibold text-cyan-800" to={`/contratacoes/rescisao/${item.id_contratacao}`}>{textoPlano(item.candidato_nome) || "Sem nome"}</Link>
                    <p className="text-sm text-slate-700">{empresaDe(item)}</p>
                    <p className="text-xs text-slate-500">{textoPlano(item.cargo) || "—"}</p>
                  </div>
                  <Badge value={item.regime}>{regimeLabel[item.regime] ?? item.regime}</Badge>
                </div>
                <div className="flex items-end justify-between gap-3 text-sm">
                  <p className="text-slate-600">Início <span className="tabular-nums">{dateBr(item.data_inicio)}</span></p>
                  <Link to={`/contratacoes/rescisao/${item.id_contratacao}`} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700">Abrir <ChevronRight size={14} /></Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhum vínculo ativo com esses filtros" text="Confira o nome digitado ou limpe os filtros para ver todos." />
      ) : (
        <Empty title="Nenhum vínculo ativo" text="Quando houver pessoas contratadas, elas aparecem aqui para consulta e demissão." />
      )}
    </div>
  );
}

function empresaDe(item: Pick<Row, "empresa_fantasia" | "empresa_razao">) {
  return textoPlano(item.empresa_fantasia) || textoPlano(item.empresa_razao) || "Sem empresa";
}
