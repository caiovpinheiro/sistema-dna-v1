import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { BuscaOpcao } from "@/components/busca-opcao";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Input, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { money, regimeLabel, situacaoLabel } from "@/lib/format";

type Row = { id_vaga: string; cargo: string; empresa: string | null; grupo: string | null; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; salario: number | null };
type Filtros = { empresas: Array<{ id: string; nome: string; grupo_id: string | null; grupo: string | null }>; grupos: Array<{ id: string; nome: string }> };
type Mode = { id: number; descricao: string };

export function VagasPage() {
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(params.entries());
  const pagina = numeroPagina(params);
  const result = useQuery({ queryKey: ["vagas", query], queryFn: () => api<Row[]>(`/api/v1/vagas?${new URLSearchParams({ ...query, page: String(pagina), pageSize: "20" })}`) });
  const filtros = useQuery({ queryKey: ["vagas-filtros"], queryFn: () => api<Filtros>("/api/v1/vagas/filtros") });
  const modes = useQuery({ queryKey: ["modalidades"], queryFn: () => api<Mode[]>("/api/v1/modalidades") });
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  }
  function trocarGrupo(grupo: string) {
    const next = new URLSearchParams(params);
    if (grupo) next.set("grupo_id", grupo); else next.delete("grupo_id");
    // Empresa de outro grupo não combina com o grupo novo.
    const empresa = filtros.data?.data.empresas.find((item) => item.id === next.get("id_empresa"));
    if (grupo && empresa && empresa.grupo_id !== grupo) next.delete("id_empresa");
    next.delete("page");
    setParams(next);
  }
  const grupoAtual = params.get("grupo_id") ?? "";
  const opcoesGrupo = (filtros.data?.data.grupos ?? []).map((item) => ({ id: item.id, label: item.nome }));
  const opcoesEmpresa = (filtros.data?.data.empresas ?? [])
    .filter((item) => !grupoAtual || item.grupo_id === grupoAtual)
    .map((item) => ({ id: item.id, label: item.nome, detalhe: item.grupo ?? undefined }));
  function irPara(paginaDestino: number) {
    const next = new URLSearchParams(params);
    if (paginaDestino <= 1) next.delete("page"); else next.set("page", String(paginaDestino));
    setParams(next);
  }
  const lista = result.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">Vagas</h1><p className="text-sm text-slate-500">Cada vaga tem capacidade própria, mesmo com cargos iguais.</p></div>
        <Link to="/grupos-empresas?aba=vaga"><Button>Nova vaga</Button></Link>
      </div>
      <Card className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Input aria-label="Cargo" placeholder="Cargo" defaultValue={params.get("cargo") ?? ""} onBlur={(event) => update("cargo", event.target.value)} />
        <BuscaOpcao ariaLabel="Grupo" placeholder="Grupo" value={grupoAtual} opcoes={opcoesGrupo} onChange={(id) => { if (id !== grupoAtual) trocarGrupo(id); }} />
        <BuscaOpcao ariaLabel="Empresa" placeholder="Empresa" value={params.get("id_empresa") ?? ""} opcoes={opcoesEmpresa} onChange={(id) => { if (id !== (params.get("id_empresa") ?? "")) update("id_empresa", id); }} />
        <Select aria-label="Modalidade" defaultValue={params.get("tipo_vaga") ?? ""} onChange={(event) => update("tipo_vaga", event.target.value)}>
          <option value="">Modalidade</option>
          {modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}
        </Select>
        <Select aria-label="Situação" defaultValue={params.get("situacao") ?? ""} onChange={(event) => update("situacao", event.target.value)}>
          <option value="">Situação</option>
          <option value="aberta">Aberta</option>
          <option value="preenchida">Preenchida</option>
          <option value="encerrada">Encerrada</option>
          <option value="desativada">Desativada</option>
          <option value="capacidade_pendente">Capacidade pendente</option>
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao listar vagas. Se a migration de quantidade ainda não foi aplicada, a consulta fica indisponível.</p> : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <div className="grid gap-3">
          {lista.data.map((item) => (
            <Link key={item.id_vaga} to={`/vagas/${item.id_vaga}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-cyan-200">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold">{item.cargo}</h2>
                  <p className="text-sm text-slate-500">{item.empresa ?? "Sem empresa"}{item.grupo ? ` · ${item.grupo}` : ""} · {money(item.salario)}</p>
                </div>
                <Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold text-navy-900">{item.quantidade_posicoes ?? "—"} posições · {item.ocupadas} preenchidas · {item.disponiveis ?? "—"} disponíveis</p>
              <p className="text-xs text-slate-500">{regimeLabel[item.regime]}</p>
            </Link>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{lista.meta?.total ?? 0} registros</p>
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </div>
      ) : <Empty title="Nenhuma vaga" text="Crie uma vaga vinculada a uma empresa existente." />}
    </div>
  );
}
