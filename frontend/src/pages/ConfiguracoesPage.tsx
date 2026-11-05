import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Configurações</h1>
          <p className="text-sm text-slate-500">Quem entra no interno e quais páginas cada pessoa pode usar.</p>
        </div>
        <Button type="button" onClick={() => escolher(NOVO)}>Novo usuário</Button>
      </div>
      {acessos.isLoading ? <p className="text-sm text-slate-500">Carregando usuários…</p> : null}
      {acessos.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os acessos.</p> : null}
      {aviso ? <p role="status" className="text-sm font-medium text-emerald-700">{aviso}</p> : null}
      {dados ? (
        <>
          <Card className="grid grid-cols-3">
            <Contagem titulo="Usuários" valor={dados.total} />
            <Contagem titulo="Com acesso" valor={dados.com_acesso} />
            <Contagem titulo="Sem acesso" valor={dados.sem_acesso} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <ul className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {dados.usuarios.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`grid w-full gap-0.5 px-4 py-3 text-left ${escolhido === item.id ? "bg-slate-100" : "hover:bg-slate-50"}`} onClick={() => escolher(item.id)}>
                    <span className="text-sm font-semibold text-navy-900">{item.nome}</span>
                    <span className="truncate text-xs text-slate-500">{item.email}</span>
                    <span className="text-xs text-slate-500">{item.admin ? "Administrador" : item.ativo ? `${item.paginas.length} ${item.paginas.length === 1 ? "página" : "páginas"}` : "Sem acesso"}</span>
                  </button>
                </li>
              ))}
            </ul>
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
            ) : <p className="text-sm text-slate-500">Escolha uma pessoa para definir o acesso, ou crie um novo usuário.</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Contagem({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">{valor}</p>
    </div>
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
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {grupos.map((grupo) => {
        const daArea = paginas.filter((pagina) => pagina.grupo === grupo);
        const ids = daArea.map((pagina) => pagina.id);
        const quantas = ids.filter((id) => marcadas.includes(id)).length;
        return (
        <fieldset key={grupo} className="grid content-start gap-2">
          <legend className="mb-1">
            <label className="flex items-center gap-2 text-sm font-semibold text-navy-900">
              <CaixaArea todas={quantas === ids.length} algumas={quantas > 0 && quantas < ids.length} onChange={(marcar) => trocarArea(ids, marcar)} />
              {grupo}
              <span className="text-xs font-normal text-slate-500">{quantas}/{ids.length}</span>
            </label>
          </legend>
          {daArea.map((pagina) => (
            <label key={pagina.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={marcadas.includes(pagina.id)} onChange={() => trocar(pagina.id)} />
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
  return <input ref={ref} type="checkbox" checked={todas} onChange={() => onChange(!todas)} />;
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
    <form className="grid h-fit gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={enviar}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-navy-900">Novo usuário</h2>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" disabled={pendente}>{pendente ? "Criando…" : "Criar usuário"}</Button>
        </div>
      </div>
      {aviso || erro ? <p role="alert" className="text-sm text-rose-600">{aviso || erro}</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Nome"><Input required minLength={2} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></Field>
        <Field label="E-mail"><Input required type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Senha"><Input required minLength={8} type="password" autoComplete="new-password" placeholder="Pelo menos 8 caracteres" value={form.senha} onChange={(event) => setForm({ ...form, senha: event.target.value })} /></Field>
      </div>
      <PaginasMarcadas paginas={paginas} marcadas={marcadas} onChange={setMarcadas} />
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
    <form className="grid h-fit gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" onSubmit={enviar}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{usuario.nome}</h2>
          <p className="text-xs text-slate-500">{usuario.email}</p>
        </div>
        <div className="flex gap-2">
          {usuario.admin ? null : <Button type="button" variant="secondary" className="text-rose-700" disabled={pendente} onClick={() => setConfirmando(true)}>Apagar usuário</Button>}
          <Button type="submit" disabled={pendente}>Salvar</Button>
        </div>
      </div>
      {confirmando ? (
        <div role="alertdialog" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-700">Apagar {usuario.nome}? A pessoa perde o acesso e isso não pode ser desfeito.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setConfirmando(false)}>Cancelar</Button>
            <Button type="button" variant="danger" disabled={pendente} onClick={onDelete}>{pendente ? "Apagando…" : "Apagar"}</Button>
          </div>
        </div>
      ) : null}
      {erro || aviso ? <p role="alert" className="text-sm text-rose-600">{aviso || erro}</p> : null}
      <Field label="Nova senha">
        <Input type="password" autoComplete="new-password" value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Deixe em branco para manter a atual" />
      </Field>
      {usuario.admin ? <p className="text-sm text-slate-600">O administrador usa todas as páginas. Essa conta não é limitada aqui.</p> : (
        <>
          <label className="grid gap-0.5 text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={ativo} onChange={(event) => setAtivo(event.target.checked)} />
              Pode entrar no sistema
            </span>
            <span className="pl-6 text-xs font-normal text-slate-500">Desmarque para bloquear o login da pessoa sem apagar o usuário. As páginas marcadas ficam guardadas para quando liberar de novo.</span>
          </label>
          <PaginasMarcadas paginas={paginas} marcadas={marcadas} onChange={setMarcadas} />
        </>
      )}
    </form>
  );
}
