import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, BookOpen, CopyPlus, FileText, History, Plus, Save, Search, Send, Tags } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Alerta, CampoFiltro, FiltroChips } from "@/components/pagina";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

/** Aba "Base de conhecimento" de Configurações (só administrador). API: /api/v1/configuracoes/conhecimento/*. */
const BASE = "/api/v1/configuracoes/conhecimento";

type Categoria = { id: string; slug: string; nome: string; descricao: string | null; ordem: number; ativa: boolean; artigos: number; publicados: number };
type ItemLista = { id: string; slug: string; modulo: string | null; status: string; versao_publicada: number | null; ultima_versao: number; titulo: string; resumo: string | null; categoria: string; categoria_nome: string; desatualizado: boolean; tem_rascunho: boolean; restrito: boolean; atualizado_em: string; revisar_em: string | null };
type Versao = { versao: number; titulo: string; resumo: string | null; conteudo: string; tags: string[]; palavras_chave: string[]; referencia: string | null; fonte: string | null; nota: string | null; restaurada_de: number | null; criado_em: string; atualizado_em: string };
type Detalhe = {
  id: string; slug: string; categoria: { slug: string; nome: string }; modulo: string | null; status: string; versao_publicada: number | null; revisar_em: string | null;
  acesso: { paginas: string[]; integracoes: string[]; somente_admin: boolean }; origem: string; criado_em: string; atualizado_em: string; publicado_em: string | null;
  publicada: Versao | null; rascunho: Versao | null; ultima_versao: number | null;
};
type VersaoLista = { versao: number; titulo: string; nota: string | null; restaurada_de: number | null; criado_em: string; autor: string | null; publicada: boolean; rascunho: boolean };

const erroDe = (e: unknown) => (e instanceof ApiError ? e.message : "");
const dia = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const STATUS: Record<string, string> = { rascunho: "Rascunho", publicado: "Publicado", arquivado: "Arquivado" };
const COR: Record<string, string> = { rascunho: "pausada", publicado: "ativa", arquivado: "encerrada" };
const MODULOS = ["vagas", "empresas", "triagem", "candidatos", "dossies", "processos", "contratacoes", "gestao", "geral"];
const csv = (t: string) => t.split(",").map((x) => x.trim()).filter(Boolean);

export function BaseConhecimento() {
  const [area, setArea] = useState<"artigos" | "categorias" | "busca">("artigos");
  return (
    <div className="grid gap-4">
      <FiltroChips rotulo="Área da base de conhecimento" valor={area} onChange={setArea} opcoes={[{ id: "artigos", rotulo: "Artigos" }, { id: "categorias", rotulo: "Categorias" }, { id: "busca", rotulo: "Testar a busca" }]} />
      {area === "artigos" ? <Artigos /> : area === "categorias" ? <Categorias /> : <TestarBusca />}
    </div>
  );
}

function useCategorias() {
  return useQuery({ queryKey: ["kb", "categorias"], queryFn: () => api<Categoria[]>(`${BASE}/categorias`) });
}

// ------------------------------------------------------------------ artigos

function Artigos() {
  const cats = useCategorias();
  const [f, setF] = useState({ q: "", categoria: "", modulo: "", status: "", desatualizados: false });
  const [termo, setTermo] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setTermo(f.q.trim()), 300); return () => window.clearTimeout(t); }, [f.q]);
  const qs = new URLSearchParams({ limite: "100", ...(termo ? { q: termo } : {}), ...(f.categoria ? { categoria: f.categoria } : {}), ...(f.modulo ? { modulo: f.modulo } : {}), ...(f.status ? { status: f.status } : {}), ...(f.desatualizados ? { desatualizados: "1" } : {}) }).toString();
  const lista = useQuery({ queryKey: ["kb", "artigos", qs], queryFn: () => api<{ itens: ItemLista[]; total: number }>(`${BASE}/artigos?${qs}`) });
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const itens = lista.data?.data.itens ?? [];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="grid gap-3 lg:sticky lg:top-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-500">{lista.data?.data.total ?? 0} artigos</p>
          <Button type="button" className="h-8 px-2.5" onClick={() => { setNovo(true); setAberto(null); }}><Plus size={14} /> Novo artigo</Button>
        </div>
        <CampoFiltro rotulo="Pesquisar"><Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Título, identificador ou tag" /></CampoFiltro>
        <div className="grid grid-cols-2 gap-2">
          <CampoFiltro rotulo="Categoria"><Select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">Todas</option>{(cats.data?.data ?? []).map((c) => <option key={c.id} value={c.slug}>{c.nome}</option>)}</Select></CampoFiltro>
          <CampoFiltro rotulo="Módulo"><Select value={f.modulo} onChange={(e) => setF({ ...f, modulo: e.target.value })}><option value="">Todos</option>{MODULOS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></CampoFiltro>
        </div>
        <FiltroChips rotulo="Status" valor={f.status} onChange={(s) => setF({ ...f, status: s })} opcoes={[{ id: "", rotulo: "Todos" }, { id: "rascunho", rotulo: "Rascunho" }, { id: "publicado", rotulo: "Publicado" }, { id: "arquivado", rotulo: "Arquivado" }]} />
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={f.desatualizados} onChange={() => setF({ ...f, desatualizados: !f.desatualizados })} /> Só desatualizados</label>
        {lista.isLoading ? <Skeleton className="h-40" /> : null}
        <ul className="-mx-4 max-h-[60vh] overflow-auto border-t border-slate-100">
          {itens.map((a) => (
            <li key={a.id} className="border-b border-slate-100 last:border-b-0">
              <button type="button" aria-pressed={aberto === a.id} onClick={() => { setNovo(false); setAberto(a.id); }} className={cn("grid w-full gap-1 px-4 py-2.5 text-left", aberto === a.id ? "bg-cyan-50" : "hover:bg-slate-50")}>
                <span className="text-sm font-semibold text-navy-900">{a.titulo}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <Badge value={COR[a.status]}>{STATUS[a.status]}</Badge>
                  {a.tem_rascunho && a.status !== "rascunho" ? <Badge value="pausada">Rascunho pendente</Badge> : null}
                  {a.desatualizado ? <Badge value="recusado">Revisar</Badge> : null}
                  {a.restrito ? <Badge>Acesso restrito</Badge> : null}
                  <span>{a.categoria_nome}</span>
                </span>
              </button>
            </li>
          ))}
          {!lista.isLoading && !itens.length ? <li className="px-4 py-6 text-sm text-slate-500">Nenhum artigo com estes filtros.</li> : null}
        </ul>
      </Card>
      {novo ? <Editor key="novo" onCriado={(id) => { setNovo(false); setAberto(id); }} />
        : aberto ? <Editor key={aberto} id={aberto} onCriado={setAberto} />
          : <Empty title="Nenhum artigo aberto" text="Escolha um artigo para editar, publicar ou ver o histórico, ou crie um novo. A base de produção é preenchida pela equipe da DNA Work; aqui nada é publicado sozinho." />}
    </div>
  );
}

type Form = { slug: string; titulo: string; resumo: string; conteudo: string; tags: string; palavras: string; referencia: string; fonte: string; nota: string; categoria: string; modulo: string; revisar_em: string; paginas: string[]; integracoes: string[]; somente_admin: boolean };

function formDe(d?: Detalhe): Form {
  const v = d?.rascunho ?? d?.publicada;
  return {
    slug: d?.slug ?? "", titulo: v?.titulo ?? "", resumo: v?.resumo ?? "", conteudo: v?.conteudo ?? "", tags: (v?.tags ?? []).join(", "), palavras: (v?.palavras_chave ?? []).join(", "),
    referencia: v?.referencia ?? "", fonte: v?.fonte ?? "", nota: "", categoria: d?.categoria.slug ?? "", modulo: d?.modulo ?? "", revisar_em: d?.revisar_em ? String(d.revisar_em).slice(0, 10) : "",
    paginas: d?.acesso.paginas ?? [], integracoes: d?.acesso.integracoes ?? [], somente_admin: d?.acesso.somente_admin ?? false,
  };
}

function Editor({ id, onCriado }: { id?: string; onCriado: (id: string) => void }) {
  const client = useQueryClient();
  const det = useQuery({ queryKey: ["kb", "artigo", id], enabled: Boolean(id), queryFn: () => api<Detalhe>(`${BASE}/artigos/${id}`) });
  const cats = useCategorias();
  const paginas = useQuery({ queryKey: ["acessos"], queryFn: () => api<{ paginas: Array<{ id: string; nome: string; grupo: string }> }>("/api/v1/configuracoes/acessos") });
  const integracoes = useQuery({ queryKey: ["mcp", "integracoes"], queryFn: () => api<Array<{ id: string; nome: string; slug: string }>>("/api/v1/configuracoes/mcp/integracoes") });
  const d = det.data?.data;
  const [f, setF] = useState<Form>(formDe());
  const [vista, setVista] = useState<"editar" | "previa">("editar");
  const [aviso, setAviso] = useState("");
  const [historico, setHistorico] = useState(false);
  const [duplicando, setDuplicando] = useState("");
  useEffect(() => { if (d) setF(formDe(d)); }, [d]);
  const atualizar = async (detalhe?: Detalhe) => { if (detalhe) client.setQueryData(["kb", "artigo", detalhe.id], { success: true, data: detalhe }); await client.invalidateQueries({ queryKey: ["kb", "artigos"] }); };
  const conteudo = () => ({ titulo: f.titulo, resumo: f.resumo || null, conteudo: f.conteudo, tags: csv(f.tags), palavras_chave: csv(f.palavras), referencia: f.referencia || null, fonte: f.fonte || null, nota: f.nota || null });
  const meta = () => ({ categoria: f.categoria, modulo: f.modulo || null, revisar_em: f.revisar_em || null, acesso_paginas: f.paginas, acesso_integracoes: f.integracoes, somente_admin: f.somente_admin });
  const salvar = useMutation({
    mutationFn: async () => {
      if (!id) return api<Detalhe>(`${BASE}/artigos`, { method: "POST", body: JSON.stringify({ id: f.slug, meta: meta(), conteudo: conteudo() }) });
      await api<Detalhe>(`${BASE}/artigos/${id}`, { method: "PATCH", body: JSON.stringify(meta()) });
      return api<Detalhe>(`${BASE}/artigos/${id}/rascunho`, { method: "PUT", body: JSON.stringify(conteudo()) });
    },
    onSuccess: async (r) => { await atualizar(r.data); setAviso("Rascunho salvo. O conteúdo publicado não mudou."); if (!id) onCriado(r.data.id); },
  });
  const acao = useMutation({
    mutationFn: (q: { url: string; body?: unknown }) => api<Detalhe>(`${BASE}/artigos/${id}${q.url}`, { method: "POST", body: JSON.stringify(q.body ?? {}) }),
    onSuccess: async (r, q) => {
      await atualizar(r.data);
      await client.invalidateQueries({ queryKey: ["kb", "versoes", id] });
      if (q.url === "/duplicar") { setDuplicando(""); onCriado(r.data.id); return; }
      setAviso(q.url === "/publicar" ? `Versão ${r.data.versao_publicada} publicada. Vale na próxima consulta pelo MCP.` : q.url === "/arquivar" ? "Artigo arquivado: saiu das buscas e consultas." : q.url === "/reativar" ? "Artigo reativado." : "Versão restaurada como novo rascunho (publique para valer).");
    },
  });
  if (id && det.isLoading) return <Skeleton className="h-96" />;
  if (id && !d) return <Alerta>Não foi possível carregar o artigo.</Alerta>;
  const erro = erroDe(salvar.error) || erroDe(acao.error);
  const pendente = salvar.isPending || acao.isPending;
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const togg = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);
  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-navy-900"><FileText size={18} /> {id ? (d?.rascunho?.titulo ?? d?.publicada?.titulo) : "Novo artigo"}</h2>
          {d ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <Badge value={COR[d.status]}>{STATUS[d.status]}</Badge>
              {d.versao_publicada ? <Badge value="ativa">Publicada: v{d.versao_publicada}</Badge> : null}
              {d.rascunho ? <Badge value="pausada">Rascunho: v{d.rascunho.versao}</Badge> : null}
              <span className="font-mono">{d.slug}</span> · atualizado {dia(d.atualizado_em)} · publicado {dia(d.publicado_em)}
            </p>
          ) : <p className="text-xs text-slate-500">Nasce como rascunho. Nada é publicado sem o botão Publicar.</p>}
        </div>
        {d ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setHistorico((v) => !v)}><History size={16} /> Histórico</Button>
            <Button type="button" variant="secondary" onClick={() => setDuplicando(duplicando ? "" : `${d.slug}-copia`.slice(0, 120))}><CopyPlus size={16} /> Duplicar</Button>
            {d.status === "arquivado"
              ? <Button type="button" variant="secondary" disabled={pendente} onClick={() => acao.mutate({ url: "/reativar" })}><ArchiveRestore size={16} /> Reativar</Button>
              : <Button type="button" variant="secondary" disabled={pendente} onClick={() => { if (window.confirm("Arquivar este artigo? Ele sai das buscas e consultas pelo MCP.")) acao.mutate({ url: "/arquivar" }); }}><Archive size={16} /> Arquivar</Button>}
            <Button type="button" disabled={pendente || !d.rascunho} title={d.rascunho ? "" : "Não há rascunho novo para publicar"} onClick={() => { if (window.confirm(`Publicar a versão ${d.rascunho?.versao}? Ela substitui o conteúdo vigente na próxima consulta.`)) acao.mutate({ url: "/publicar", body: { versao: d.rascunho?.versao } }); }}><Send size={16} /> Publicar</Button>
          </div>
        ) : null}
      </div>
      {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {duplicando && d ? (
        <form className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); acao.mutate({ url: "/duplicar", body: { id: duplicando } }); }}>
          <CampoFiltro rotulo="Identificador da cópia" className="min-w-56 flex-1"><Input className="font-mono" value={duplicando} onChange={(e) => setDuplicando(e.target.value.toLowerCase())} /></CampoFiltro>
          <Button type="submit" disabled={pendente}>Duplicar como rascunho</Button>
        </form>
      ) : null}
      {historico && d ? <Historico id={d.id} publicada={d.versao_publicada} onRestaurar={(v) => { if (window.confirm(`Restaurar a versão ${v} como novo rascunho?`)) acao.mutate({ url: `/versoes/${v}/restaurar` }); }} /> : null}

      <Secao titulo="Conteúdo" texto="Título, resumo e texto em Markdown. Salvar cria ou atualiza o rascunho; a versão publicada só muda ao publicar.">
        <div className="grid gap-3 sm:grid-cols-2">
          {!id ? <Field label="Identificador (fixo)"><Input required className="font-mono" placeholder="ex.: objecao-distancia" value={f.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} /></Field> : null}
          <Field label="Título"><Input required maxLength={200} value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} /></Field>
        </div>
        <Field label="Resumo"><Input maxLength={600} value={f.resumo} onChange={(e) => set({ resumo: e.target.value })} /></Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FiltroChips rotulo="Modo do editor" valor={vista} onChange={setVista} opcoes={[{ id: "editar", rotulo: "Editar" }, { id: "previa", rotulo: "Pré-visualizar" }]} />
          <span className="text-xs text-slate-500">{f.conteudo.length.toLocaleString("pt-BR")} / 100.000 caracteres · # título, - lista, **negrito**, [link](https://…)</span>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <div className={cn(vista === "previa" && "hidden xl:block")}><Textarea aria-label="Conteúdo em Markdown" className="min-h-[360px] font-mono text-[13px]" maxLength={100_000} value={f.conteudo} onChange={(e) => set({ conteudo: e.target.value })} /></div>
          <div className={cn("min-h-[200px] rounded-lg border border-slate-200 p-4", vista === "editar" && "hidden xl:block")} aria-label="Pré-visualização">
            {f.conteudo.trim() ? <Markdown texto={f.conteudo} /> : <p className="text-sm text-slate-400">A pré-visualização aparece aqui.</p>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tags (separadas por vírgula)"><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="objeção, transporte" /></Field>
          <Field label="Palavras-chave (separadas por vírgula)"><Input value={f.palavras} onChange={(e) => set({ palavras: e.target.value })} placeholder="distância, deslocamento" /></Field>
          <Field label="Referência institucional"><Input maxLength={300} value={f.referencia} onChange={(e) => set({ referencia: e.target.value })} placeholder="ex.: Manual de atendimento, seção 3" /></Field>
          <Field label="Fonte"><Input maxLength={300} value={f.fonte} onChange={(e) => set({ fonte: e.target.value })} placeholder="ex.: Coordenação de recrutamento" /></Field>
        </div>
        <Field label="Nota desta alteração (opcional)"><Input maxLength={300} value={f.nota} onChange={(e) => set({ nota: e.target.value })} /></Field>
      </Secao>

      <Secao titulo="Organização" texto="Categoria, módulo e revisão não fazem parte da versão: valem na hora.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Categoria"><Select required value={f.categoria} onChange={(e) => set({ categoria: e.target.value })}><option value="">Escolha…</option>{(cats.data?.data ?? []).filter((c) => c.ativa || c.slug === f.categoria).map((c) => <option key={c.id} value={c.slug}>{c.nome}</option>)}</Select></Field>
          <Field label="Módulo relacionado"><Select value={f.modulo} onChange={(e) => set({ modulo: e.target.value })}><option value="">Nenhum</option>{MODULOS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field label="Revisar em (opcional)"><Input type="date" value={f.revisar_em} onChange={(e) => set({ revisar_em: e.target.value })} /></Field>
        </div>
      </Secao>

      <Secao titulo="Permissões de acesso" texto="Somadas às permissões da ferramenta no MCP. Nada aqui libera acesso além do que a integração e o painel já permitem.">
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={f.somente_admin} onChange={() => set({ somente_admin: !f.somente_admin })} /> Somente administradores</label>
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-semibold text-slate-500">Exigir uma destas páginas do painel (nenhuma marcada = qualquer colaborador com a ferramenta)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{(paginas.data?.data.paginas ?? []).map((p) => <label key={p.id} className="flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={f.paginas.includes(p.id)} onChange={() => set({ paginas: togg(f.paginas, p.id) })} />{p.nome}</label>)}</div>
        </fieldset>
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-semibold text-slate-500">Só nestas integrações (nenhuma marcada = todas)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">{(integracoes.data?.data ?? []).map((i) => <label key={i.id} className="flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={f.integracoes.includes(i.id)} onChange={() => set({ integracoes: togg(f.integracoes, i.id) })} />{i.nome}</label>)}{!(integracoes.data?.data ?? []).length ? <span className="text-xs text-slate-400">Nenhuma integração criada.</span> : null}</div>
        </fieldset>
      </Secao>

      <div className="flex justify-end">
        <Button type="button" disabled={pendente || !f.titulo || !f.conteudo || !f.categoria || (!id && !f.slug)} onClick={() => { setAviso(""); salvar.mutate(); }}><Save size={16} /> {salvar.isPending ? "Salvando…" : "Salvar rascunho"}</Button>
      </div>
    </Card>
  );
}

function Historico({ id, publicada, onRestaurar }: { id: string; publicada: number | null; onRestaurar: (v: number) => void }) {
  const vs = useQuery({ queryKey: ["kb", "versoes", id], queryFn: () => api<VersaoLista[]>(`${BASE}/artigos/${id}/versoes`) });
  const [ver, setVer] = useState<number | null>(null);
  const v = useQuery({ queryKey: ["kb", "versao", id, ver], enabled: ver !== null, queryFn: () => api<Versao>(`${BASE}/artigos/${id}/versoes/${ver}`) });
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 p-3">
      <h3 className="text-sm font-bold text-navy-900">Histórico de versões</h3>
      <ul className="grid gap-1">
        {(vs.data?.data ?? []).map((x) => (
          <li key={x.versao} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
            <span className="flex flex-wrap items-center gap-1.5">
              <b className="tabular-nums">v{x.versao}</b>
              {x.versao === publicada ? <Badge value="ativa">Publicada</Badge> : x.rascunho ? <Badge value="pausada">Rascunho</Badge> : <Badge>Anterior</Badge>}
              <span className="text-xs text-slate-500">{x.titulo} · {dia(x.criado_em)}{x.autor ? ` · ${x.autor}` : ""}{x.nota ? ` · ${x.nota}` : ""}</span>
            </span>
            <span className="flex gap-1.5">
              <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setVer(ver === x.versao ? null : x.versao)}>{ver === x.versao ? "Fechar" : "Ver"}</Button>
              {x.versao !== publicada && !x.rascunho ? <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => onRestaurar(x.versao)}>Restaurar</Button> : null}
            </span>
          </li>
        ))}
      </ul>
      {ver !== null && v.data ? <div className="rounded-lg bg-slate-50 p-3"><p className="mb-2 text-xs font-semibold text-slate-500">Versão {ver}: {v.data.data.titulo}</p><Markdown texto={v.data.data.conteudo} /></div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ categorias

function Categorias() {
  const client = useQueryClient();
  const cats = useCategorias();
  const [nova, setNova] = useState({ slug: "", nome: "", descricao: "" });
  const criar = useMutation({ mutationFn: () => api(`${BASE}/categorias`, { method: "POST", body: JSON.stringify({ slug: nova.slug, nome: nova.nome, descricao: nova.descricao || null }) }), onSuccess: async () => { setNova({ slug: "", nome: "", descricao: "" }); await client.invalidateQueries({ queryKey: ["kb", "categorias"] }); } });
  const editar = useMutation({ mutationFn: (q: { id: string; body: unknown }) => api(`${BASE}/categorias/${q.id}`, { method: "PATCH", body: JSON.stringify(q.body) }), onSuccess: () => client.invalidateQueries({ queryKey: ["kb", "categorias"] }) });
  return (
    <Card className="grid gap-4">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><Tags size={18} /> Categorias</h2><p className="text-sm text-slate-500">Organize a base sem mexer no código. Desativar uma categoria tira os artigos dela do MCP.</p></div>
      {erroDe(criar.error) || erroDe(editar.error) ? <Alerta>{erroDe(criar.error) || erroDe(editar.error)}</Alerta> : null}
      <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
        <Field label="Nome"><Input required value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value, slug: nova.slug || "" })} /></Field>
        <Field label="Identificador"><Input required className="font-mono" value={nova.slug} onChange={(e) => setNova({ ...nova, slug: e.target.value.toLowerCase() })} placeholder="ex.: onboarding" /></Field>
        <Button type="submit" disabled={criar.isPending}><Plus size={16} /> Criar</Button>
      </form>
      {cats.isLoading ? <Skeleton className="h-40" /> : null}
      <ul className="grid gap-1.5">
        {(cats.data?.data ?? []).map((c) => (
          <li key={c.id} className="grid gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="grid"><span className="text-sm font-semibold text-navy-900">{c.nome} {c.ativa ? null : <Badge value="encerrada">Desativada</Badge>}</span><span className="text-xs text-slate-500"><span className="font-mono">{c.slug}</span> · {c.publicados} publicados de {c.artigos}</span></span>
            <span className="flex flex-wrap gap-1.5">
              <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => { const nome = window.prompt("Novo nome da categoria", c.nome); if (nome && nome.trim().length >= 2) editar.mutate({ id: c.id, body: { nome: nome.trim() } }); }}>Renomear</Button>
              <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={() => editar.mutate({ id: c.id, body: { ativa: !c.ativa } })}>{c.ativa ? "Desativar" : "Ativar"}</Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------ testar a busca

function TestarBusca() {
  const [texto, setTexto] = useState("");
  const [enviado, setEnviado] = useState("");
  const r = useQuery({ queryKey: ["kb", "busca", enviado], enabled: enviado.length >= 2, queryFn: () => api<{ itens: Array<{ id: string; titulo: string; resumo: string | null; categoria: { nome: string }; versao: number; relevancia: number; trechos: string[] }>; total: number }>(`${BASE}/busca?texto=${encodeURIComponent(enviado)}`) });
  return (
    <Card className="grid gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><BookOpen size={18} /> Testar a busca</h2><p className="text-sm text-slate-500">Mostra o que a ferramenta buscar_conhecimento encontra (só conteúdo publicado), na ordem de relevância.</p></div>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setEnviado(texto.trim()); }}>
        <Input className="min-w-60 flex-1" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ex.: candidato não quer a vaga por causa da distância" />
        <Button type="submit"><Search size={16} /> Buscar</Button>
      </form>
      {r.isLoading && enviado ? <Skeleton className="h-24" /> : null}
      {r.data ? (
        <ol className="grid gap-2">
          {r.data.data.itens.map((i, n) => (
            <li key={i.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold text-navy-900">{n + 1}. {i.titulo} <span className="text-xs font-normal text-slate-500">· {i.categoria.nome} · v{i.versao} · relevância {i.relevancia}</span></p>
              {i.trechos.map((t) => <p key={t} className="mt-1 text-xs text-slate-600">{t}</p>)}
            </li>
          ))}
          {!r.data.data.itens.length ? <li className="text-sm text-slate-500">Nenhum artigo publicado encontrado.</li> : null}
        </ol>
      ) : null}
    </Card>
  );
}

function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-slate-100 pt-4">
      <div><h3 className="text-sm font-bold text-navy-900">{titulo}</h3>{texto ? <p className="text-xs text-slate-500">{texto}</p> : null}</div>
      {children}
    </section>
  );
}
