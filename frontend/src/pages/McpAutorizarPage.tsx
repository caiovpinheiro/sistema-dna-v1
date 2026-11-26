import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Navigate, useParams } from "react-router-dom";
import { FundoLiquido } from "@/components/fundo-liquido";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Pedido = {
  pode: boolean; motivo: string | null; aplicativo: { id: string; nome: string } | null;
  integracao: { nome: string; descricao: string | null; finalidade: string | null } | null;
  acesso: string; escopos: { solicitados: string[]; concedidos: string[]; ignorados: string[]; padraoAplicado: boolean };
  usuario: { nome: string } | null; modulos: Array<{ id: string; ferramentas: string[] }>; abrangencia: string | null; contato: boolean; privacidade: string[];
};

const MODULOS: Record<string, string> = { vagas: "Vagas", empresas: "Empresas", triagem: "Triagem", candidatos: "Candidatos", dossies: "Dossiês", processos: "Processos", contratacoes: "Contratações", gestao: "Gestão" };
const ESCOPOS: Record<string, string> = { "mcp:read": "Consultar informações do DNA Work (somente leitura)" };
const ABRANGENCIAS: Record<string, string> = {
  nenhuma: "Sem acesso a dados individuais de candidatos, processos e contratações.",
  autorizados: "Somente os candidatos e empresas que o administrador autorizou para você.",
  todos: "Todos os registros que o seu acesso no painel permite.",
};

/** Tela de autorização OAuth (ChatGPT e outros clientes MCP). Mostra o que será liberado e nunca amplia o que a administração concedeu. */
export function McpAutorizarPage() {
  const { uid = "" } = useParams();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("/api/v1/auth/me"), retry: false });
  const pedido = useQuery({ queryKey: ["mcp-autorizar", uid], enabled: me.isSuccess, retry: false, queryFn: () => api<Pedido>(`/api/v1/mcp/interacao/${encodeURIComponent(uid)}`) });
  const decidir = useMutation({
    mutationFn: (aprovar: boolean) => api<{ redirectTo: string }>(`/api/v1/mcp/interacao/${encodeURIComponent(uid)}/decisao`, { method: "POST", body: JSON.stringify({ aprovar }) }),
    onSuccess: (r) => { window.location.assign(r.data.redirectTo); },
  });
  if (me.isLoading) return <Moldura><Skeleton className="h-48" /></Moldura>;
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(`/mcp/autorizar/${uid}`)}`} replace />;
  const d = pedido.data?.data;
  return (
    <Moldura>
      {pedido.isLoading ? <Skeleton className="h-48" /> : null}
      {pedido.isError ? <Alerta>{pedido.error instanceof ApiError ? pedido.error.message : "Não foi possível carregar o pedido de autorização."} Volte ao aplicativo e tente conectar de novo.</Alerta> : null}
      {d ? (
        <div className="grid gap-5">
          <div className="grid gap-1">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-cyan-700"><ShieldCheck size={14} /> Autorizar conexão</p>
            <h1 className="text-xl font-extrabold tracking-tight text-navy-900">{d.aplicativo?.nome ?? "Um aplicativo"} quer se conectar ao DNA Work</h1>
            <p className="text-sm text-slate-500">Você está entrando como <b className="text-navy-900">{d.usuario?.nome ?? "—"}</b>.</p>
          </div>
          {d.integracao ? (
            <section className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm">
              <p><span className="text-xs font-semibold text-slate-500">Integração</span><br /><b className="text-navy-900">{d.integracao.nome}</b></p>
              {d.integracao.finalidade ? <p><span className="text-xs font-semibold text-slate-500">Finalidade</span><br />{d.integracao.finalidade}</p> : null}
              {d.integracao.descricao ? <p className="text-slate-600">{d.integracao.descricao}</p> : null}
            </section>
          ) : null}
          {!d.pode ? <Alerta tom="aviso">{d.motivo ?? "Esta conexão não pode ser autorizada."}</Alerta> : (
            <>
              <section className="grid gap-2">
                <h2 className="text-sm font-bold text-navy-900">O que será liberado</h2>
                <p className="rounded-lg bg-cyan-50 px-3 py-2 text-sm text-cyan-900">{d.acesso}</p>
                <ul className="grid gap-1.5 text-sm">
                  {d.escopos.concedidos.map((e) => <li key={e} className="flex items-center gap-2"><Badge value="ativa">{e}</Badge><span className="text-slate-700">{ESCOPOS[e] ?? e}</span></li>)}
                </ul>
                {d.escopos.ignorados.length ? <p className="text-xs text-slate-500">Ignorado por não ser suportado: {d.escopos.ignorados.join(", ")}.</p> : null}
              </section>
              <section className="grid gap-2">
                <h2 className="text-sm font-bold text-navy-900">Módulos que você poderá consultar</h2>
                {d.modulos.length ? (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {d.modulos.map((m) => (
                      <li key={m.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><b className="text-navy-900">{MODULOS[m.id] ?? m.id}</b><br /><span className="text-xs text-slate-500">{m.ferramentas.length} {m.ferramentas.length === 1 ? "consulta" : "consultas"}</span></li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-slate-500">Nenhum módulo está liberado para você agora. Peça ao administrador.</p>}
                <p className="text-xs text-slate-500">Abrangência: {ABRANGENCIAS[d.abrangencia ?? "nenhuma"] ?? "—"} {d.contato ? "Telefone e e-mail de candidatos liberados para você." : "Telefone e e-mail de candidatos permanecem desligados."}</p>
                <p className="text-xs text-slate-500">Autorizar não amplia nada: o assistente nunca vê mais do que o administrador liberou e do que o seu acesso no painel permite.</p>
              </section>
              <section className="grid gap-1.5">
                <h2 className="text-sm font-bold text-navy-900">Privacidade e tratamento de dados</h2>
                <ul className="grid list-disc gap-1 pl-5 text-xs text-slate-600">{d.privacidade.map((p) => <li key={p}>{p}</li>)}</ul>
              </section>
            </>
          )}
          {decidir.isError ? <Alerta>{decidir.error instanceof ApiError ? decidir.error.message : "Não foi possível registrar a decisão."}</Alerta> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled={decidir.isPending} onClick={() => decidir.mutate(false)}>Recusar</Button>
            <Button type="button" disabled={decidir.isPending || !d.pode} onClick={() => decidir.mutate(true)}>{decidir.isPending ? "Enviando…" : "Autorizar"}</Button>
          </div>
        </div>
      ) : null}
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <FundoLiquido>
      <Card className="w-full max-w-xl p-6 sm:p-8">
        <img src="/logo-laranja.png" alt="DNA Work" className="mb-5 h-12 w-20 object-contain" />
        {children}
      </Card>
    </FundoLiquido>
  );
}
