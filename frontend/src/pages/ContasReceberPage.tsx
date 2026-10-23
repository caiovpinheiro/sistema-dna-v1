import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { money } from "@/lib/format";

type Nota = { id: string; tipo: string; valor: number; status: string; pdf_url: string | null };
type Cobranca = {
  id: string;
  id_empresa: string;
  empresa_razao: string | null;
  empresa_fantasia: string | null;
  empresa_cnpj: string | null;
  descricao: string;
  valor: number;
  vencimento: string;
  forma: string;
  situacao: string;
  url_pagamento: string | null;
  data_pagamento: string | null;
  notas: Nota[];
};
type Empresa = { id_empresa: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null };

const situacaoLabel: Record<string, string> = { aberta: "Aberta", paga: "Paga", cancelada: "Cancelada" };

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthEnd() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}

export function ContasReceberPage() {
  const client = useQueryClient();
  const [de, setDe] = useState(monthStart());
  const [ate, setAte] = useState(monthEnd());
  const [situacao, setSituacao] = useState("");
  const [busca, setBusca] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(monthEnd());
  const [descricao, setDescricao] = useState("");
  const [forma, setForma] = useState("UNDEFINED");
  const [erro, setErro] = useState("");
  const [pagamento, setPagamento] = useState<{ id: string; data: string } | null>(null);
  const [nota, setNota] = useState<{ id: string; valor: string; codigo: string; iss: string; descricao: string } | null>(null);

  const query = useQuery({
    queryKey: ["cobrancas", de, ate, situacao],
    queryFn: () => api<Cobranca[]>(`/api/v1/asaas/cobrancas?de=${de}&ate=${ate}${situacao ? `&situacao=${situacao}` : ""}`),
  });
  const empresas = useQuery({
    queryKey: ["empresas-asaas", busca],
    queryFn: () => api<Empresa[]>(`/api/v1/empresas?q=${encodeURIComponent(busca)}&pageSize=8`),
    enabled: busca.trim().length >= 2,
  });
  const rows = query.data?.data ?? [];
  const total = rows.filter((row) => row.situacao === "aberta").reduce((sum, row) => sum + Number(row.valor), 0);

  function falha(error: unknown) {
    setErro(error instanceof ApiError ? error.message : "Não foi possível concluir a operação.");
  }
  async function atualizar() {
    await client.invalidateQueries({ queryKey: ["cobrancas"] });
  }
  const criar = useMutation({
    mutationFn: () => api("/api/v1/asaas/cobrancas", {
      method: "POST",
      body: JSON.stringify({ id_empresa: empresaId, valor: Number(valor.replace(",", ".")), vencimento, descricao, forma }),
    }),
    onSuccess: async () => { setErro(""); setValor(""); setDescricao(""); await atualizar(); },
    onError: falha,
  });
  const sincronizar = useMutation({ mutationFn: (id: string) => api(`/api/v1/asaas/cobrancas/${id}/sincronizar`, { method: "POST" }), onSuccess: atualizar, onError: falha });
  const receber = useMutation({
    mutationFn: () => api(`/api/v1/asaas/cobrancas/${pagamento?.id}/receber`, { method: "POST", body: JSON.stringify({ data: pagamento?.data }) }),
    onSuccess: async () => { setPagamento(null); await atualizar(); },
    onError: falha,
  });
  const excluir = useMutation({ mutationFn: (id: string) => api(`/api/v1/asaas/cobrancas/${id}`, { method: "DELETE" }), onSuccess: atualizar, onError: falha });
  const emitir = useMutation({
    mutationFn: () => api(`/api/v1/asaas/cobrancas/${nota?.id}/nota`, {
      method: "POST",
      body: JSON.stringify({
        tipo: "Servico",
        valor: Number(nota?.valor.replace(",", ".")),
        codigo_servico: nota?.codigo,
        iss: Number(nota?.iss.replace(",", ".")),
        descricao: nota?.descricao,
      }),
    }),
    onSuccess: async () => { setNota(null); await atualizar(); },
    onError: falha,
  });

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Contas a receber</h1>
        <p className="text-sm text-slate-500">Cobranças enviadas ao Asaas. O cliente da empresa é criado ou atualizado na hora de faturar.</p>
      </div>
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      <Card className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className="relative md:col-span-2">
          <Field label="Empresa">
            <Input value={busca} placeholder="Razão social, fantasia ou CNPJ" onChange={(event) => { setBusca(event.target.value); setEmpresaId(""); }} />
          </Field>
          {empresas.data?.data.length ? (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {empresas.data.data.map((empresa) => (
                <button key={empresa.id_empresa} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setEmpresaId(empresa.id_empresa); setBusca(empresa.nome_fantasia || empresa.razao_social || ""); }}>
                  {empresa.razao_social} · {empresa.cnpj}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <Field label="Valor"><Input inputMode="decimal" value={valor} onChange={(event) => setValor(event.target.value)} /></Field>
        <Field label="Vencimento"><Input type="date" value={vencimento} onChange={(event) => setVencimento(event.target.value)} /></Field>
        <Field label="Forma">
          <Select value={forma} onChange={(event) => setForma(event.target.value)}>
            <option value="UNDEFINED">Cliente escolhe</option>
            <option value="BOLETO">Boleto</option>
            <option value="PIX">Pix</option>
            <option value="CREDIT_CARD">Cartão</option>
          </Select>
        </Field>
        <Field label="Descrição"><Input value={descricao} onChange={(event) => setDescricao(event.target.value)} /></Field>
        <Button type="button" className="self-end" disabled={criar.isPending || !empresaId} onClick={() => criar.mutate()}>{criar.isPending ? "Gerando…" : "Gerar cobrança"}</Button>
      </Card>
      <Card className="grid items-end gap-3 md:grid-cols-4">
        <Field label="De"><Input type="date" value={de} onChange={(event) => setDe(event.target.value)} /></Field>
        <Field label="Até"><Input type="date" value={ate} onChange={(event) => setAte(event.target.value)} /></Field>
        <Field label="Status">
          <Select value={situacao} onChange={(event) => setSituacao(event.target.value)}>
            <option value="">Todas</option>
            <option value="aberta">Aberta</option>
            <option value="paga">Paga</option>
            <option value="cancelada">Cancelada</option>
          </Select>
        </Field>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold">{row.empresa_fantasia || row.empresa_razao}</td>
                <td className="px-4 py-3">{row.descricao}</td>
                <td className="px-4 py-3">{row.vencimento.split("-").reverse().join("/")}</td>
                <td className="px-4 py-3">{money(row.valor)}</td>
                <td className="px-4 py-3"><Badge value={row.situacao === "paga" ? "ativa" : row.situacao === "aberta" ? "aberta" : "encerrada"}>{situacaoLabel[row.situacao] ?? row.situacao}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {row.url_pagamento ? <a className="font-semibold text-cyan-800" href={row.url_pagamento} target="_blank" rel="noreferrer">Link</a> : null}
                    <button type="button" className="font-semibold text-cyan-800" onClick={() => sincronizar.mutate(row.id)}>Verificar</button>
                    {row.situacao === "aberta" ? <button type="button" className="font-semibold text-cyan-800" onClick={() => setPagamento({ id: row.id, data: new Date().toISOString().slice(0, 10) })}>Baixar</button> : null}
                    {row.situacao === "aberta" ? <button type="button" className="font-semibold text-cyan-800" onClick={() => setNota({ id: row.id, valor: String(row.valor), codigo: "", iss: "0", descricao: row.descricao })}>Nota</button> : null}
                    {row.situacao === "aberta" ? <button type="button" className="font-semibold text-rose-700" onClick={() => excluir.mutate(row.id)}>Excluir</button> : null}
                    {row.notas.map((item) => item.pdf_url ? <a key={item.id} className="font-semibold text-cyan-800" href={item.pdf_url} target="_blank" rel="noreferrer">PDF da nota</a> : <span key={item.id}>{item.status}</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-sm text-slate-500">{rows.length === 0 ? "Nenhuma cobrança neste período." : `${rows.length} cobranças`} · em aberto {money(total)}</p>
      {pagamento ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4">
          <Card className="w-full max-w-md">
            <h2 className="text-lg font-bold">Data do recebimento</h2>
            <div className="mt-4"><Field label="Data"><Input type="date" value={pagamento.data} onChange={(event) => setPagamento({ ...pagamento, data: event.target.value })} /></Field></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPagamento(null)}>Cancelar</Button>
              <Button type="button" disabled={receber.isPending} onClick={() => receber.mutate()}>Confirmar</Button>
            </div>
          </Card>
        </div>
      ) : null}
      {nota ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4">
          <Card className="grid w-full max-w-lg gap-3">
            <h2 className="text-lg font-bold">Emitir nota fiscal</h2>
            <Field label="Código do serviço municipal"><Input value={nota.codigo} onChange={(event) => setNota({ ...nota, codigo: event.target.value })} /></Field>
            <Field label="ISS (%)"><Input value={nota.iss} onChange={(event) => setNota({ ...nota, iss: event.target.value })} /></Field>
            <Field label="Valor"><Input value={nota.valor} onChange={(event) => setNota({ ...nota, valor: event.target.value })} /></Field>
            <Field label="Descrição"><Input value={nota.descricao} onChange={(event) => setNota({ ...nota, descricao: event.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setNota(null)}>Cancelar</Button>
              <Button type="button" disabled={emitir.isPending || !nota.codigo} onClick={() => emitir.mutate()}>Emitir</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
