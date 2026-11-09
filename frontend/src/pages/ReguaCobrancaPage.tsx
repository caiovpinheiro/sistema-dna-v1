import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { money } from "@/lib/format";

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

export function ReguaCobrancaPage() {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [aberta, setAberta] = useState<string | null>(null);
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [erro, setErro] = useState("");
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

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Régua de cobrança</h1>
        <p className="text-sm text-slate-500">As filiais ficam dentro da matriz. O vencimento é o da cobrança no Asaas. Pagamento confirmado encerra a régua. Comprovante suspende até alguém validar. A simulação não envia e-mail nem grava etapa.</p>
      </div>
      <Card className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-medium">Competência
          <input className="h-11 rounded-xl border border-slate-200 px-3" type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} />
        </label>
        <p className="pb-3 text-sm text-slate-500">{pendencias} em aberto em {grupos.length} grupo(s)</p>
        <Button type="button" variant="secondary" disabled={simulacao.isPending} onClick={() => { setErro(""); simulacao.mutate(); }}>Simular o dia</Button>
      </Card>
      {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
      {simulacao.data ? (
        <Card className="grid gap-2">
          <h2 className="font-bold">Simulação de {dataBr(simulacao.data.data.data)} — nenhum e-mail foi enviado</h2>
          {simulacao.data.data.acoes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma etapa seria disparada nesta data.</p> : null}
          <ul className="grid gap-1 text-sm">
            {simulacao.data.data.acoes.map((acao) => (
              <li key={`${acao.email}-${acao.etapa}-${acao.empresa}`}>{acao.email || "sem e-mail"}: {acao.label} ({acao.tipo}) · {money(acao.valor)} · {(acao.faturas ?? [{ empresa: acao.empresa, valor: acao.valor, vencimento: acao.vencimento }]).map((fatura) => fatura.empresa).join(", ")}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {lista.isLoading ? <p className="text-sm text-slate-500">Carregando faturas…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-600">{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar a régua."}</p> : null}
      {!lista.isLoading && grupos.length === 0 ? <p className="text-sm text-slate-500">Nenhuma cobrança registrada nesta competência. Gere a cobrança em Contas a receber antes.</p> : null}
      {grupos.map((grupo) => (
        <Card key={grupo.id} className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">{grupo.empresa}</h2>
              <p className="text-sm text-slate-500">{grupo.cnpj || "sem CNPJ"} · {grupo.unidades.length} unidade(s) · {grupo.pendencias} pendência(s)</p>
            </div>
            <Badge value={badgeStatus(grupo.status)}>{statusPagamento[grupo.status] ?? grupo.status}</Badge>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Total devido <strong>{money(grupo.total_devido)}</strong></span>
            <span>Próxima ação <strong>{grupo.proxima_acao ?? "Régua encerrada"}</strong></span>
          </div>
          <Button type="button" variant="ghost" onClick={() => setGrupoAberto(grupoAberto === grupo.id ? null : grupo.id)}>{grupoAberto === grupo.id ? "Ocultar unidades" : "Ver unidades e faturas"}</Button>
          {grupoAberto === grupo.id ? grupo.unidades.map((unidade) => (
            <div key={unidade.id_empresa} className="grid gap-3 border-t border-slate-100 pt-3">
              <h3 className="font-bold">{unidade.empresa}</h3>
              <p className="text-sm text-slate-500">{unidade.cnpj}</p>
              {unidade.faturas.map((fatura) => (
                <div key={fatura.id_cobranca} className="grid gap-3">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>Valor <strong>{money(fatura.valor)}</strong></span>
                    <span>Vencimento <strong>{dataBr(fatura.vencimento)}</strong></span>
                    <span>Status <strong>{statusPagamento[fatura.status_pagamento] ?? fatura.status_pagamento}</strong></span>
                    <span>Próximo passo <strong>{fatura.proximo_passo ?? "Régua encerrada"}</strong></span>
                    <span>Comprovante <strong>{fatura.comprovante ? `sim${fatura.data_baixa ? `, baixa ${dataBr(fatura.data_baixa)}` : ""}` : "não"}</strong></span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {fatura.link_cobranca ? <a className="acao acao-cyan" href={fatura.link_cobranca} target="_blank" rel="noreferrer">Link da cobrança</a> : <span className="text-sm text-slate-400">Cobrança sem link</span>}
                    <a className="acao acao-cyan" href={fatura.link_central} target="_blank" rel="noreferrer">Central da empresa</a>
                    {fatura.persistida && fatura.status_pagamento !== "pago" && fatura.status_pagamento !== "suspenso" ? <Button type="button" variant="secondary" onClick={() => comprovante.mutate(fatura.id)}>Registrar comprovante</Button> : null}
                    {fatura.persistida && fatura.status_pagamento === "suspenso" ? <Button type="button" variant="secondary" onClick={() => validar.mutate(fatura.id)}>Validar comprovante</Button> : null}
                    <Button type="button" variant="ghost" onClick={() => setAberta(aberta === fatura.id ? null : fatura.id)}>{aberta === fatura.id ? "Ocultar relatório" : "Relatório de candidatos"}</Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="text-xs uppercase text-slate-400">
                        <tr><th className="py-2">Ação</th><th>Data</th><th>Status</th><th>Registro</th><th></th></tr>
                      </thead>
                      <tbody>
                        {fatura.envios.map((item) => (
                          <tr key={`${fatura.id_cobranca}-${item.etapa}`} className="border-t border-slate-100">
                            <td className="py-2 font-semibold">{item.label}</td>
                            <td>{dataBr(item.data_prevista)}</td>
                            <td>{statusEnvio[item.status] ?? item.status}</td>
                            <td className="text-slate-500">{item.enviado_em ? `${new Date(item.enviado_em).toLocaleString("pt-BR")} · ${item.responsavel ?? ""}` : "—"}</td>
                            <td className="py-2">
                              {fatura.persistida && (item.etapa === "relatorio" || (!item.marco && item.status === "a_enviar")) && fatura.status_pagamento === "em_aberto" ? (
                                <div className="flex flex-wrap gap-2">
                                  {item.etapa === "relatorio" ? (
                                    <button type="button" className="acao acao-cyan" disabled={relatorioEmail.isPending} onClick={() => relatorioEmail.mutate(fatura.id)}>Enviar relatório</button>
                                  ) : (
                                    <button type="button" className="acao acao-cyan" onClick={() => envio.mutate({ id: item.id, status: "enviado" })}>Registrar envio</button>
                                  )}
                                  {item.pendentes && item.etapa !== "encaminhar" ? <button type="button" className="acao acao-rose" onClick={() => envio.mutate({ id: item.id, status: "escalar" })}>Escalar</button> : null}
                                  {item.etapa === "encaminhar" ? <button type="button" className="acao acao-rose" onClick={() => envio.mutate({ id: item.id, status: "encaminhado" })}>Encaminhar</button> : null}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {aberta === fatura.id ? (
                    <div className="overflow-x-auto">
                      {relatorio.isLoading ? <p className="text-sm text-slate-500">Carregando candidatos…</p> : null}
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead className="text-xs uppercase text-slate-400">
                          <tr><th className="py-2">Candidato</th><th>Cargo</th><th>Início</th><th>Contrato</th><th>Situação</th><th>Referência</th></tr>
                        </thead>
                        <tbody>
                          {(relatorio.data?.data ?? []).map((linha, index) => (
                            <tr key={`${linha.nome}-${index}`} className="border-t border-slate-100">
                              <td className="py-2">{linha.nome}</td>
                              <td>{linha.cargo}</td>
                              <td>{linha.inicio}</td>
                              <td>{linha.contrato}</td>
                              <td>{linha.situacao}</td>
                              <td>{linha.referencia}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!relatorio.isLoading && (relatorio.data?.data.length ?? 0) === 0 ? <p className="text-sm text-slate-500">Nenhum candidato ativo ou desligado neste mês.</p> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )) : null}
        </Card>
      ))}
    </div>
  );
}
