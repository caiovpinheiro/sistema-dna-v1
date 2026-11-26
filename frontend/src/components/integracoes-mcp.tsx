import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Copy, CopyPlus, Plug, Plus, ShieldCheck, UserMinus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alerta, CampoFiltro, FiltroChips } from "@/components/pagina";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

/** Aba "Integrações MCP" de Configurações (só administrador). Tudo vem de /api/v1/configuracoes/mcp/*. */
const BASE = "/api/v1/configuracoes/mcp";

type FerramentaCat = {
  nome: string; titulo: string; descricao: string; finalidade: string; paginas: string[]; somenteAdmin: boolean; permissaoExigida: string | null;
  permissoesIndividuais: string[]; servicoExterno: boolean; limitePorHora: number | null; dados: "lista" | "registro" | "agregado" | null;
};
type Modulo = { id: string; rotulo: string; finalidade: string; planejado?: boolean; ferramentas: FerramentaCat[] };
type Catalogo = {
  modulos: Modulo[]; total: number;
  permissoesIndividuais: Array<{ id: string; rotulo: string; descricao: string }>;
  abrangencias: Array<{ id: string; rotulo: string; disponivel: boolean; descricao: string }>;
};
type ResumoInteg = { id: string; slug: string; nome: string; descricao: string | null; finalidade: string | null; ativa: boolean; url: string | null; ferramentas: number; colaboradores: number; ultimoUso: string | null; conexoesAtivas: number };
type Vinculo = {
  id: string; nome: string; email: string; ativo: boolean; ferramentas: string[] | null; permissoes: string[]; abrangencia: string; registros: number;
  conexoesAtivas: number; ultimoAcesso: string | null; chamadas: number; negados: number;
};
type Detalhe = Omit<ResumoInteg, "ferramentas" | "colaboradores" | "ultimoUso"> & { instrucoes: string | null; ferramentas: string[]; colaboradores: Vinculo[] };
type Bloqueio = { codigo: string; origem: string; texto: string };
type UsuarioMcp = { id: string; nome: string; email: string; ativo: boolean; admin: boolean; integracoes: number; ultimoAcesso: string | null };
type VisaoUsuario = {
  usuario: { id: string; nome: string; email: string; ativo: boolean; admin: boolean };
  integracoes: Array<{
    id: string; slug: string; nome: string; ativa: boolean; abrangencia?: string; permissoes?: string[]; contato?: boolean; restritas?: string[] | null; erro?: string;
    conexoesAtivas?: number; ultimoAcesso?: string | null; chamadas?: number; negados?: number;
    registros?: { candidatos: Array<{ id: string; nome: string | null }>; empresas: Array<{ id: string; nome: string | null }> };
    ferramentas: Array<{ nome: string; titulo: string; modulo: string; disponivel: boolean; bloqueio: Bloqueio | null }>;
  }>;
};
type Auditoria = {
  indicadores: {
    chamadas: number; sucesso: number; erros: number; negados: number; limites: number; tempoMedioMs: number | null;
    ferramentasMaisUsadas: Array<{ ferramenta: string; chamadas: number }>; colaboradoresMaisAtivos: Array<{ nome: string; chamadas: number }>;
    servicosExternos: { chamadasPorFerramenta: Array<{ ferramenta: string; chamadas: number }>; observacao: string };
  };
  eventos: Array<{ id: string; quando: string; operacao: string; ferramenta: string | null; resultado: string; motivo: string | null; duracaoMs: number | null; integracao: string | null; colaborador: string | null }>;
  paginacao: { pagina: number; limite: number; total: number };
  retencaoDias: number;
};
type Infra = {
  mcp: { habilitado: boolean; urlPublica: string | null; painel: string | null };
  monolito: { comunicacao: string; ultimaChamadaDoGateway: string | null };
  contrato: { versaoDoMonolito: number; aceitas: number[] };
  oauth: { ativo: boolean; emissor?: string; escopos?: string[]; escopoPadrao?: string[]; registroDinamicoDeClientes?: boolean; clientesPreCadastrados?: number; clientesPorDocumento?: number };
  mtls: { modo: string; certificado: { validoAte: string; diasRestantes: number; emDia: boolean } | null; erro: string | null; clientesPermitidos: number };
  integracoes: { ativas: number; total: number };
  prontidao: { pronto: boolean; itens: Array<{ item: string; ok: boolean }> };
  retencao: { auditoriaDias: number; oauthDias: number };
  chatgpt: { passos: string[]; observacao: string };
  segredos: string;
};

const erroDe = (e: unknown) => (e instanceof ApiError ? e.message : "");
const quando = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const SECOES = [{ id: "integracoes", rotulo: "Integrações" }, { id: "colaboradores", rotulo: "Colaboradores" }, { id: "auditoria", rotulo: "Auditoria" }, { id: "infra", rotulo: "Infraestrutura" }] as const;
type SecaoId = (typeof SECOES)[number]["id"];

export function IntegracoesMcp() {
  const [secao, setSecao] = useState<SecaoId>("integracoes");
  return (
    <div className="grid gap-4">
      <FiltroChips rotulo="Área do MCP" opcoes={SECOES.map((s) => ({ id: s.id, rotulo: s.rotulo }))} valor={secao} onChange={setSecao} />
      {secao === "integracoes" ? <Integracoes /> : secao === "colaboradores" ? <Colaboradores /> : secao === "auditoria" ? <AuditoriaMcp /> : <InfraMcp />}
    </div>
  );
}

// ------------------------------------------------------------------ pequenos blocos

function Secao({ titulo, texto, children, acoes }: { titulo: string; texto?: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-navy-900">{titulo}</h3>
          {texto ? <p className="text-xs text-slate-500">{texto}</p> : null}
        </div>
        {acoes}
      </div>
      {children}
    </section>
  );
}

function Indicador({ titulo, valor, dica }: { titulo: string; valor: ReactNode; dica?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold text-slate-500">{titulo}</dt>
      <dd className="mt-0.5 text-xl font-extrabold tabular-nums text-navy-900">{valor}</dd>
      {dica ? <p className="text-[11px] text-slate-400">{dica}</p> : null}
    </div>
  );
}

function CaixaMeia({ todas, algumas, onChange, rotulo }: { todas: boolean; algumas: boolean; onChange: (marcar: boolean) => void; rotulo: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = algumas; }, [algumas]);
  return <input ref={ref} type="checkbox" aria-label={rotulo} className="h-4 w-4 accent-cyan-700" checked={todas} onChange={() => onChange(!todas)} />;
}

function Selos({ f }: { f: FerramentaCat }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {f.servicoExterno ? <Badge value="enviado">Serviço externo{f.limitePorHora ? ` · ${f.limitePorHora}/h` : ""}</Badge> : null}
      {f.somenteAdmin ? <Badge value="estagio">Só administrador</Badge> : null}
      {f.permissaoExigida ? <Badge value="pausada">Exige {f.permissaoExigida}</Badge> : null}
      {f.paginas.length ? <Badge>Página: {f.paginas.join(" ou ")}</Badge> : null}
      {f.dados === "lista" ? <Badge>Busca/lista: abrangência “todos”</Badge> : f.dados === "agregado" ? <Badge>Indicador: abrangência “todos”</Badge> : f.dados === "registro" ? <Badge>Por id: respeita a abrangência</Badge> : null}
    </span>
  );
}

// ------------------------------------------------------------------ integrações

function Integracoes() {
  const client = useQueryClient();
  const lista = useQuery({ queryKey: ["mcp", "integracoes"], queryFn: () => api<ResumoInteg[]>(`${BASE}/integracoes`) });
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const itens = lista.data?.data ?? [];
  const atualizar = () => client.invalidateQueries({ queryKey: ["mcp"] });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden p-0 lg:sticky lg:top-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <p className="text-xs font-semibold text-slate-500">Integrações MCP</p>
          <Button type="button" variant="secondary" className="h-8 px-2.5" onClick={() => { setNovo(true); setEscolhida(null); }}><Plus size={14} /> Nova</Button>
        </div>
        {lista.isLoading ? <div className="grid gap-2 p-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : null}
        {lista.isError ? <div className="p-3"><Alerta>Não foi possível carregar as integrações.</Alerta></div> : null}
        <ul className="max-h-[70vh] overflow-auto">
          {itens.map((i) => {
            const ativo = escolhida === i.id && !novo;
            return (
              <li key={i.id} className="border-b border-slate-100 last:border-b-0">
                <button type="button" aria-pressed={ativo} onClick={() => { setNovo(false); setEscolhida(i.id); }} className={cn("grid w-full gap-1 px-4 py-3 text-left transition", ativo ? "bg-cyan-50" : "hover:bg-slate-50")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("text-sm font-semibold", ativo ? "text-cyan-800" : "text-navy-900")}>{i.nome}</span>
                    {i.ativa ? <Badge value="ativa">Ativa</Badge> : <Badge value="encerrada">Desativada</Badge>}
                  </span>
                  <span className="truncate font-mono text-xs text-slate-500">{i.slug}</span>
                  <span className="text-xs text-slate-500">{i.ferramentas} ferramentas · {i.colaboradores} colaboradores · {i.conexoesAtivas} conexões</span>
                  <span className="text-[11px] text-slate-400">Último uso: {quando(i.ultimoUso)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!lista.isLoading && !itens.length ? <p className="px-4 py-6 text-sm text-slate-500">Nenhuma integração ainda.</p> : null}
      </Card>
      {novo ? <NovaIntegracao onCancel={() => setNovo(false)} onCriada={async (id) => { await atualizar(); setNovo(false); setEscolhida(id); }} />
        : escolhida ? <DetalheIntegracao key={escolhida} id={escolhida} onMudou={atualizar} onAbrir={(id) => setEscolhida(id)} />
          : <Empty title="Nenhuma integração escolhida" text="Escolha uma integração para configurar ferramentas e colaboradores, ou crie uma nova. Toda integração nasce desativada e sem permissões." />}
    </div>
  );
}

function NovaIntegracao({ onCancel, onCriada }: { onCancel: () => void; onCriada: (id: string) => void }) {
  const [f, setF] = useState({ slug: "", nome: "", descricao: "", finalidade: "" });
  const criar = useMutation({
    mutationFn: () => api<Detalhe>(`${BASE}/integracoes`, { method: "POST", body: JSON.stringify({ slug: f.slug.trim(), nome: f.nome.trim(), descricao: f.descricao.trim() || undefined, finalidade: f.finalidade.trim() || undefined }) }),
    onSuccess: (r) => onCriada(r.data.id),
  });
  return (
    <Card className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold text-navy-900">Nova integração</h2>
        <p className="text-sm text-slate-500">Ela nasce desativada, sem ferramentas e sem colaboradores. Você libera cada coisa depois.</p>
      </div>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input required minLength={2} maxLength={120} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Atendimento ao candidato" /></Field>
          <Field label="Identificador (slug)"><Input required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="atendimento" pattern="[a-z0-9][a-z0-9\-]{0,58}[a-z0-9]" title="Letras minúsculas, números e hífens (2 a 60)" className="font-mono" /></Field>
        </div>
        <Field label="Finalidade"><Input maxLength={500} value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value })} placeholder="Para que esta conexão será usada (aparece na tela de autorização)" /></Field>
        <Field label="Descrição"><Textarea className="min-h-20" maxLength={500} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">O identificador define o endereço de conexão e não pode ser trocado depois.</p>
        {erroDe(criar.error) ? <Alerta>{erroDe(criar.error)}</Alerta> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={criar.isPending}>{criar.isPending ? "Criando…" : "Criar integração"}</Button>
        </div>
      </form>
    </Card>
  );
}

function DetalheIntegracao({ id, onMudou, onAbrir }: { id: string; onMudou: () => void; onAbrir: (id: string) => void }) {
  const client = useQueryClient();
  const det = useQuery({ queryKey: ["mcp", "integracao", id], queryFn: () => api<Detalhe>(`${BASE}/integracoes/${id}`) });
  const cat = useQuery({ queryKey: ["mcp", "catalogo"], queryFn: () => api<Catalogo>(`${BASE}/ferramentas`) });
  const [aviso, setAviso] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const d = det.data?.data;
  const salvaEm = (r: { data: Detalhe }, texto: string) => { client.setQueryData(["mcp", "integracao", id], r); setAviso(texto); onMudou(); };
  const ativar = useMutation({ mutationFn: (ativa: boolean) => api<Detalhe>(`${BASE}/integracoes/${id}/ativa`, { method: "POST", body: JSON.stringify({ ativa }) }), onSuccess: (r) => salvaEm(r, r.data.ativa ? "Integração ativada." : "Integração desativada: as conexões foram encerradas.") });
  const revogar = useMutation({ mutationFn: () => api<{ revogados: number }>(`${BASE}/integracoes/${id}/revogar`, { method: "POST", body: JSON.stringify({}) }), onSuccess: async (r) => { setAviso(`${r.data.revogados} conexão(ões) revogada(s).`); await client.invalidateQueries({ queryKey: ["mcp", "integracao", id] }); onMudou(); } });
  async function copiar() {
    if (!d?.url) return;
    try { await navigator.clipboard.writeText(d.url); setCopiado(true); window.setTimeout(() => setCopiado(false), 2000); } catch { setAviso("Não foi possível copiar. Selecione o endereço e copie manualmente."); }
  }
  if (det.isLoading || cat.isLoading) return <Skeleton className="h-96" />;
  if (!d || !cat.data) return <Alerta>Não foi possível carregar a integração.</Alerta>;
  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-navy-900">{d.nome} {d.ativa ? <Badge value="ativa">Ativa</Badge> : <Badge value="encerrada">Desativada</Badge>}</h2>
          <p className="font-mono text-xs text-slate-500">{d.slug}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setDuplicando((v) => !v)}><CopyPlus size={16} /> Duplicar</Button>
          <Button type="button" variant="secondary" disabled={revogar.isPending || !d.conexoesAtivas} onClick={() => { if (window.confirm("Revogar TODAS as conexões desta integração? Todos terão de autorizar de novo.")) revogar.mutate(); }}><Ban size={16} /> Revogar conexões ({d.conexoesAtivas})</Button>
          <Button type="button" variant={d.ativa ? "danger" : "primary"} disabled={ativar.isPending} onClick={() => ativar.mutate(!d.ativa)}>{d.ativa ? "Desativar" : "Ativar"}</Button>
        </div>
      </div>
      {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
      {erroDe(ativar.error) || erroDe(revogar.error) ? <Alerta>{erroDe(ativar.error) || erroDe(revogar.error)}</Alerta> : null}
      {duplicando ? <Duplicar origem={d} onCancel={() => setDuplicando(false)} onFeita={(novoId) => { setDuplicando(false); onMudou(); onAbrir(novoId); }} /> : null}
      <Secao titulo="Endereço de conexão" texto="Cole este endereço no ChatGPT ao criar o aplicativo MCP. A integração precisa estar ativa.">
        {d.url ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-xs text-navy-900" title={d.url}>{d.url}</code>
            <Button type="button" variant="secondary" onClick={copiar}>{copiado ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar URL</>}</Button>
          </div>
        ) : <Alerta tom="aviso">O endereço público do MCP ainda não está configurado no ambiente (MCP_PUBLIC_URL).</Alerta>}
      </Secao>
      <DadosIntegracao d={d} onSalvo={(r) => salvaEm(r, "Dados salvos.")} />
      <FerramentasIntegracao d={d} cat={cat.data.data} onSalvo={(r) => salvaEm(r, "Ferramentas salvas. Vale a partir da próxima chamada, sem reiniciar nada.")} />
      <ColaboradoresIntegracao d={d} cat={cat.data.data} onMudou={(r, t) => salvaEm(r, t)} />
    </Card>
  );
}

function Duplicar({ origem, onCancel, onFeita }: { origem: Detalhe; onCancel: () => void; onFeita: (id: string) => void }) {
  const [f, setF] = useState({ nome: `${origem.nome} (cópia)`, slug: `${origem.slug}-copia`.slice(0, 60) });
  const m = useMutation({ mutationFn: () => api<Detalhe>(`${BASE}/integracoes/${origem.id}/duplicar`, { method: "POST", body: JSON.stringify(f) }), onSuccess: (r) => onFeita(r.data.id) });
  return (
    <form className="grid gap-3 rounded-lg bg-slate-50 p-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-slate-600">Copia nome, descrição, finalidade e ferramentas. <b>Não</b> copia colaboradores, permissões individuais, registros autorizados nem conexões. A cópia nasce desativada.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><Input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
        <Field label="Identificador (slug)"><Input required className="font-mono" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
      </div>
      {erroDe(m.error) ? <Alerta>{erroDe(m.error)}</Alerta> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button><Button type="submit" disabled={m.isPending}>Duplicar</Button></div>
    </form>
  );
}

function DadosIntegracao({ d, onSalvo }: { d: Detalhe; onSalvo: (r: { data: Detalhe }) => void }) {
  const [f, setF] = useState({ nome: d.nome, descricao: d.descricao ?? "", finalidade: d.finalidade ?? "", instrucoes: d.instrucoes ?? "" });
  const m = useMutation({ mutationFn: () => api<Detalhe>(`${BASE}/integracoes/${d.id}`, { method: "PATCH", body: JSON.stringify({ nome: f.nome.trim(), descricao: f.descricao, finalidade: f.finalidade, instrucoes: f.instrucoes }) }), onSuccess: onSalvo });
  return (
    <Secao titulo="Dados da integração" texto="Nome, descrição e finalidade aparecem para o colaborador na tela de autorização.">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input required minLength={2} maxLength={120} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></Field>
          <Field label="Identificador (slug)"><Input readOnly value={d.slug} className="bg-slate-50 font-mono text-slate-500" title="O identificador define o endereço e não muda" /></Field>
        </div>
        <Field label="Finalidade"><Input maxLength={500} value={f.finalidade} onChange={(e) => setF({ ...f, finalidade: e.target.value })} /></Field>
        <Field label="Descrição"><Textarea className="min-h-16" maxLength={500} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></Field>
        <Field label="Instruções para o assistente (opcional)"><Textarea className="min-h-20" maxLength={4000} value={f.instrucoes} onChange={(e) => setF({ ...f, instrucoes: e.target.value })} /></Field>
        {erroDe(m.error) ? <Alerta>{erroDe(m.error)}</Alerta> : null}
        <div className="flex justify-end"><Button type="submit" disabled={m.isPending}>{m.isPending ? "Salvando…" : "Salvar dados"}</Button></div>
      </form>
    </Secao>
  );
}

function FerramentasIntegracao({ d, cat, onSalvo }: { d: Detalhe; cat: Catalogo; onSalvo: (r: { data: Detalhe }) => void }) {
  const [marcadas, setMarcadas] = useState<string[]>(d.ferramentas);
  const m = useMutation({ mutationFn: () => api<Detalhe>(`${BASE}/integracoes/${d.id}/ferramentas`, { method: "PUT", body: JSON.stringify({ ferramentas: marcadas }) }), onSuccess: onSalvo });
  const igual = marcadas.length === d.ferramentas.length && marcadas.every((x) => d.ferramentas.includes(x));
  const trocar = (nome: string) => setMarcadas((a) => (a.includes(nome) ? a.filter((x) => x !== nome) : [...a, nome]));
  return (
    <Secao titulo="Ferramentas liberadas" texto={`${marcadas.length} de ${cat.total} ferramentas. Cada colaborador ainda depende da página do painel, da abrangência e das permissões individuais.`}
      acoes={<Button type="button" disabled={m.isPending || igual} onClick={() => m.mutate()}>{m.isPending ? "Salvando…" : "Salvar ferramentas"}</Button>}>
      {erroDe(m.error) ? <Alerta>{erroDe(m.error)}</Alerta> : null}
      <div className="grid gap-3">
        {cat.modulos.map((mod) => {
          const nomes = mod.ferramentas.map((f) => f.nome);
          const qtd = nomes.filter((n) => marcadas.includes(n)).length;
          return (
            <fieldset key={mod.id} className="grid gap-2 rounded-lg border border-slate-200 p-3">
              <legend className="px-1">
                <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                  {nomes.length ? <CaixaMeia rotulo={`Todo o módulo ${mod.rotulo}`} todas={qtd === nomes.length} algumas={qtd > 0 && qtd < nomes.length} onChange={(marcar) => setMarcadas((a) => marcar ? [...new Set([...a, ...nomes])] : a.filter((x) => !nomes.includes(x)))} /> : null}
                  {mod.rotulo} <span className="text-xs font-normal tabular-nums text-slate-500">{qtd} de {nomes.length}</span>
                  {mod.planejado ? <Badge value="pausada">Em breve</Badge> : null}
                </label>
              </legend>
              <p className="text-xs text-slate-500">{mod.finalidade}</p>
              {mod.ferramentas.map((f) => (
                <label key={f.nome} className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md p-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-cyan-700" checked={marcadas.includes(f.nome)} onChange={() => trocar(f.nome)} />
                  <span className="grid gap-1">
                    <span className="font-semibold text-navy-900">{f.titulo} <span className="font-mono text-[11px] font-normal text-slate-400">{f.nome}</span></span>
                    <span className="text-xs leading-5 text-slate-600">{f.descricao}</span>
                    <span className="text-xs text-slate-500"><b>Finalidade:</b> {f.finalidade}</span>
                    <Selos f={f} />
                  </span>
                </label>
              ))}
              {!mod.ferramentas.length ? <p className="text-xs text-slate-400">Nenhuma ferramenta ainda.</p> : null}
            </fieldset>
          );
        })}
      </div>
    </Secao>
  );
}

// ------------------------------------------------------------------ colaboradores da integração

function ColaboradoresIntegracao({ d, cat, onMudou }: { d: Detalhe; cat: Catalogo; onMudou: (r: { data: Detalhe }, texto: string) => void }) {
  const usuarios = useQuery({ queryKey: ["mcp", "usuarios"], queryFn: () => api<UsuarioMcp[]>(`${BASE}/colaboradores`) });
  const [adicionar, setAdicionar] = useState("");
  const livres = (usuarios.data?.data ?? []).filter((u) => u.ativo && !d.colaboradores.some((c) => c.id === u.id));
  const add = useMutation({
    mutationFn: (uid: string) => api<Detalhe>(`${BASE}/integracoes/${d.id}/colaboradores/${uid}`, { method: "PUT", body: JSON.stringify({ abrangencia: "nenhuma" }) }),
    onSuccess: (r) => { setAdicionar(""); onMudou(r, "Colaborador vinculado sem abrangência e sem permissões. Configure abaixo."); },
  });
  return (
    <Secao titulo="Colaboradores" texto="Só usuários reais do painel. Cada um nasce sem abrangência: ferramentas com dados de pessoas ficam bloqueadas até você conceder.">
      <div className="flex flex-wrap items-end gap-2">
        <CampoFiltro rotulo="Vincular colaborador" className="min-w-56 flex-1">
          <Select value={adicionar} onChange={(e) => setAdicionar(e.target.value)} aria-label="Vincular colaborador">
            <option value="">Escolha…</option>
            {livres.map((u) => <option key={u.id} value={u.id}>{u.nome} — {u.email}</option>)}
          </Select>
        </CampoFiltro>
        <Button type="button" disabled={!adicionar || add.isPending} onClick={() => add.mutate(adicionar)}><Plus size={16} /> Vincular</Button>
      </div>
      {erroDe(add.error) ? <Alerta>{erroDe(add.error)}</Alerta> : null}
      {!d.colaboradores.length ? <p className="text-sm text-slate-500">Nenhum colaborador vinculado. Sem colaboradores, ninguém consegue usar esta integração.</p> : null}
      <div className="grid gap-3">
        {d.colaboradores.map((c) => <LinhaColaborador key={`${c.id}-${c.abrangencia}-${c.permissoes.join(",")}-${(c.ferramentas ?? ["*"]).join(",")}-${c.registros}`} d={d} c={c} cat={cat} onMudou={onMudou} />)}
      </div>
    </Secao>
  );
}

function LinhaColaborador({ d, c, cat, onMudou }: { d: Detalhe; c: Vinculo; cat: Catalogo; onMudou: (r: { data: Detalhe }, texto: string) => void }) {
  const client = useQueryClient();
  const [abr, setAbr] = useState(c.abrangencia);
  const [perm, setPerm] = useState<string[]>(c.permissoes);
  const [restringir, setRestringir] = useState(c.ferramentas !== null);
  const [ferr, setFerr] = useState<string[]>(c.ferramentas ?? d.ferramentas);
  const [cands, setCands] = useState<Array<{ id: string; nome: string | null }>>([]);
  const [emps, setEmps] = useState<Array<{ id: string; nome: string | null }>>([]);
  const [aberto, setAberto] = useState(false);
  const regs = useQuery({ queryKey: ["mcp", "registros", d.id, c.id], enabled: aberto && c.abrangencia === "autorizados", queryFn: () => api<{ candidatos: Array<{ id: string; nome: string | null }>; empresas: Array<{ id: string; nome: string | null }> }>(`${BASE}/integracoes/${d.id}/colaboradores/${c.id}/registros`) });
  useEffect(() => { if (regs.data) { setCands(regs.data.data.candidatos); setEmps(regs.data.data.empresas); } }, [regs.data]);
  const salvar = useMutation({
    mutationFn: () => api<Detalhe>(`${BASE}/integracoes/${d.id}/colaboradores/${c.id}`, { method: "PUT", body: JSON.stringify({
      abrangencia: abr, permissoes: perm, ferramentas: restringir ? ferr.filter((n) => d.ferramentas.includes(n)) : null,
      ...(abr === "autorizados" ? { candidatos: cands.map((x) => x.id), empresas: emps.map((x) => x.id) } : {}),
    }) }),
    onSuccess: async (r) => { await client.invalidateQueries({ queryKey: ["mcp"] }); onMudou(r, `Acesso de ${c.nome} salvo. Vale a partir da próxima chamada.`); },
  });
  const remover = useMutation({ mutationFn: () => api<Detalhe>(`${BASE}/integracoes/${d.id}/colaboradores/${c.id}`, { method: "DELETE" }), onSuccess: async (r) => { await client.invalidateQueries({ queryKey: ["mcp"] }); onMudou(r, `${c.nome} foi desvinculado e as conexões dele(a) foram revogadas.`); } });
  const revogar = useMutation({ mutationFn: () => api<{ revogados: number }>(`${BASE}/integracoes/${d.id}/revogar`, { method: "POST", body: JSON.stringify({ usuario: c.id }) }), onSuccess: async (r) => { await client.invalidateQueries({ queryKey: ["mcp"] }); onMudou({ data: d }, `${r.data.revogados} conexão(ões) de ${c.nome} revogada(s).`); } });
  const info = cat.abrangencias.find((a) => a.id === abr);
  return (
    <div className="rounded-lg border border-slate-200">
      <button type="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)} className="grid w-full gap-1 px-3 py-2.5 text-left hover:bg-slate-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <span className="grid min-w-0"><span className="text-sm font-semibold text-navy-900">{c.nome}</span><span className="truncate text-xs text-slate-500">{c.email}</span></span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge value={c.abrangencia === "nenhuma" ? "encerrada" : c.abrangencia === "todos" ? "aberta" : "pausada"}>{cat.abrangencias.find((a) => a.id === c.abrangencia)?.rotulo ?? c.abrangencia}</Badge>
          {c.permissoes.includes("candidatos:contato") ? <Badge value="enviado">Contato liberado</Badge> : null}
          <span>{c.conexoesAtivas} {c.conexoesAtivas === 1 ? "conexão" : "conexões"} · {c.chamadas} chamadas · {c.negados} negados · {quando(c.ultimoAcesso)}</span>
        </span>
      </button>
      {aberto ? (
        <div className="grid gap-4 border-t border-slate-100 p-3">
          <Field label="Abrangência dos registros">
            <Select value={abr} onChange={(e) => setAbr(e.target.value)}>
              {cat.abrangencias.map((a) => <option key={a.id} value={a.id} disabled={!a.disponivel}>{a.rotulo}{a.disponivel ? "" : " (indisponível)"}</option>)}
            </Select>
          </Field>
          {info ? <p className="text-xs text-slate-500">{info.descricao}</p> : null}
          <ul className="grid gap-1 text-xs text-slate-500">
            {cat.abrangencias.filter((a) => !a.disponivel).map((a) => <li key={a.id}><b>{a.rotulo}:</b> {a.descricao}</li>)}
          </ul>
          {abr === "autorizados" ? <Registros cands={cands} emps={emps} setCands={setCands} setEmps={setEmps} /> : null}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-navy-900">Permissões individuais</legend>
            {cat.permissoesIndividuais.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-cyan-700" checked={perm.includes(p.id)} onChange={() => setPerm((a) => (a.includes(p.id) ? a.filter((x) => x !== p.id) : [...a, p.id]))} />
                <span><b>{p.rotulo}</b> <span className="font-mono text-[11px] text-slate-400">{p.id}</span><br /><span className="text-xs text-slate-500">{p.descricao}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={restringir} onChange={() => setRestringir((v) => !v)} /> Limitar a algumas ferramentas da integração
            </label>
            {restringir ? (
              <div className="grid gap-1 rounded-lg bg-slate-50 p-2 sm:grid-cols-2">
                {d.ferramentas.map((n) => <label key={n} className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={ferr.includes(n)} onChange={() => setFerr((a) => (a.includes(n) ? a.filter((x) => x !== n) : [...a, n]))} /><span className="font-mono">{n}</span></label>)}
                {!d.ferramentas.length ? <p className="text-xs text-slate-500">A integração ainda não tem ferramentas liberadas.</p> : null}
              </div>
            ) : <p className="text-xs text-slate-500">Sem limite individual: vale tudo que a integração libera e o painel permite.</p>}
          </div>
          {erroDe(salvar.error) || erroDe(remover.error) || erroDe(revogar.error) ? <Alerta>{erroDe(salvar.error) || erroDe(remover.error) || erroDe(revogar.error)}</Alerta> : null}
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={revogar.isPending || !c.conexoesAtivas} onClick={() => revogar.mutate()}><Ban size={16} /> Revogar conexões</Button>
              <Button type="button" variant="secondary" disabled={remover.isPending} onClick={() => { if (window.confirm(`Desvincular ${c.nome} desta integração?`)) remover.mutate(); }}><UserMinus size={16} /> Desvincular</Button>
            </div>
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar acesso"}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Reg = { id: string; nome: string | null };
function Registros({ cands, emps, setCands, setEmps }: { cands: Reg[]; emps: Reg[]; setCands: (r: Reg[]) => void; setEmps: (r: Reg[]) => void }) {
  return (
    <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-600">Só estes registros poderão ser consultados <b>por id</b>. Um candidato autorizado libera a ficha dele(a); uma empresa autorizada libera os processos e contratações dela, não a ficha dos candidatos. Busca, listagem e indicadores continuam bloqueados.</p>
      <SeletorRegistro tipo="candidato" rotulo="Candidatos" itens={cands} onChange={setCands} />
      <SeletorRegistro tipo="empresa" rotulo="Empresas" itens={emps} onChange={setEmps} />
    </div>
  );
}

function SeletorRegistro({ tipo, rotulo, itens, onChange }: { tipo: "candidato" | "empresa"; rotulo: string; itens: Reg[]; onChange: (r: Reg[]) => void }) {
  const [q, setQ] = useState("");
  const [termo, setTermo] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setTermo(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);
  const busca = useQuery({ queryKey: ["mcp", "busca", tipo, termo], enabled: termo.length >= 2, queryFn: () => api<Array<{ id: string; nome: string | null; detalhe: string | null }>>(`${BASE}/registros/busca?tipo=${tipo}&q=${encodeURIComponent(termo)}`) });
  return (
    <div className="grid gap-2">
      <CampoFiltro rotulo={`${rotulo} autorizados (${itens.length})`}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar ${rotulo.toLowerCase()} pelo nome para autorizar`} aria-label={`Buscar ${rotulo.toLowerCase()}`} />
      </CampoFiltro>
      {termo.length >= 2 && busca.data ? (
        <ul className="grid gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {busca.data.data.filter((r) => !itens.some((i) => i.id === r.id)).map((r) => (
            <li key={r.id}><button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-cyan-50" onClick={() => { onChange([...itens, { id: r.id, nome: r.nome }]); setQ(""); }}>
              <span>{r.nome ?? r.id} <span className="text-xs text-slate-400">{r.detalhe ?? ""}</span></span><Plus size={14} className="text-cyan-700" /></button></li>
          ))}
          {!busca.data.data.length ? <li className="px-2 py-1.5 text-xs text-slate-500">Nada encontrado.</li> : null}
        </ul>
      ) : null}
      <ul className="flex flex-wrap gap-1.5">
        {itens.map((i) => <li key={i.id} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200">{i.nome ?? i.id}<button type="button" aria-label={`Remover ${i.nome ?? i.id}`} onClick={() => onChange(itens.filter((x) => x.id !== i.id))} className="text-slate-400 hover:text-rose-600"><X size={12} /></button></li>)}
        {!itens.length ? <li className="text-xs text-slate-500">Nenhum selecionado.</li> : null}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ colaboradores (visão por pessoa)

function Colaboradores() {
  const lista = useQuery({ queryKey: ["mcp", "usuarios"], queryFn: () => api<UsuarioMcp[]>(`${BASE}/colaboradores`) });
  const [id, setId] = useState<string | null>(null);
  const itens = lista.data?.data ?? [];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden p-0 lg:sticky lg:top-0">
        <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">Colaboradores do painel</p>
        {lista.isLoading ? <div className="p-3"><Skeleton className="h-32" /></div> : null}
        <ul className="max-h-[70vh] overflow-auto">
          {itens.map((u) => (
            <li key={u.id} className="border-b border-slate-100 last:border-b-0">
              <button type="button" aria-pressed={id === u.id} onClick={() => setId(u.id)} className={cn("grid w-full gap-0.5 px-4 py-3 text-left transition", id === u.id ? "bg-cyan-50" : "hover:bg-slate-50")}>
                <span className={cn("text-sm font-semibold", id === u.id ? "text-cyan-800" : "text-navy-900")}>{u.nome}</span>
                <span className="truncate text-xs text-slate-500">{u.email}</span>
                <span className="text-xs text-slate-500">{u.integracoes} {u.integracoes === 1 ? "integração" : "integrações"} · último acesso {quando(u.ultimoAcesso)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {id ? <VisaoColaborador key={id} id={id} /> : <Empty title="Nenhum colaborador escolhido" text="Veja, por pessoa, em quais integrações ela está, o que realmente consegue usar e o que está bloqueado (e por quem)." />}
    </div>
  );
}

const ROTULO_ORIGEM: Record<string, string> = { painel: "Painel", integracao: "Integração", colaborador: "Colaborador", abrangencia: "Abrangência", permissao: "Permissão", oauth: "OAuth" };

function VisaoColaborador({ id }: { id: string }) {
  const client = useQueryClient();
  const v = useQuery({ queryKey: ["mcp", "colaborador", id], queryFn: () => api<VisaoUsuario>(`${BASE}/colaboradores/${id}`) });
  const [aviso, setAviso] = useState("");
  const revogar = useMutation({
    mutationFn: (integ: string | null) => api<{ revogados: number }>(integ ? `${BASE}/integracoes/${integ}/revogar` : `${BASE}/colaboradores/${id}/revogar`, { method: "POST", body: JSON.stringify(integ ? { usuario: id } : {}) }),
    onSuccess: async (r) => { setAviso(`${r.data.revogados} conexão(ões) revogada(s).`); await client.invalidateQueries({ queryKey: ["mcp"] }); },
  });
  if (v.isLoading) return <Skeleton className="h-64" />;
  if (!v.data) return <Alerta>Não foi possível carregar o colaborador.</Alerta>;
  const { usuario, integracoes } = v.data.data;
  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-lg font-bold text-navy-900">{usuario.nome}</h2><p className="text-xs text-slate-500">{usuario.email}{usuario.admin ? " · administrador" : ""}{usuario.ativo ? "" : " · bloqueado no painel"}</p></div>
        <Button type="button" variant="danger" disabled={revogar.isPending || !integracoes.length} onClick={() => { if (window.confirm(`Revogar TODAS as conexões de ${usuario.nome}?`)) revogar.mutate(null); }}><Ban size={16} /> Revogar todas as conexões</Button>
      </div>
      {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
      {erroDe(revogar.error) ? <Alerta>{erroDe(revogar.error)}</Alerta> : null}
      {!integracoes.length ? <p className="text-sm text-slate-500">Este colaborador não está autorizado em nenhuma integração.</p> : null}
      {integracoes.map((i) => (
        <Secao key={i.id} titulo={`${i.nome} (${i.slug})`} texto={i.ativa ? undefined : "Integração desativada: nada é entregue."}
          acoes={<Button type="button" variant="secondary" className="h-8" disabled={revogar.isPending || !i.conexoesAtivas} onClick={() => revogar.mutate(i.id)}><Ban size={14} /> Revogar ({i.conexoesAtivas ?? 0})</Button>}>
          {i.erro ? <Alerta tom="aviso">{i.erro}</Alerta> : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Indicador titulo="Abrangência" valor={<span className="text-base">{i.abrangencia}</span>} />
                <Indicador titulo="Conexões ativas" valor={i.conexoesAtivas ?? 0} />
                <Indicador titulo="Chamadas" valor={i.chamadas ?? 0} dica={`${i.negados ?? 0} negadas`} />
                <Indicador titulo="Último acesso" valor={<span className="text-sm">{quando(i.ultimoAcesso ?? null)}</span>} />
              </dl>
              <p className="text-xs text-slate-600">Contato do candidato: <b>{i.contato ? "liberado" : "desligado"}</b>{i.permissoes?.length ? ` · permissões: ${i.permissoes.join(", ")}` : ""}</p>
              {i.registros && (i.registros.candidatos.length || i.registros.empresas.length) ? (
                <p className="text-xs text-slate-600">Autorizados: {[...i.registros.candidatos.map((x) => x.nome ?? x.id), ...i.registros.empresas.map((x) => `${x.nome ?? x.id} (empresa)`)].join(", ")}</p>
              ) : null}
              <ul className="grid gap-1">
                {i.ferramentas.map((f) => (
                  <li key={f.nome} className={cn("grid gap-0.5 rounded-md px-2 py-1.5 text-sm sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:items-center", f.disponivel ? "bg-emerald-50/60" : "bg-slate-50")}>
                    <span className="flex items-center gap-1.5 font-medium text-navy-900">{f.disponivel ? <ShieldCheck size={14} className="text-emerald-600" /> : <Ban size={14} className="text-slate-400" />}{f.titulo}</span>
                    <span className="text-xs text-slate-600">{f.disponivel ? "Disponível." : <><Badge value={f.bloqueio?.origem === "painel" ? "pausada" : "encerrada"}>{ROTULO_ORIGEM[f.bloqueio?.origem ?? ""] ?? "Bloqueio"}</Badge> {f.bloqueio?.texto}</>}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Secao>
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------ auditoria

const RESULTADOS = [{ id: "", rotulo: "Todos" }, { id: "ok", rotulo: "Sucesso" }, { id: "negado", rotulo: "Negados" }, { id: "erro", rotulo: "Erros" }, { id: "invalido", rotulo: "Inválidos" }, { id: "limite", rotulo: "Limite" }] as const;

function AuditoriaMcp() {
  const [f, setF] = useState({ integracao: "", usuario: "", ferramenta: "", resultado: "", de: "", ate: "", pagina: 1 });
  const integ = useQuery({ queryKey: ["mcp", "integracoes"], queryFn: () => api<ResumoInteg[]>(`${BASE}/integracoes`) });
  const users = useQuery({ queryKey: ["mcp", "usuarios"], queryFn: () => api<UsuarioMcp[]>(`${BASE}/colaboradores`) });
  const cat = useQuery({ queryKey: ["mcp", "catalogo"], queryFn: () => api<Catalogo>(`${BASE}/ferramentas`) });
  const qs = useMemo(() => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v !== "" && v !== 1) p.set(k, String(v)); if (f.pagina > 1) p.set("pagina", String(f.pagina)); return p.toString(); }, [f]);
  const aud = useQuery({ queryKey: ["mcp", "auditoria", qs], queryFn: () => api<Auditoria>(`${BASE}/auditoria?${qs}`) });
  const a = aud.data?.data;
  const muda = (parcial: Partial<typeof f>) => setF((x) => ({ ...x, ...parcial, pagina: 1 }));
  const ferramentas = (cat.data?.data.modulos ?? []).flatMap((m) => m.ferramentas);
  const filtrando = Object.entries(f).some(([k, v]) => k !== "pagina" && v !== "");
  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CampoFiltro rotulo="Integração"><Select value={f.integracao} onChange={(e) => muda({ integracao: e.target.value })}><option value="">Todas</option>{(integ.data?.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}</Select></CampoFiltro>
          <CampoFiltro rotulo="Colaborador"><Select value={f.usuario} onChange={(e) => muda({ usuario: e.target.value })}><option value="">Todos</option>{(users.data?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</Select></CampoFiltro>
          <CampoFiltro rotulo="Ferramenta"><Select value={f.ferramenta} onChange={(e) => muda({ ferramenta: e.target.value })}><option value="">Todas</option>{ferramentas.map((t) => <option key={t.nome} value={t.nome}>{t.titulo}</option>)}</Select></CampoFiltro>
          <div className="grid grid-cols-2 gap-2"><CampoFiltro rotulo="De"><Input type="date" value={f.de} onChange={(e) => muda({ de: e.target.value })} /></CampoFiltro><CampoFiltro rotulo="Até"><Input type="date" value={f.ate} onChange={(e) => muda({ ate: e.target.value })} /></CampoFiltro></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FiltroChips rotulo="Resultado" opcoes={RESULTADOS.map((r) => ({ id: r.id, rotulo: r.rotulo }))} valor={f.resultado} onChange={(id) => muda({ resultado: id })} />
          {filtrando ? <button type="button" className="rounded-lg px-2.5 py-1 text-sm font-semibold text-cyan-700 hover:bg-cyan-50" onClick={() => setF({ integracao: "", usuario: "", ferramenta: "", resultado: "", de: "", ate: "", pagina: 1 })}>Limpar filtros</button> : null}
        </div>
      </Card>
      {aud.isLoading ? <Skeleton className="h-40" /> : null}
      {aud.isError ? <Alerta>Não foi possível carregar a auditoria.</Alerta> : null}
      {a ? (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Indicador titulo="Chamadas" valor={a.indicadores.chamadas} />
            <Indicador titulo="Bem-sucedidas" valor={a.indicadores.sucesso} />
            <Indicador titulo="Erros" valor={a.indicadores.erros} />
            <Indicador titulo="Acessos negados" valor={a.indicadores.negados} />
            <Indicador titulo="Limite excedido" valor={a.indicadores.limites} />
            <Indicador titulo="Tempo médio" valor={a.indicadores.tempoMedioMs == null ? "—" : `${a.indicadores.tempoMedioMs} ms`} />
          </dl>
          <div className="grid gap-3 lg:grid-cols-3">
            <Card><h3 className="text-sm font-bold text-navy-900">Ferramentas mais usadas</h3><Ranking itens={a.indicadores.ferramentasMaisUsadas.map((x) => ({ nome: x.ferramenta, n: x.chamadas }))} /></Card>
            <Card><h3 className="text-sm font-bold text-navy-900">Colaboradores mais ativos</h3><Ranking itens={a.indicadores.colaboradoresMaisAtivos.map((x) => ({ nome: x.nome, n: x.chamadas }))} /></Card>
            <Card><h3 className="text-sm font-bold text-navy-900">Serviços externos</h3><Ranking itens={a.indicadores.servicosExternos.chamadasPorFerramenta.map((x) => ({ nome: x.ferramenta, n: x.chamadas }))} /><p className="mt-2 text-[11px] text-slate-500">{a.indicadores.servicosExternos.observacao}</p></Card>
          </div>
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500"><tr><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Colaborador</th><th className="px-3 py-2">Integração</th><th className="px-3 py-2">Operação / ferramenta</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2 text-right">Tempo</th></tr></thead>
                <tbody>
                  {a.eventos.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{quando(e.quando)}</td><td className="px-3 py-2">{e.colaborador ?? "—"}</td><td className="px-3 py-2 font-mono text-xs">{e.integracao ?? "—"}</td>
                      <td className="px-3 py-2">{e.ferramenta ?? e.operacao}</td>
                      <td className="px-3 py-2"><Badge value={e.resultado === "ok" ? "ativa" : e.resultado === "negado" || e.resultado === "erro" ? "recusado" : "pausada"}>{e.resultado}</Badge>{e.motivo ? <span className="ml-1.5 text-xs text-slate-500">{e.motivo}</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">{e.duracaoMs == null ? "—" : `${e.duracaoMs} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!a.eventos.length ? <p className="px-4 py-6 text-sm text-slate-500">Nenhum registro com estes filtros.</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>{a.paginacao.total} registros · guardados por {a.retencaoDias} dias · sem tokens, segredos nem conteúdo das consultas</span>
              <span className="flex gap-2"><Button type="button" variant="secondary" className="h-8" disabled={a.paginacao.pagina <= 1} onClick={() => setF((x) => ({ ...x, pagina: x.pagina - 1 }))}>Anterior</Button><Button type="button" variant="secondary" className="h-8" disabled={a.paginacao.pagina * a.paginacao.limite >= a.paginacao.total} onClick={() => setF((x) => ({ ...x, pagina: x.pagina + 1 }))}>Próxima</Button></span>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Ranking({ itens }: { itens: Array<{ nome: string; n: number }> }) {
  const max = Math.max(1, ...itens.map((i) => i.n));
  if (!itens.length) return <p className="mt-2 text-xs text-slate-500">Sem dados no período.</p>;
  return (
    <ul className="mt-2 grid gap-1.5">
      {itens.map((i) => (
        <li key={i.nome} className="grid gap-0.5 text-xs">
          <span className="flex justify-between gap-2"><span className="truncate text-slate-700">{i.nome}</span><span className="tabular-nums font-semibold text-navy-900">{i.n}</span></span>
          <span className="h-1.5 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-cyan-600" style={{ width: `${(i.n / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ infraestrutura

function InfraMcp() {
  const q = useQuery({ queryKey: ["mcp", "infra"], queryFn: () => api<Infra>(`${BASE}/resumo`) });
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (!q.data) return <Alerta>Não foi possível carregar o status do MCP.</Alerta>;
  const i = q.data.data;
  return (
    <div className="grid gap-4">
      <Card className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><Plug size={18} /> Status do MCP</h2>
          {i.prontidao.pronto ? <Badge value="ativa">Pronto</Badge> : <Badge value="pausada">Pendências</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Indicador titulo="MCP no monólito" valor={<span className="text-base">{i.mcp.habilitado ? "Ligado" : "Desligado"}</span>} />
          <Indicador titulo="Contrato interno" valor={`v${i.contrato.versaoDoMonolito}`} dica={`aceita: ${i.contrato.aceitas.join(", ") || "—"}`} />
          <Indicador titulo="OAuth" valor={<span className="text-base">{i.oauth.ativo ? "Ativo" : "Inativo"}</span>} dica={i.oauth.registroDinamicoDeClientes ? "registro dinâmico ligado" : "registro dinâmico desligado"} />
          <Indicador titulo="Integrações ativas" valor={`${i.integracoes.ativas}/${i.integracoes.total}`} />
        </dl>
        <ul className="grid gap-1 text-sm">
          <li><b>Gateway:</b> {i.mcp.urlPublica ?? "não configurado"}</li>
          <li><b>Comunicação com o monólito:</b> {i.monolito.comunicacao}{i.monolito.ultimaChamadaDoGateway ? ` (última: ${quando(i.monolito.ultimaChamadaDoGateway)})` : ""}</li>
          <li><b>Canal interno:</b> {i.mtls.modo}{i.mtls.certificado ? ` · certificado válido até ${quando(i.mtls.certificado.validoAte)} (${i.mtls.certificado.diasRestantes} dias)` : ""}{i.mtls.erro ? ` · ${i.mtls.erro}` : ""}</li>
          <li><b>Retenção:</b> auditoria {i.retencao.auditoriaDias} dias · registros OAuth vencidos {i.retencao.oauthDias} dias</li>
        </ul>
      </Card>
      <Card className="grid gap-2">
        <h3 className="text-sm font-bold text-navy-900">Prontidão</h3>
        <ul className="grid gap-1">{i.prontidao.itens.map((p) => <li key={p.item} className="flex items-center gap-2 text-sm">{p.ok ? <Check size={16} className="text-emerald-600" /> : <X size={16} className="text-amber-600" />}<span className={p.ok ? "text-slate-700" : "text-amber-800"}>{p.item}</span></li>)}</ul>
      </Card>
      <Card className="grid gap-2">
        <h3 className="text-sm font-bold text-navy-900">Como conectar ao ChatGPT</h3>
        <ol className="grid list-decimal gap-1 pl-5 text-sm text-slate-700">{i.chatgpt.passos.map((p) => <li key={p}>{p}</li>)}</ol>
        <p className="text-xs text-slate-500">{i.chatgpt.observacao}</p>
        <Alerta tom="info">{i.segredos}</Alerta>
      </Card>
    </div>
  );
}

