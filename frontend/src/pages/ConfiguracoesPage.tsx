import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Pagina = { id: string; nome: string; grupo: string };
type Usuario = { id: string; nome: string; email: string; ativo: boolean; admin: boolean; paginas: string[] };
type Painel = { total: number; com_acesso: number; sem_acesso: number; paginas: Pagina[]; usuarios: Usuario[] };

export function ConfiguracoesPage() {
  const client = useQueryClient();
  const acessos = useQuery({ queryKey: ["acessos"], queryFn: () => api<Painel>("/api/v1/configuracoes/acessos") });
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const dados = acessos.data?.data;
  const usuario = dados?.usuarios.find((item) => item.id === escolhido) ?? null;
  const salvar = useMutation({
    mutationFn: (input: { id: string; ativo: boolean; paginas: string[] }) => api<Painel>(`/api/v1/configuracoes/usuarios/${input.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo: input.ativo, paginas: input.paginas }),
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["acessos"] }); },
  });

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Configurações</h1>
        <p className="text-sm text-slate-400">Quem entra no interno e quais páginas cada pessoa pode usar.</p>
      </div>
      {acessos.isLoading ? <p className="text-sm text-slate-400">Carregando usuários…</p> : null}
      {acessos.isError ? <p className="text-sm text-rose-300">Não foi possível carregar os acessos.</p> : null}
      {dados ? (
        <>
          <div className="grid grid-cols-3 overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
            <Contagem titulo="Usuários" valor={dados.total} />
            <Contagem titulo="Com acesso" valor={dados.com_acesso} />
            <Contagem titulo="Sem acesso" valor={dados.sem_acesso} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <ul className="overflow-hidden rounded-xl bg-[#12141a] ring-1 ring-white/10">
              {dados.usuarios.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`grid w-full gap-0.5 px-4 py-3 text-left ${escolhido === item.id ? "bg-white/10" : "hover:bg-white/5"}`} onClick={() => setEscolhido(item.id)}>
                    <span className="text-sm font-semibold text-white">{item.nome}</span>
                    <span className="truncate text-xs text-slate-400">{item.email}</span>
                    <span className="text-xs text-slate-500">{item.admin ? "Administrador" : item.ativo ? `${item.paginas.length} páginas` : "Sem acesso"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {usuario ? <Editor key={usuario.id} usuario={usuario} paginas={dados.paginas} pendente={salvar.isPending} erro={salvar.error instanceof ApiError ? salvar.error.message : ""} onSave={(ativo, paginas) => salvar.mutate({ id: usuario.id, ativo, paginas })} /> : <p className="text-sm text-slate-400">Escolha uma pessoa para definir o acesso.</p>}
          </div>
        </>
      ) : null}
    </div>
  );
}

function Contagem({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-slate-400">{titulo}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums text-white">{valor}</p>
    </div>
  );
}

function Editor({ usuario, paginas, pendente, erro, onSave }: {
  usuario: Usuario;
  paginas: Pagina[];
  pendente: boolean;
  erro: string;
  onSave: (ativo: boolean, paginas: string[]) => void;
}) {
  const [ativo, setAtivo] = useState(usuario.ativo);
  const [marcadas, setMarcadas] = useState<string[]>(usuario.paginas);
  const grupos = [...new Set(paginas.map((pagina) => pagina.grupo))];
  function trocar(id: string) {
    setMarcadas((atual) => atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]);
  }
  return (
    <form className="grid gap-4 rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10" onSubmit={(event) => { event.preventDefault(); onSave(ativo, marcadas); }} key={usuario.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{usuario.nome}</h2>
          <p className="text-xs text-slate-400">{usuario.email}</p>
        </div>
        <Button type="submit" disabled={pendente || usuario.admin}>Salvar</Button>
      </div>
      {erro ? <p className="text-sm text-rose-300">{erro}</p> : null}
      {usuario.admin ? <p className="text-sm text-slate-300">O administrador usa todas as páginas. Essa conta não é limitada aqui.</p> : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={ativo} onChange={(event) => setAtivo(event.target.checked)} />
            Tem acesso ao interno
          </label>
          {grupos.map((grupo) => (
            <fieldset key={grupo} className="grid gap-2">
              <legend className="text-sm text-slate-300">{grupo}</legend>
              {paginas.filter((pagina) => pagina.grupo === grupo).map((pagina) => (
                <label key={pagina.id} className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={marcadas.includes(pagina.id)} onChange={() => trocar(pagina.id)} />
                  {pagina.nome}
                </label>
              ))}
            </fieldset>
          ))}
        </>
      )}
    </form>
  );
}
