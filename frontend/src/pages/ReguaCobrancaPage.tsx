import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CalendarClock, ChevronDown, ExternalLink, FileCheck2, FlaskConical, Info, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { CabecalhoPagina, CampoFiltro } from "@/components/pagina";
import { Badge, Button, Card, Empty, Input, Skeleton, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dataHoraBr, money } from "@/lib/format";

type Envio = {
  id: string;
  etapa: string;
  label: string;
  data_prevista: string;
  status: string;
  enviado_em: string | null;
  responsavel: string | null;
  pendentes: boolean;
  marco: boolean;
};
type Fatura = {
  id: string;
  id_cobranca: string;
  id_empresa: string;
  empresa: string;
  cnpj: string | null;
  email_cobranca: string | null;
  contato: string | null;
  vencimento: string;
  valor: number;
  link_cobranca: string | null;
  link_central: string;
  status_pagamento: string;
  comprovante: boolean;
  data_baixa: string | null;
  proximo_passo: string | null;
  persistida: boolean;
  envios: Envio[];
};
type Unidade = { id_empresa: string; empresa: string; cnpj: string | null; faturas: Fatura[] };
type Grupo = {
  id: string;
  empresa: string;
  cnpj: string | null;
  total_devido: number;
  pendencias: number;
  status: string;
  proxima_acao: string | null;
  unidades: Unidade[];
};
type Candidato = { nome: string | null; cargo: string | null; inicio: string | null; contrato: string | null; situacao: string; referencia: string };
type Acao = { empresa: string; label: string; tipo: string; etapa: string; vencimento: string; valor: number; email: string | null; faturas?: Array<{ empresa: string; valor: number; vencimento: string }> };

const statusPagamento: Record<string, string> = { em_aberto: "Em aberto", pago: "Pago", encaminhado: "Encaminhado", suspenso: "Suspenso" };
const statusEnvio: Record<string, string> = { a_enviar: "A enviar", prevista: "Prevista", enviado: "Enviado", resolvido: "Resolvido", escalar: "Escalar", encaminhado: "Encaminhado", marco: "—", suspenso: "Suspenso", falha: "Falha", enviando: "Enviando" };

function competenciaAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function dataBr(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

function badgeStatus(status: string) {
  if (status === "pago") return "ativa";
  if (status === "suspenso" || status === "encaminhado") return "enviado";
  return "aberta";
}

/** Cor do selo de cada etapa: feita em verde, a fazer em ciano, prevista em cinza, problema em rosa, à parte em âmbar. */
const tomEnvio: Record<string, string> = {
  enviado: "ativa", resolvido: "ativa", a_enviar: "aberta", enviando: "aberta", prevista: "encerrada",
  escalar: "recusado", falha: "recusado", encaminhado: "pausada", suspenso: "pausada",
};

const FILTROS = [
  { id: "", rotulo: "Todos" },
  { id: "em_aberto", rotulo: "Em aberto" },
  { id: "suspenso", rotulo: "Comprovante a validar" },
  { id: "encaminhado", rotulo: "Encaminhados" },
  { id: "pago", rotulo: "Pagos" },
];

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ReguaCobrancaPage() {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [aberta, setAberta] = useState<string | null>(null);
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [busca, setBusca] = useState("");
  const client = useQueryClient();
  const lista = useQuery({
    queryKey: ["regua", competencia],
    queryFn: () => api<Grupo[]>(`/api/v1/asaas/regua?competencia=${competencia}`),
  });
  const relatorio = useQuery({
    queryKey: ["regua-relatorio", aberta, competencia],
    queryFn: () => api<Candidato[]>(`/api/v1/asaas/regua/${aberta}/relatorio?competencia=${competencia}`),
    enabled: Boolean(aberta),
  });
  const simulacao = useMutation({
    mutationFn: () => api<{ data: string; simular: boolean; acoes: Acao[] }>("/api/v1/asaas/regua/simular", { method: "POST", body: JSON.stringify({ competencia }) }),
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível simular a régua."),
  });
  const atualizar = async () => {
    setErro("");
    await client.invalidateQueries({ queryKey: ["regua", competencia] });
  };
  const envio = useMutation({
    mutationFn: (input: { id: string; status: "enviado" | "escalar" | "encaminhado" }) => api(`/api/v1/asaas/regua/envios/${input.id}`, { method: "POST", body: JSON.stringify({ status: input.status }) }),
    onSuccess: atualizar,
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível registrar o envio."),
  });
  const relatorioEmail = useMutation({
    mutationFn: (id: string) => api(`/api/v1/asaas/regua/${id}/relatorio/email`, { method: "POST", body: JSON.stringify({ competencia }) }),
    onSuccess: atualizar,
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível enviar o relatório."),
  });
  const comprovante = useMutation({
    mutationFn: (id: string) => api(`/api/v1/asaas/regua/${id}/comprovante`, { method: "POST", body: JSON.stringify({ data: new Date().toISOString().slice(0, 10) }) }),
    onSuccess: atualizar,
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível registrar o comprovante."),
  });
  const validar = useMutation({
    mutationFn: (id: string) => api(`/api/v1/asaas/regua/${id}/comprovante/validar`, { method: "POST" }),
    onSuccess: atualizar,
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível validar o comprovante."),
  });
  const grupos = lista.data?.data ?? [];
  const pendencias = grupos.reduce((total, grupo) => total + grupo.pendencias, 0);
  const totalDevido = grupos.reduce((total, grupo) => total + (Number(grupo.total_devido) || 0), 0);
  const pagos = grupos.filter((grupo) => grupo.status === "pago").length;
  const visiveis = useMemo(() => {
    const termo = semAcento(busca.trim());
    return grupos.filter((grupo) => (!filtro || grupo.status === filtro)
      && (!termo || semAcento(`${grupo.empresa} ${grupo.cnpj ?? ""} ${grupo.unidades.map((unidade) => unidade.empresa).join(" ")}`).includes(termo)));
  }, [grupos, filtro, busca]);
  const contagem = (id: string) => (id ? grupos.filter((grupo) => grupo.status === id).length : grupos.length);
  const ocupado = envio.isPending || relatorioEmail.isPending || comprovante.isPending || validar.isPending;

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Régua de cobrança"
        descricao="Acompanhe as etapas de cobrança de cada fatura do mês e registre o que foi feito à mão."
        acoes={(
          <>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              Competência
              <Input type="month" aria-label="Competência" value={competencia} onChange={(event) => { setCompetencia(event.target.value); setGrupoAberto(null); setAberta(null); simulacao.reset(); }} className="w-44" />
            </label>
            <Button type="button" variant="secondary" disabled={simulacao.isPending} onClick={() => { setErro(""); simulacao.mutate(); }}>
              <FlaskConical size={16} /> {simulacao.isPending ? "Simulando…" : "Simular o dia"}
            </Button>
          </>
        )}
      />

      <details className="group rounded-xl border border-slate-200 bg-white px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
          <Info size={16} className="text-cyan-700" /> Como a régua funciona
          <ChevronDown size={15} className="ml-auto transition group-open:rotate-180" />
        </summary>
        <ul className="mt-3 grid gap-1.5 border-t border-slate-200 pt-3 text-sm text-slate-600 md:grid-cols-2">
          <li>As filiais ficam dentro do grupo da matriz.</li>
          <li>O vencimento é o da cobrança no Asaas.</li>
          <li>Pagamento confirmado encerra a régua da fatura.</li>
          <li>Comprovante registrado suspende a régua até alguém validar.</li>
          <li>"Simular o dia" mostra o que seria enviado hoje, sem enviar e-mail nem gravar etapa.</li>
          <li>Os botões das etapas aparecem quando a fatura já entrou na régua automática.</li>
        </ul>
      </details>

      {grupos.length ? (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Resumo rotulo="Total devido no mês" valor={money(totalDevido)} destaque />
          <Resumo rotulo="Grupos com cobrança" valor={grupos.length.toLocaleString("pt-BR")} />
          <Resumo rotulo="Pendências em aberto" valor={pendencias.toLocaleString("pt-BR")} />
          <Resumo rotulo="Grupos pagos" valor={`${pagos.toLocaleString("pt-BR")} de ${grupos.length.toLocaleString("pt-BR")}`} />
        </dl>
      ) : null}

      {erro ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{erro}</p> : null}

      {simulacao.data ? (
        <Card className="grid gap-3 border-cyan-500/30">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900"><FlaskConical size={16} className="text-cyan-700" /> Simulação de {dataBr(simulacao.data.data.data)}</h2>
              <p className="text-sm text-slate-500">Nenhum e-mail foi enviado e nada foi gravado.</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => simulacao.reset()}>Fechar</Button>
          </div>
          {simulacao.data.data.acoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma etapa seria disparada nesta data.</p> : (
            <div className="overflow-x-auto">
              <table className="data-table compact">
                <thead><tr><th>Etapa</th><th>Para</th><th>Empresas</th><th className="text-right">Valor</th></tr></thead>
                <tbody>
                  {simulacao.data.data.acoes.map((acao) => (
                    <tr key={`${acao.email}-${acao.etapa}-${acao.empresa}`}>
                      <td className="whitespace-nowrap font-semibold">{acao.label} <span className="font-normal text-slate-500">({acao.tipo})</span></td>
                      <td className="text-slate-600">{acao.email || <span className="text-rose-700">sem e-mail</span>}</td>
                      <td className="text-slate-600">{(acao.faturas ?? [{ empresa: acao.empresa, valor: acao.valor, vencimento: acao.vencimento }]).map((fatura) => fatura.empresa).join(", ")}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{money(acao.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {grupos.length ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por situação">
            {FILTROS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filtro === item.id} onClick={() => setFiltro(item.id)}
                className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 transition", filtro === item.id ? "bg-cyan-700 text-white ring-cyan-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                {item.rotulo} <span className={cn("tabular-nums", filtro === item.id ? "" : "text-slate-400")}>{contagem(item.id)}</span>
              </button>
            ))}
          </div>
          <CampoFiltro rotulo="Buscar empresa" className="w-full sm:w-72">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Nome, filial ou CNPJ" className="pl-9" />
            </div>
          </CampoFiltro>
        </div>
      ) : null}

      {lista.isLoading ? <Skeleton className="h-64" /> : null}
      {lista.isError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar a régua."}</p> : null}
      {!lista.isLoading && !lista.isError && grupos.length === 0 ? <Empty title="Nenhuma cobrança nesta competência" text="Gere as cobranças em Contas a receber; elas aparecem aqui com as etapas da régua." /> : null}
      {grupos.length && !visiveis.length ? <Empty title="Nenhum grupo com esse filtro" text="Troque a situação ou limpe a busca para ver todos os grupos." /> : null}

      <div className="grid gap-3">
        {visiveis.map((grupo) => {
          const aberto = grupoAberto === grupo.id;
          return (
            <section key={grupo.id} className={cn("overflow-hidden rounded-xl border bg-white", aberto ? "border-cyan-500/40" : "border-slate-200")}>
              <button type="button" aria-expanded={aberto} onClick={() => setGrupoAberto(aberto ? null : grupo.id)}
                className="grid w-full gap-3 px-4 py-4 text-left hover:bg-slate-50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold text-navy-900">{grupo.empresa}</p>
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Building2 size={12} /> {grupo.unidades.length} {grupo.unidades.length === 1 ? "unidade" : "unidades"}{grupo.cnpj ? `, ${grupo.cnpj}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Total devido</p>
                  <p className="font-bold tabular-nums text-navy-900">{money(grupo.total_devido)}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">Próxima ação</p>
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-700"><CalendarClock size={14} className="shrink-0 text-slate-400" /> {grupo.proxima_acao ?? "Régua encerrada"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge value={badgeStatus(grupo.status)}>{statusPagamento[grupo.status] ?? grupo.status}</Badge>
                  {grupo.pendencias ? <span className="text-xs font-semibold text-amber-800">{grupo.pendencias} {grupo.pendencias === 1 ? "pendência" : "pendências"}</span> : null}
                </div>
                <span className="flex items-center gap-1 text-sm font-semibold text-cyan-700">
                  {aberto ? "Fechar" : "Ver faturas"} <ChevronDown size={16} className={cn("transition", aberto ? "rotate-180" : "")} />
                </span>
              </button>
              {aberto ? (
                <div className="grid gap-4 border-t border-slate-200 bg-slate-50 p-4">
                  {grupo.unidades.map((unidade) => (
                    <div key={unidade.id_empresa} className="grid gap-3">
                      {grupo.unidades.length > 1 || unidade.empresa !== grupo.empresa ? (
                        <p className="text-sm font-bold text-navy-900">{unidade.empresa}{unidade.cnpj ? <span className="ml-2 font-normal text-slate-500">{unidade.cnpj}</span> : null}</p>
                      ) : null}
                      {unidade.faturas.map((fatura) => (
                        <FaturaRegua
                          key={fatura.id_cobranca}
                          fatura={fatura}
                          ocupado={ocupado}
                          relatorioAberto={aberta === fatura.id}
                          onRelatorio={() => setAberta(aberta === fatura.id ? null : fatura.id)}
                          onComprovante={() => comprovante.mutate(fatura.id)}
                          onValidar={() => validar.mutate(fatura.id)}
                          onEnviarRelatorio={() => relatorioEmail.mutate(fatura.id)}
                          onEnvio={(id, status) => envio.mutate({ id, status })}
                        >
                          {aberta === fatura.id ? (
                            <div className="grid gap-2 border-t border-slate-200 pt-3">
                              <p className="flex items-center gap-1.5 text-sm font-semibold text-navy-900"><Users size={15} /> Candidatos da fatura</p>
                              {relatorio.isLoading ? <p className="text-sm text-slate-500">Carregando candidatos…</p> : (relatorio.data?.data.length ?? 0) === 0 ? (
                                <p className="text-sm text-slate-500">Nenhum candidato ativo ou desligado neste mês.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="data-table compact">
                                    <thead><tr><th>Candidato</th><th>Cargo</th><th>Início</th><th>Contrato</th><th>Situação</th><th>Referência</th></tr></thead>
                                    <tbody>
                                      {(relatorio.data?.data ?? []).map((linha, index) => (
                                        <tr key={`${linha.nome}-${index}`}>
                                          <td className="font-medium">{linha.nome}</td>
                                          <td>{linha.cargo}</td>
                                          <td className="whitespace-nowrap">{linha.inicio}</td>
                                          <td>{linha.contrato}</td>
                                          <td>{linha.situacao}</td>
                                          <td>{linha.referencia}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ) : null}
                        </FaturaRegua>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold text-slate-500">{rotulo}</dt>
      <dd className={cn("mt-0.5 font-extrabold tabular-nums text-navy-900", destaque ? "text-xl" : "text-lg")}>{valor}</dd>
    </div>
  );
}

/** Uma fatura: dados principais, ações e as etapas da régua (a próxima em destaque). */
function FaturaRegua({ fatura, ocupado, relatorioAberto, onRelatorio, onComprovante, onValidar, onEnviarRelatorio, onEnvio, children }: {
  fatura: Fatura;
  ocupado: boolean;
  relatorioAberto: boolean;
  onRelatorio: () => void;
  onComprovante: () => void;
  onValidar: () => void;
  onEnviarRelatorio: () => void;
  onEnvio: (id: string, status: "enviado" | "escalar" | "encaminhado") => void;
  children?: React.ReactNode;
}) {
  const proxima = fatura.envios.find((item) => item.label === fatura.proximo_passo)?.etapa;
  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Dado rotulo="Valor"><span className="font-bold tabular-nums">{money(fatura.valor)}</span></Dado>
          <Dado rotulo="Vencimento"><span className="tabular-nums">{dataBr(fatura.vencimento)}</span></Dado>
          <Dado rotulo="Situação"><Badge value={badgeStatus(fatura.status_pagamento)}>{statusPagamento[fatura.status_pagamento] ?? fatura.status_pagamento}</Badge></Dado>
          <Dado rotulo="Próximo passo">{fatura.proximo_passo ?? "Régua encerrada"}</Dado>
          <Dado rotulo="Comprovante">{fatura.comprovante ? `Recebido${fatura.data_baixa ? `, baixa em ${dataBr(fatura.data_baixa)}` : ""}` : "Não recebido"}</Dado>
        </dl>
        <div className="flex flex-wrap gap-2">
          {fatura.link_cobranca ? <a className="acao acao-cyan inline-flex items-center gap-1" href={fatura.link_cobranca} target="_blank" rel="noreferrer">Link da cobrança <ExternalLink size={12} /></a> : <span className="text-xs text-slate-400">Cobrança sem link</span>}
          <a className="acao acao-cyan inline-flex items-center gap-1" href={fatura.link_central} target="_blank" rel="noreferrer">Central da empresa <ExternalLink size={12} /></a>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {fatura.persistida && fatura.status_pagamento !== "pago" && fatura.status_pagamento !== "suspenso" ? <Button type="button" variant="secondary" disabled={ocupado} onClick={onComprovante}><FileCheck2 size={15} /> Registrar comprovante</Button> : null}
        {fatura.persistida && fatura.status_pagamento === "suspenso" ? <Button type="button" disabled={ocupado} onClick={onValidar}><FileCheck2 size={15} /> Validar comprovante</Button> : null}
        <Button type="button" variant="ghost" onClick={onRelatorio}><Users size={15} /> {relatorioAberto ? "Ocultar candidatos" : "Ver candidatos da fatura"}</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table compact min-w-[680px]">
          <thead><tr><th>Etapa</th><th>Data</th><th>Situação</th><th>Registro</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>
            {fatura.envios.map((item) => {
              const acoes = fatura.persistida && (item.etapa === "relatorio" || (!item.marco && item.status === "a_enviar")) && fatura.status_pagamento === "em_aberto";
              const destaque = item.etapa === proxima;
              return (
                <tr key={`${fatura.id_cobranca}-${item.etapa}`} className={destaque ? "bg-cyan-50" : undefined}>
                  <td className="whitespace-nowrap font-semibold">
                    {item.label}
                    {destaque ? <span className="ml-2 rounded bg-cyan-700 px-1.5 py-0.5 text-[11px] font-bold text-white">Próxima</span> : null}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{dataBr(item.data_prevista)}</td>
                  <td>{item.marco ? <span className="text-slate-400">—</span> : <Badge value={tomEnvio[item.status]}>{statusEnvio[item.status] ?? item.status}</Badge>}</td>
                  <td className="text-xs text-slate-500">{item.enviado_em ? `${dataHoraBr(item.enviado_em)}${item.responsavel ? `, ${item.responsavel}` : ""}` : "—"}</td>
                  <td className="w-px whitespace-nowrap text-right">
                    {acoes ? (
                      <div className="flex justify-end gap-2">
                        {item.etapa === "relatorio" ? (
                          <button type="button" className="acao acao-cyan" disabled={ocupado} onClick={onEnviarRelatorio}>Enviar relatório</button>
                        ) : (
                          <button type="button" className="acao acao-cyan" disabled={ocupado} onClick={() => onEnvio(item.id, "enviado")}>Registrar envio</button>
                        )}
                        {item.pendentes && item.etapa !== "encaminhar" ? <button type="button" className="acao acao-rose" disabled={ocupado} onClick={() => onEnvio(item.id, "escalar")}>Escalar</button> : null}
                        {item.etapa === "encaminhar" ? <button type="button" className="acao acao-rose" disabled={ocupado} onClick={() => onEnvio(item.id, "encaminhado")}>Encaminhar</button> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}
