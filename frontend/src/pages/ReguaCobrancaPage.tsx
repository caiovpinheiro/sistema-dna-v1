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
  envios: Envio[];
};
type Candidato = { nome: string | null; cargo: string | null; inicio: string | null; contrato: string | null; situacao: string; referencia: string };

const statusPagamento: Record<string, string> = { em_aberto: "Em aberto", pago: "Pago", encaminhado: "Encaminhado" };
const statusEnvio: Record<string, string> = { a_enviar: "A enviar", enviado: "Enviado", resolvido: "Resolvido", escalar: "Escalar", encaminhado: "Encaminhado", marco: "—" };

function competenciaAtual() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function dataBr(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

export function ReguaCobrancaPage() {
  const [competencia, setCompetencia] = useState(competenciaAtual);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const client = useQueryClient();
  const lista = useQuery({
    queryKey: ["regua", competencia],
    queryFn: () => api<Fatura[]>(`/api/v1/asaas/regua?competencia=${competencia}`),
  });
  const relatorio = useQuery({
    queryKey: ["regua-relatorio", aberta, competencia],
    queryFn: () => api<Candidato[]>(`/api/v1/asaas/regua/${aberta}/relatorio?competencia=${competencia}`),
    enabled: Boolean(aberta),
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
  const faturas = lista.data?.data ?? [];
  const abertas = faturas.filter((fatura) => fatura.status_pagamento !== "pago");

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Régua de cobrança</h1>
        <p className="text-sm text-slate-500">Vencimento no dia 10. O envio que cai em fim de semana ou feriado nacional vai para o próximo dia útil. A régua para quando o pagamento ou o comprovante é registrado.</p>
      </div>
      <Card className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-medium">Competência
          <input className="h-11 rounded-xl border border-slate-200 px-3" type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} />
        </label>
        <p className="pb-3 text-sm text-slate-500">{abertas.length} em aberto de {faturas.length}</p>
      </Card>
      {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
      {lista.isLoading ? <p className="text-sm text-slate-500">Carregando faturas…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-600">{lista.error instanceof ApiError ? lista.error.message : "Não foi possível carregar a régua."}</p> : null}
      {!lista.isLoading && faturas.length === 0 ? <p className="text-sm text-slate-500">Nenhuma cobrança registrada nesta competência. Gere a cobrança em Contas a receber antes.</p> : null}
      {faturas.map((fatura) => (
        <Card key={fatura.id} className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">{fatura.empresa}</h2>
              <p className="text-sm text-slate-500">{fatura.cnpj} · {fatura.email_cobranca || "sem e-mail de cobrança"} · {fatura.contato || "sem contato"}</p>
            </div>
            <Badge value={fatura.status_pagamento === "pago" ? "ativa" : fatura.status_pagamento === "encaminhado" ? "enviado" : "aberta"}>{statusPagamento[fatura.status_pagamento] ?? fatura.status_pagamento}</Badge>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Valor <strong>{money(fatura.valor)}</strong></span>
            <span>Vencimento <strong>{dataBr(fatura.vencimento)}</strong></span>
            <span>Próximo passo <strong>{fatura.proximo_passo ?? "Régua encerrada"}</strong></span>
            <span>Comprovante <strong>{fatura.comprovante ? `sim${fatura.data_baixa ? `, baixa ${dataBr(fatura.data_baixa)}` : ""}` : "não"}</strong></span>
          </div>
          <div className="flex flex-wrap gap-2">
            {fatura.link_cobranca ? <a className="acao acao-cyan" href={fatura.link_cobranca} target="_blank" rel="noreferrer">Link da cobrança</a> : <span className="text-sm text-slate-400">Cobrança sem link</span>}
            <a className="acao acao-cyan" href={fatura.link_central} target="_blank" rel="noreferrer">Central da empresa</a>
            {fatura.status_pagamento !== "pago" ? <Button type="button" variant="secondary" onClick={() => comprovante.mutate(fatura.id)}>Registrar comprovante</Button> : null}
            <Button type="button" variant="ghost" onClick={() => setAberta(aberta === fatura.id ? null : fatura.id)}>{aberta === fatura.id ? "Ocultar relatório" : "Relatório de candidatos"}</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr><th className="py-2">Ação</th><th>Data</th><th>Status</th><th>Registro</th><th></th></tr>
              </thead>
              <tbody>
                {fatura.envios.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-2 font-semibold">{item.label}</td>
                    <td>{dataBr(item.data_prevista)}</td>
                    <td>{statusEnvio[item.status] ?? item.status}</td>
                    <td className="text-slate-500">{item.enviado_em ? `${new Date(item.enviado_em).toLocaleString("pt-BR")} · ${item.responsavel ?? ""}` : "—"}</td>
                    <td className="py-2">
                      {(item.etapa === "relatorio" || (!item.marco && item.status === "a_enviar")) && fatura.status_pagamento !== "pago" ? (
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
        </Card>
      ))}
    </div>
  );
}
