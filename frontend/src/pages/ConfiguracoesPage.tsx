import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2, UserPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Badge, Button, Card, Empty, Field, Input, Skeleton, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Pagina = { id: string; nome: string; grupo: string };
type Usuario = { id: string; nome: string; email: string; ativo: boolean; admin: boolean; paginas: string[] };
type Painel = { total: number; com_acesso: number; sem_acesso: number; paginas: Pagina[]; usuarios: Usuario[]; criado?: string };

const NOVO = "novo";

function mensagem(error: unknown) {
  return error instanceof ApiError ? error.message : "";
}

export function ConfiguracoesPage() {
  const client = useQueryClient();
  const acessos = useQuery({ queryKey: ["acessos"], queryFn: () => api<Painel>("/api/v1/configuracoes/acessos") });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const dados = acessos.data?.data;
  const usuario = dados?.usuarios.find((item) => item.id === escolhido) ?? null;
  const atualizar = () => client.invalidateQueries({ queryKey: ["acessos"] });
  const salvar = useMutation({
    mutationFn: (input: { id: string; ativo: boolean; paginas: string[]; senha?: string }) => api<Painel>(`/api/v1/configuracoes/usuarios/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo: input.ativo, paginas: input.paginas, ...(input.senha ? { senha: input.senha } : {}) }),
    }),
    onSuccess: async () => { setAviso("Acesso salvo."); await atualizar(); },
  });
  const criar = useMutation({
    mutationFn: (input: { nome: string; email: string; senha: string; paginas: string[] }) => api<Painel>("/api/v1/configuracoes/usuarios", {
      method: "POST",
      body: JSON.stringify(input),
    }),
    onSuccess: async (resposta) => {
      setAviso("Usuário criado.");
      await atualizar();
      setEscolhido(resposta.data.criado ?? null);
    },
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api<Painel>(`/api/v1/configuracoes/usuarios/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setAviso("Usuário apagado.");
      setEscolhido(null);
      await atualizar();
    },
  });
  function escolher(id: string) {
    setAviso("");
    salvar.reset();
    criar.reset();
    apagar.reset();
    setEscolhido(id);
  }

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Configurações"
        descricao="Quem entra no sistema interno e quais páginas cada pessoa pode usar."
        acoes={<Button type="button" onClick={() => escolher(NOVO)}><UserPlus size={16} /> Novo usuário</Button>}
      />
      {acessos.isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {acessos.isError ? <Alerta>Não foi possível carregar os acessos. Atualize a página; se continuar, avise o suporte.</Alerta> : null}
      {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
      {dados ? (
        <>
          <dl className="grid grid-cols-3 gap-3">
            <Contagem titulo="Usuários" valor={dados.total} />
            <Contagem titulo="Com acesso" valor={dados.com_acesso} />
            <Contagem titulo="Sem acesso" valor={dados.sem_acesso} />
          </dl>
          <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="overflow-hidden p-0 lg:sticky lg:top-0">
              <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">Pessoas com login</p>
              <ul className="max-h-[70vh] overflow-auto">
                {dados.usuarios.map((item) => {
                  const ativo = escolhido === item.id;
                  return (
                    <li key={item.id} className="border-b border-slate-100 last:border-b-0">
                      <button type="button" aria-pressed={ativo} className={cn("grid w-full gap-0.5 px-4 py-3 text-left transition", ativo ? "bg-cyan-50" : "hover:bg-slate-50")} onClick={() => escolher(item.id)}>
                        <span className={cn("text-sm font-semibold", ativo ? "text-cyan-800" : "text-navy-900")}>{item.nome}</span>
                        <span className="truncate text-xs text-slate-500">{item.email}</span>
                        <span className="mt-1 flex">
                          {item.admin ? <Badge value="estagio">Administrador</Badge> : item.ativo ? (
                            <span className="text-xs text-slate-500">{item.paginas.length} {item.paginas.length === 1 ? "página" : "páginas"}</span>
                          ) : <Badge value="encerrada">Sem acesso</Badge>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            {escolhido === NOVO ? (
              <NovoUsuario paginas={dados.paginas} pendente={criar.isPending} erro={mensagem(criar.error)} onCancel={() => setEscolhido(null)} onSave={(input) => criar.mutate(input)} />
            ) : usuario ? (
              <Editor
                key={usuario.id}
                usuario={usuario}
                paginas={dados.paginas}
                pendente={salvar.isPending || apagar.isPending}
                erro={mensagem(salvar.error) || mensagem(apagar.error)}
                onSave={(ativo, paginas, senha) => { setAviso(""); salvar.mutate({ id: usuario.id, ativo, paginas, senha }); }}
                onDelete={() => { setAviso(""); apagar.mutate(usuario.id); }}
              />
            ) : <Empty title="Nenhuma pessoa escolhida" text="Escolha uma pessoa na lista para definir o acesso, ou use “Novo usuário” para criar um login." />}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Contagem({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold text-slate-500">{titulo}</dt>
      <dd className="mt-0.5 text-xl font-extrabold tabular-nums text-navy-900">{valor}</dd>
    </div>
  );
}

/** Seção do formulário: título e uma frase do que se define nela. */
function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-slate-100 pt-4">
      <div>
        <h3 className="text-sm font-bold text-navy-900">{titulo}</h3>
        {texto ? <p className="text-xs text-slate-500">{texto}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PaginasMarcadas({ paginas, marcadas, onChange }: { paginas: Pagina[]; marcadas: string[]; onChange: (marcadas: string[]) => void }) {
  const grupos = [...new Set(paginas.map((pagina) => pagina.grupo))];
  function trocar(id: string) {
    onChange(marcadas.includes(id) ? marcadas.filter((item) => item !== id) : [...marcadas, id]);
  }
  /** Marca ou desmarca todas as páginas da área de uma vez. */
  function trocarArea(ids: string[], marcar: boolean) {
    onChange(marcar ? [...new Set([...marcadas, ...ids])] : marcadas.filter((item) => !ids.includes(item)));
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {grupos.map((grupo) => {
        const daArea = paginas.filter((pagina) => pagina.grupo === grupo);
        const ids = daArea.map((pagina) => pagina.id);
        const quantas = ids.filter((id) => marcadas.includes(id)).length;
        return (
        <fieldset key={grupo} className="grid content-start gap-2 rounded-lg border border-slate-200 p-3">
          <legend className="px-1">
            <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              <CaixaArea todas={quantas === ids.length} algumas={quantas > 0 && quantas < ids.length} onChange={(marcar) => trocarArea(ids, marcar)} />
              {grupo}
              <span className="text-xs font-normal tabular-nums text-slate-500">{quantas} de {ids.length}</span>
            </label>
          </legend>
          {daArea.map((pagina) => (
            <label key={pagina.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={marcadas.includes(pagina.id)} onChange={() => trocar(pagina.id)} />
              {pagina.nome}
            </label>
          ))}
        </fieldset>
        );
      })}
    </div>
  );
}

/** Caixa da área: marcada com todas, "meio marcada" com algumas. */
function CaixaArea({ todas, algumas, onChange }: { todas: boolean; algumas: boolean; onChange: (marcar: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = algumas;
  }, [algumas]);
  return <input ref={ref} type="checkbox" className="h-4 w-4 accent-cyan-700" checked={todas} onChange={() => onChange(!todas)} />;
}

function NovoUsuario({ paginas, pendente, erro, onSave, onCancel }: {
  paginas: Pagina[];
  pendente: boolean;
  erro: string;
  onSave: (input: { nome: string; email: string; senha: string; paginas: string[] }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ nome: "", email: "", senha: "" });
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [aviso, setAviso] = useState("");
  function enviar(event: FormEvent) {
    event.preventDefault();
    if (!marcadas.length) {
      setAviso("Marque pelo menos uma página.");
      return;
    }
    setAviso("");
    onSave({ nome: form.nome.trim(), email: form.email.trim(), senha: form.senha.trim(), paginas: marcadas });
  }
  return (
    <form className="grid h-fit gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5" onSubmit={enviar}>
      <div>
        <h2 className="text-[15px] font-bold text-navy-900">Novo usuário</h2>
        <p className="text-sm text-slate-500">Crie o login e marque as páginas que a pessoa vai usar. Ela já entra com acesso liberado.</p>
      </div>
      <Secao titulo="Dados de acesso">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2"><Field label="Nome"><Input required minLength={2} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></Field></div>
          <div className="md:col-span-2"><Field label="E-mail"><Input required type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field></div>
          <div className="md:col-span-2"><Field label="Senha"><Input required minLength={8} type="password" autoComplete="new-password" placeholder="Pelo menos 8 caracteres" value={form.senha} onChange={(event) => setForm({ ...form, senha: event.target.value })} /></Field></div>
        </div>
      </Secao>
      <Secao titulo="Páginas que pode usar" texto="Marque a área para liberar todas as páginas dela de uma vez.">
        <PaginasMarcadas paginas={paginas} marcadas={marcadas} onChange={setMarcadas} />
      </Secao>
      {aviso || erro ? <Alerta>{aviso || erro}</Alerta> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={pendente}><UserPlus size={16} /> {pendente ? "Criando…" : "Criar usuário"}</Button>
      </div>
    </form>
  );
}

function Editor({ usuario, paginas, pendente, erro, onSave, onDelete }: {
  usuario: Usuario;
  paginas: Pagina[];
  pendente: boolean;
  erro: string;
  onSave: (ativo: boolean, paginas: string[], senha?: string) => void;
  onDelete: () => void;
}) {
  const [ativo, setAtivo] = useState(usuario.ativo);
  const [marcadas, setMarcadas] = useState<string[]>(usuario.paginas);
  const [senha, setSenha] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  function enviar(event: FormEvent) {
    event.preventDefault();
    const nova = senha.trim();
    if (nova && nova.length < 8) {
      setAviso("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    setAviso("");
    onSave(ativo, marcadas, nova || undefined);
    setSenha("");
  }
  return (
    <form className="grid h-fit gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5" onSubmit={enviar}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-navy-900">
            {usuario.nome}
            {usuario.admin ? <Badge value="estagio">Administrador</Badge> : usuario.ativo ? <Badge value="ativa">Com acesso</Badge> : <Badge value="encerrada">Sem acesso</Badge>}
          </h2>
          <p className="truncate text-sm text-slate-500">{usuario.email}</p>
        </div>
        {usuario.admin ? null : <Button type="button" variant="secondary" className="text-rose-700" disabled={pendente} onClick={() => setConfirmando(true)}><Trash2 size={16} /> Apagar usuário</Button>}
      </div>
      {confirmando ? (
        <div role="alertdialog" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-700">Apagar {usuario.nome}? A pessoa perde o acesso e isso não pode ser desfeito.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button type="button" variant="danger" disabled={pendente} onClick={onDelete}>{pendente ? "Apagando…" : "Apagar"}</Button>
          </div>
        </div>
      ) : null}
      <Secao titulo="Senha" texto="Deixe em branco para manter a senha atual.">
        <div className="max-w-sm">
          <Field label="Nova senha">
            <Input type="password" autoComplete="new-password" value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Pelo menos 8 caracteres" />
          </Field>
        </div>
      </Secao>
      {usuario.admin ? (
        <Secao titulo="Páginas que pode usar">
          <Alerta tom="info">O administrador usa todas as páginas. Essa conta não é limitada aqui.</Alerta>
        </Secao>
      ) : (
        <>
          <Secao titulo="Entrada no sistema">
            <label className="grid gap-0.5 text-sm font-medium text-slate-700">
              <span className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={ativo} onChange={(event) => setAtivo(event.target.checked)} />
                Pode entrar no sistema
              </span>
              <span className="pl-6 text-xs font-normal text-slate-500">Desmarque para bloquear o login da pessoa sem apagar o usuário. As páginas marcadas ficam guardadas para quando liberar de novo.</span>
            </label>
          </Secao>
          <Secao titulo="Páginas que pode usar" texto="Marque a área para liberar todas as páginas dela de uma vez.">
            <PaginasMarcadas paginas={paginas} marcadas={marcadas} onChange={setMarcadas} />
          </Secao>
        </>
      )}
      {erro || aviso ? <Alerta>{aviso || erro}</Alerta> : null}
      <div className="flex justify-end border-t border-slate-100 pt-4">
        <Button type="submit" disabled={pendente}><Save size={16} /> Salvar alterações</Button>
      </div>
    </form>
  );
}
