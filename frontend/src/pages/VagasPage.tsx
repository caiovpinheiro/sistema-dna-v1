import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BuscaOpcao } from "@/components/busca-opcao";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Select, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { STATUS_VAGA, money, regimeLabel, situacaoLabel } from "@/lib/format";

type Row = { id_vaga: string; cargo: string; empresa: string | null; grupo: string | null; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; salario: number | null };
type Filtros = { empresas: Array<{ id: string; nome: string; grupo_id: string | null; grupo: string | null }>; grupos: Array<{ id: string; nome: string }>; cargos: Array<{ chave: string; nome: string }> };
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
  const cargoAtual = params.get("cargo_chave") ?? "";
  const opcoesCargo = (filtros.data?.data.cargos ?? []).map((item) => ({ id: item.chave, label: item.nome }));
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
        <BuscaOpcao ariaLabel="Cargo" placeholder="Cargo" value={cargoAtual} opcoes={opcoesCargo} onChange={(id) => { if (id !== cargoAtual) update("cargo_chave", id); }} />
        <BuscaOpcao ariaLabel="Grupo" placeholder="Grupo" value={grupoAtual} opcoes={opcoesGrupo} onChange={(id) => { if (id !== grupoAtual) trocarGrupo(id); }} />
        <BuscaOpcao ariaLabel="Empresa" placeholder="Empresa" value={params.get("id_empresa") ?? ""} opcoes={opcoesEmpresa} onChange={(id) => { if (id !== (params.get("id_empresa") ?? "")) update("id_empresa", id); }} />
        <Select aria-label="Modalidade" defaultValue={params.get("tipo_vaga") ?? ""} onChange={(event) => update("tipo_vaga", event.target.value)}>
          <option value="">Modalidade</option>
          {modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}
        </Select>
        <Select aria-label="Situação" defaultValue={params.get("situacao") ?? ""} onChange={(event) => update("situacao", event.target.value)}>
          <option value="">Situação</option>
          {STATUS_VAGA.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
        </Select>
      </Card>
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? <p className="text-rose-600">Erro ao listar vagas. Se a migration de quantidade ainda não foi aplicada, a consulta fica indisponível.</p> : lista && (lista.data.length || Number(lista.meta?.total ?? 0) > 0) ? (
        <div className="grid gap-3">
          {lista.data.map((item) => (
            <div key={item.id_vaga} className="relative rounded-2xl border border-slate-200 bg-white shadow-sm hover:border-cyan-200">
              {/* O status fica fora do link: clicar nele muda a situação, não abre a vaga. */}
              <Link to={`/vagas/${item.id_vaga}`} className="block p-4 pr-36">
                <h2 className="font-bold">{item.cargo}</h2>
                <p className="text-sm text-slate-500">{item.empresa ?? "Sem empresa"}{item.grupo ? ` · ${item.grupo}` : ""} · {money(item.salario)}</p>
                <p className="mt-3 text-sm font-semibold text-navy-900">{item.quantidade_posicoes ?? "—"} posições · {item.ocupadas} preenchidas · {item.disponiveis ?? "—"} disponíveis</p>
                <p className="text-xs text-slate-500">{regimeLabel[item.regime]}</p>
              </Link>
              <StatusEditavel vaga={item} />
            </div>
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

/** Selo de status clicável: escolhe a nova situação e confirma antes de gravar no Lightsail e no Postgres. */
function StatusEditavel({ vaga }: { vaga: Row }) {
  const client = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nova, setNova] = useState<string | null>(null);
  const salvar = useMutation({
    mutationFn: (situacao: string) => api(`/api/v1/vagas/${vaga.id_vaga}`, { method: "PATCH", body: JSON.stringify({ situacao }) }),
    onSuccess: async () => {
      setNova(null);
      await client.invalidateQueries({ queryKey: ["vagas"] });
    },
  });
  function fechar() {
    setAberto(false);
    setNova(null);
    salvar.reset();
  }
  return (
    <div className="absolute right-4 top-4 flex flex-col items-end">
      <button type="button" title="Mudar a situação" aria-haspopup="menu" aria-expanded={aberto} onClick={() => (aberto ? fechar() : setAberto(true))} className="rounded-full focus:outline-none focus:ring-2 focus:ring-cyan-700/40">
        <Badge value={vaga.situacao}>{situacaoLabel[vaga.situacao] ?? vaga.situacao} ▾</Badge>
      </button>
      {aberto ? (
        <div role="menu" className="z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          {nova ? (
            <div className="grid gap-3">
              <p className="text-sm text-slate-700">Mudar <strong>{vaga.cargo}</strong> de <strong>{situacaoLabel[vaga.situacao]}</strong> para <strong>{situacaoLabel[nova]}</strong>?</p>
              {salvar.error ? <p role="alert" className="text-xs text-rose-600">{salvar.error instanceof ApiError ? salvar.error.message : "Não foi possível mudar a situação."}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setNova(null); salvar.reset(); }}>Voltar</Button>
                <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate(nova, { onSuccess: () => setAberto(false) })}>{salvar.isPending ? "Salvando…" : "Confirmar"}</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-1">
              <p className="px-1 pb-1 text-xs text-slate-500">Mudar a situação para</p>
              {STATUS_VAGA.filter((item) => item.id !== vaga.situacao).map((item) => (
                <button key={item.id} type="button" role="menuitem" className="rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100" onClick={() => setNova(item.id)}>{item.nome}</button>
              ))}
              <button type="button" className="mt-1 rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100" onClick={fechar}>Cancelar</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
