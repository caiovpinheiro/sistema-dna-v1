import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";

type Row = {
  id_contratacao: number;
  candidato_nome: string | null;
  candidato_cpf?: string | null;
  empresa_fantasia: string | null;
  empresa_razao: string | null;
  cargo: string | null;
  modalidade?: string | null;
  regime: string;
  situacao: string;
  data_inicio: string | null;
  data_fim_prevista?: string | null;
  data_encerramento?: string | null;
  status: number;
};

const FILTROS = ["q", "regime", "status", "inicio_de", "inicio_ate"];

export function ContratacoesPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  // Muda só ao limpar: os campos (com defaultValue) voltam ao vazio sem perder o foco enquanto se filtra.
  const [limpeza, setLimpeza] = useState(0);
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
  const filtrando = FILTROS.some((chave) => params.get(chave));
  const total = lista ? Number(lista.meta?.total ?? lista.data.length) : null;
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Contratações"
        descricao="Vínculos de candidatos com vagas. Todo vínculo nasce de uma vaga aberta com posição livre; clique no nome para abrir a ficha."
        acoes={<Link to="/contratacoes/nova"><Button><Plus size={16} /> Nova contratação</Button></Link>}
      />
      <Card key={limpeza} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <CampoFiltro rotulo="Buscar" className="sm:col-span-2 lg:col-span-1">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              aria-label="Busca"
              placeholder="Candidato, CPF, empresa ou cargo"
              defaultValue={params.get("q") ?? ""}
              className="pl-9"
              onBlur={(event) => { if (event.target.value.trim() !== (params.get("q") ?? "")) update("q", event.target.value.trim()); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          </div>
        </CampoFiltro>
        <CampoFiltro rotulo="Regime">
          <Select aria-label="Regime" defaultValue={params.get("regime") ?? ""} onChange={(event) => update("regime", event.target.value)}>
            <option value="">Todos</option><option value="clt">CLT</option><option value="estagio">Estágio</option>
          </Select>
        </CampoFiltro>
        <CampoFiltro rotulo="Situação">
          <Select aria-label="Situação" defaultValue={params.get("status") ?? ""} onChange={(event) => update("status", event.target.value)}>
            <option value="">Todas</option><option value="1">Ativa</option><option value="2">Encerrada</option>
          </Select>
        </CampoFiltro>
        <CampoFiltro rotulo="Início a partir de">
          <Input aria-label="Início de" type="date" defaultValue={params.get("inicio_de") ?? ""} onChange={(event) => update("inicio_de", event.target.value)} />
        </CampoFiltro>
        <CampoFiltro rotulo="Início até">
          <Input aria-label="Início até" type="date" defaultValue={params.get("inicio_ate") ?? ""} onChange={(event) => update("inicio_ate", event.target.value)} />
        </CampoFiltro>
      </Card>
      <ResumoResultados total={total} singular="contratação" plural="contratações" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => { setParams(new URLSearchParams()); setLimpeza((valor) => valor + 1); }} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Não foi possível pesquisar as contratações. Atualize a página; se continuar, avise o suporte.</p>
      ) : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <Card className="p-0">
          {/* Tela larga: tabela no padrão de /empresas e /vagas. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Candidato</th>
                  <th>Empresa</th>
                  <th>Vaga</th>
                  <th>Regime</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th>Situação</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((item) => {
                  const empresa = nomeEmpresa(item);
                  return (
                    <tr key={item.id_contratacao}>
                      <td className="max-w-72">
                        <Link className="block truncate" to={`/contratacoes/${item.id_contratacao}`}>{textoPlano(item.candidato_nome) || "Sem nome"}</Link>
                        <p className="truncate text-xs text-slate-500">{item.candidato_cpf ? `CPF ${formatCpf(item.candidato_cpf)} · ` : ""}Nº {item.id_contratacao}</p>
                      </td>
                      <td className="max-w-64">
                        <p className="truncate text-slate-700">{empresa.principal}</p>
                        {empresa.secundario ? <p className="truncate text-xs text-slate-500">{empresa.secundario}</p> : null}
                      </td>
                      <td className="max-w-56">
                        <p className="truncate text-slate-700">{textoPlano(item.cargo) || "—"}</p>
                        {item.modalidade ? <p className="truncate text-xs text-slate-500">{textoPlano(item.modalidade)}</p> : null}
                      </td>
                      <td className="whitespace-nowrap"><Regime regime={item.regime} /></td>
                      <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_inicio)}</td>
                      <td className="whitespace-nowrap"><Fim item={item} /></td>
                      <td className="whitespace-nowrap"><Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge></td>
                      <td className="w-px whitespace-nowrap text-right">
                        <Link to={`/contratacoes/${item.id_contratacao}`} aria-label={`Abrir contratação de ${textoPlano(item.candidato_nome) || item.id_contratacao}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
                          Abrir <ChevronRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Tela estreita: cada contratação vira um bloco compacto, com as mesmas informações. */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {lista.data.map((item) => {
              const empresa = nomeEmpresa(item);
              return (
                <li key={item.id_contratacao} className="grid gap-3 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link className="font-semibold text-cyan-800" to={`/contratacoes/${item.id_contratacao}`}>{textoPlano(item.candidato_nome) || "Sem nome"}</Link>
                      <p className="text-sm text-slate-700">{empresa.principal}</p>
                      <p className="text-xs text-slate-500">{textoPlano(item.cargo) || "—"}</p>
                    </div>
                    <Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-xs text-slate-500">Regime</dt><dd><Regime regime={item.regime} /></dd></div>
                    <div><dt className="text-xs text-slate-500">Início</dt><dd className="tabular-nums text-slate-700">{dateBr(item.data_inicio)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Fim</dt><dd><Fim item={item} /></dd></div>
                    <div className="flex items-end justify-end">
                      <Link to={`/contratacoes/${item.id_contratacao}`} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700">Abrir <ChevronRight size={14} /></Link>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhuma contratação com esses filtros" text="Confira o nome ou o período digitado, ou limpe os filtros para ver todas." />
      ) : <Empty title="Nenhuma contratação registrada" text="Use “Nova contratação” para registrar um vínculo a partir de uma vaga com posição livre." />}
    </div>
  );
}

function nomeEmpresa(item: Pick<Row, "empresa_fantasia" | "empresa_razao">) {
  const fantasia = textoPlano(item.empresa_fantasia);
  const razao = textoPlano(item.empresa_razao);
  return { principal: fantasia || razao || "Sem empresa", secundario: fantasia && razao && razao !== fantasia ? razao : "" };
}

function Regime({ regime }: { regime: string }) {
  return <Badge value={regime}>{regimeLabel[regime] ?? regime}</Badge>;
}

/** Fim do vínculo: a data de encerramento quando houver; senão a previsão de fim, em cinza. */
function Fim({ item }: { item: Pick<Row, "data_encerramento" | "data_fim_prevista"> }) {
  if (item.data_encerramento) {
    return (
      <span className="grid">
        <span className="tabular-nums text-slate-700">{dateBr(item.data_encerramento)}</span>
        <span className="text-xs text-slate-500">encerrado</span>
      </span>
    );
  }
  if (item.data_fim_prevista) {
    return (
      <span className="grid">
        <span className="tabular-nums text-slate-600">{dateBr(item.data_fim_prevista)}</span>
        <span className="text-xs text-slate-500">previsto</span>
      </span>
    );
  }
  return <span className="text-slate-400">—</span>;
}
