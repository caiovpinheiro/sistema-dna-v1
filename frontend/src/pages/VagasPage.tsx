import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { BuscaOpcao } from "@/components/busca-opcao";
import { Paginacao, numeroPagina } from "@/components/paginacao";
import { Badge, Button, Card, Empty, Select, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { STATUS_VAGA, dateBr, diasEmAberto, money, regimeLabel, situacaoLabel, textoDiasEmAberto } from "@/lib/format";

type Row = { id_vaga: string; cargo: string; empresa: string | null; grupo: string | null; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; salario: number | null; dataabertura: string | null };
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
        <Card className="p-0">
          {/* Tela larga: tabela gerencial no padrão de /empresas. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr className="border-b">
                  <th className="px-4 py-3">Cargo</th>
                  <th className="pr-4">Empresa / Grupo</th>
                  <th className="pr-4">Modalidade</th>
                  <th className="pr-4 text-right">Salário</th>
                  <th className="pr-4">Posições</th>
                  <th className="pr-4 text-center">Disponíveis</th>
                  <th className="pr-4">Tempo em aberto</th>
                  <th className="pr-4">Situação</th>
                </tr>
              </thead>
              <tbody>
                {lista.data.map((item) => (
                  <tr key={item.id_vaga} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold"><Link className="text-cyan-800" to={`/vagas/${item.id_vaga}`}>{item.cargo}</Link></td>
                    <td className="py-3 pr-4">
                      <p className="text-slate-700">{item.empresa ?? "Sem empresa"}</p>
                      {item.grupo ? <p className="text-xs text-slate-500">{item.grupo}</p> : null}
                    </td>
                    <td className="pr-4"><Modalidade regime={item.regime} /></td>
                    <td className="whitespace-nowrap pr-4 text-right tabular-nums">{money(item.salario)}</td>
                    <td className="pr-4"><Ocupacao vaga={item} /></td>
                    <td className="pr-4 text-center"><Disponiveis valor={item.disponiveis} /></td>
                    <td className="whitespace-nowrap pr-4"><TempoAberto situacao={item.situacao} abertura={item.dataabertura} /></td>
                    <td className="pr-4"><StatusEditavel vaga={item} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Tela estreita: cada vaga vira um bloco compacto, com as mesmas informações. */}
          <ul className="divide-y divide-slate-100 lg:hidden">
            {lista.data.map((item) => (
              <li key={item.id_vaga} className="grid gap-3 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link className="font-semibold text-cyan-800" to={`/vagas/${item.id_vaga}`}>{item.cargo}</Link>
                    <p className="text-sm text-slate-700">{item.empresa ?? "Sem empresa"}</p>
                    {item.grupo ? <p className="text-xs text-slate-500">{item.grupo}</p> : null}
                  </div>
                  <StatusEditavel vaga={item} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Modalidade</dt><dd><Modalidade regime={item.regime} /></dd></div>
                  <div><dt className="text-xs text-slate-500">Salário</dt><dd className="tabular-nums">{money(item.salario)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Posições</dt><dd><Ocupacao vaga={item} /></dd></div>
                  <div><dt className="text-xs text-slate-500">Disponíveis</dt><dd><Disponiveis valor={item.disponiveis} /></dd></div>
                  <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-slate-500">Tempo em aberto</dt><dd><TempoAberto situacao={item.situacao} abertura={item.dataabertura} /></dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <p className="px-4 py-3 text-xs text-slate-500">{lista.meta?.total ?? 0} registros</p>
            <Paginacao pagina={pagina} tamanho={20} total={Number(lista.meta?.total ?? 0)} onPagina={irPara} />
          </div>
        </Card>
      ) : <Empty title="Nenhuma vaga" text="Crie uma vaga vinculada a uma empresa existente." />}
    </div>
  );
}

function Modalidade({ regime }: { regime: string }) {
  return <Badge value={regime}>{regimeLabel[regime] ?? regime}</Badge>;
}

/** Preenchidas sobre o total, com uma barra fina de ocupação. */
function Ocupacao({ vaga }: { vaga: Row }) {
  const total = vaga.quantidade_posicoes;
  const pct = total && total > 0 ? Math.min(100, Math.round((vaga.ocupadas / total) * 100)) : 0;
  const cor = total && vaga.ocupadas > total ? "bg-amber-500" : total && vaga.ocupadas >= total ? "bg-emerald-500" : "bg-cyan-600";
  return (
    <div className="grid w-28 gap-1" title={`${vaga.ocupadas} preenchidas de ${total ?? "—"} posições`}>
      <p className="text-xs text-slate-600"><span className="font-semibold tabular-nums text-navy-900">{vaga.ocupadas}</span>/<span className="tabular-nums">{total ?? "—"}</span> preenchidas</p>
      {total ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={vaga.ocupadas} aria-label="Ocupação das posições">
          <div className={`h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function Disponiveis({ valor }: { valor: number | null }) {
  if (valor == null) return <span className="text-slate-400">—</span>;
  const estilo = valor > 0 ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500";
  return <span className={`inline-flex min-w-8 justify-center rounded-md px-2 py-0.5 text-sm font-bold tabular-nums ${estilo}`}>{valor}</span>;
}

function TempoAberto({ situacao, abertura }: { situacao: string; abertura: string | null }) {
  const dias = situacao === "aberta" ? diasEmAberto(abertura) : null;
  if (dias == null) return <span className="text-slate-400">—</span>;
  const cor = dias >= 60 ? "text-rose-700" : dias >= 30 ? "text-amber-700" : "text-slate-600";
  return (
    <span className="grid" title={`Desde ${dateBr(abertura)}`}>
      <span className={`font-semibold ${cor}`}>{textoDiasEmAberto(dias)}</span>
      <span className="text-xs text-slate-500">desde {dateBr(abertura)}</span>
    </span>
  );
}

/** Selo de status clicável: escolhe a nova situação e confirma antes de gravar no Lightsail e no Postgres. */
function StatusEditavel({ vaga }: { vaga: Row }) {
  const client = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // O menu flutua fora da tabela (que rola na horizontal) e acompanha o selo ao rolar a página.
  useEffect(() => {
    if (!aberto) return;
    function posicionar() {
      const rect = botao.current?.getBoundingClientRect();
      if (!rect) return;
      const largura = 256;
      setPos({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - largura, window.innerWidth - largura - 8)) });
    }
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
      setPos(null);
    };
  }, [aberto]);
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
    <div className="shrink-0">
      <button ref={botao} type="button" title="Mudar a situação" aria-haspopup="menu" aria-expanded={aberto} onClick={() => (aberto ? fechar() : setAberto(true))} className="rounded-full focus:outline-none focus:ring-2 focus:ring-cyan-700/40">
        <Badge value={vaga.situacao}>{situacaoLabel[vaga.situacao] ?? vaga.situacao} ▾</Badge>
      </button>
      {aberto && pos ? createPortal(
        <div role="menu" className="fixed z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg" style={{ top: pos.top, left: pos.left }}>
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
        </div>,
        // Dentro do canvas do app, para herdar o tema claro/escuro.
        botao.current?.closest(".app-canvas") ?? document.body,
      ) : null}
    </div>
  );
}
