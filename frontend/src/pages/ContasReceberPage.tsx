import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FileText, ListChecks, Plus, Search, Send } from "lucide-react";
import { useState } from "react";
import { Alerta, CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { RelatorioEmpresaPainel } from "@/components/relatorio-empresa";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCnpj, money, textoPlano } from "@/lib/format";

type Nota = { id: string; tipo: string; valor: number; status: string; pdf_url: string | null };
type ItemNota = { tipo: string; codigo: string; iss: string; descricao: string; valor: string };
type SugestaoNota = { notas: Array<{ tipo: string; codigo: string; iss: number; descricao: string; valor: number }>; origem: "estagio" | "clt" | "misto" | "padrao" };
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
  envio: string | null;
  notas: Nota[];
};
type Empresa = { id_empresa: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null };

/** Alguns nomes vêm do Lightsail com entidades HTML ("Freire &amp; Pinho"). */
function semEntidades(texto: string) {
  return texto.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

/** "1.500,00", "1500,5" ou "1500.50" viram número. */
function valorEmNumero(texto: string) {
  const limpo = texto.replace(/[^\d.,]/g, "");
  return Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
}

const situacaoLabel: Record<string, string> = { aberta: "A pagar", paga: "Paga", cancelada: "Cancelada" };

function dataEnvio(valor: string) {
  const partes = valor.slice(0, 10).split(/[-/]/);
  return partes[0]?.length === 4 && partes[2] ? `${partes[2]}/${partes[1]}/${partes[0]}` : valor;
}

function competencia(descricao: string) {
  const encontrado = descricao.match(/^Faturamento\s+(\d{1,2})\/(\d{4})$/);
  if (!encontrado?.[1] || !encontrado[2]) return null;
  return { mes: String(Number(encontrado[1])), ano: encontrado[2] };
}

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
  const [aviso, setAviso] = useState("");
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [pagamento, setPagamento] = useState<{ id: string; data: string } | null>(null);
  const [nota, setNota] = useState<{ id: string; origem: SugestaoNota["origem"] | "carregando"; itens: ItemNota[] } | null>(null);
  const [relatorio, setRelatorio] = useState<{ empresaId: string; mes: string; ano: string } | null>(null);

  const query = useQuery({
    queryKey: ["cobrancas", de, ate, situacao],
    queryFn: () => api<Cobranca[]>(`/api/v1/asaas/cobrancas?de=${de}&ate=${ate}${situacao ? `&situacao=${situacao}` : ""}`),
  });
  const empresas = useQuery({
    queryKey: ["empresas-asaas", busca],
    queryFn: () => api<Empresa[]>(`/api/v1/empresas?q=${encodeURIComponent(busca)}&pageSize=8`),
    enabled: busca.trim().length >= 2,
  });
  // A busca de empresa também filtra a tabela: escolhida, só ela; digitando, as que batem com o nome ou o CNPJ.
  const termo = semEntidades(busca).trim().toLowerCase();
  const termoCnpj = busca.replace(/\D/g, "");
  const rows = (query.data?.data ?? []).filter((row) => {
    if (empresaId) return row.id_empresa === empresaId;
    if (termo.length < 2) return true;
    const nomes = semEntidades(`${row.empresa_fantasia ?? ""} ${row.empresa_razao ?? ""}`).toLowerCase();
    return nomes.includes(termo) || (termoCnpj.length >= 3 && (row.empresa_cnpj ?? "").replace(/\D/g, "").includes(termoCnpj));
  });
  const pendentes = rows.filter((row) => row.situacao === "aberta" && !row.envio);
  const total = rows.filter((row) => row.situacao === "aberta").reduce((sum, row) => sum + Number(row.valor), 0);

  function falha(error: unknown) {
    setErro(error instanceof ApiError ? error.message : "Não foi possível concluir a operação.");
  }
  async function atualizar() {
    await client.invalidateQueries({ queryKey: ["cobrancas"] });
  }
  const criar = useMutation({
    mutationFn: () => {
      const numero = valorEmNumero(valor);
      if (!(numero > 0)) throw new ApiError(400, "VALOR_INVALIDO", "Informe o valor da cobrança.");
      return api<{ emailEnviado?: boolean }>("/api/v1/asaas/cobrancas", {
        method: "POST",
        body: JSON.stringify({ id_empresa: empresaId, valor: numero, vencimento, descricao, forma }),
      });
    },
    onSuccess: async (resultado) => {
      setValor("");
      setDescricao("");
      setErro(resultado.data.emailEnviado === false ? "Cobrança gerada, mas o e-mail da fatura não foi enviado." : "");
      await atualizar();
    },
    onError: falha,
  });
  const sincronizar = useMutation({ mutationFn: (id: string) => api(`/api/v1/asaas/cobrancas/${id}/sincronizar`, { method: "POST" }), onSuccess: atualizar, onError: falha });
  const receber = useMutation({
    mutationFn: () => api(`/api/v1/asaas/cobrancas/${pagamento?.id}/receber`, { method: "POST", body: JSON.stringify({ data: pagamento?.data }) }),
    onSuccess: async () => { setPagamento(null); await atualizar(); },
    onError: falha,
  });
  const excluir = useMutation({ mutationFn: (id: string) => api(`/api/v1/asaas/cobrancas/${id}`, { method: "DELETE" }), onSuccess: atualizar, onError: falha });
  async function abrirNota(row: Cobranca) {
    setErro("");
    setNota({ id: row.id, origem: "carregando", itens: [] });
    try {
      const resposta = await api<SugestaoNota>(`/api/v1/asaas/cobrancas/${row.id}/nota`);
      setNota({
        id: row.id,
        origem: resposta.data.origem,
        itens: resposta.data.notas.map((item) => ({
          tipo: item.tipo,
          codigo: item.codigo,
          iss: String(item.iss),
          descricao: item.descricao,
          valor: String(item.valor),
        })),
      });
    } catch (error) {
      setNota({
        id: row.id,
        origem: "padrao",
        itens: [{ tipo: "Recorrente", codigo: "03158", iss: "5", descricao: "Administração de estagiários", valor: String(row.valor) }],
      });
      falha(error);
    }
  }
  const baixarNota = useMutation({
    mutationFn: (id: string) => api<{ pdf_url: string }>(`/api/v1/asaas/notas/${id}/pdf`, { method: "POST" }),
    onSuccess: atualizar,
    onError: falha,
  });
  const emitir = useMutation({
    mutationFn: async () => {
      if (!nota) return;
      const restantes = [...nota.itens];
      try {
        while (restantes.length > 0) {
          const item = restantes[0];
          if (!item) break;
          await api(`/api/v1/asaas/cobrancas/${nota.id}/nota`, {
            method: "POST",
            body: JSON.stringify({
              tipo: item.tipo,
              valor: Number(item.valor.replace(",", ".")),
              codigo_servico: item.codigo,
              iss: Number(item.iss.replace(",", ".")),
              descricao: item.descricao,
            }),
          });
          restantes.shift();
        }
      } catch (error) {
        if (restantes.length !== nota.itens.length) {
          setNota({ ...nota, itens: restantes });
          await atualizar();
        }
        throw error;
      }
    },
    onSuccess: async () => { setNota(null); await atualizar(); },
    onError: falha,
  });

  async function enviarPendentes(ids: string[]) {
    const escolhidas = rows.filter((row) => ids.includes(row.id));
    setProgresso({ feito: 0, total: escolhidas.length });
    setAviso("");
    setErro("");
    let enviados = 0;
    let pulados = 0;
    let falhas = 0;
    const motivos = new Set<string>();
    for (const row of escolhidas) {
      const referencia = competencia(row.descricao);
      try {
        if (row.envio) {
          pulados += 1;
        } else if (!referencia) {
          falhas += 1;
          motivos.add("Só o faturamento mensal entra neste envio.");
        } else {
          const resposta = await api<{ enviados: number; pulados?: number; falhas: Array<{ motivo: string }> }>("/api/v1/faturamento/relatorios", {
            method: "POST",
            body: JSON.stringify({ empresas: [row.id_empresa], mes: referencia.mes, ano: referencia.ano }),
          });
          enviados += resposta.data.enviados;
          pulados += resposta.data.pulados ?? 0;
          falhas += resposta.data.falhas.length;
          for (const item of resposta.data.falhas) motivos.add(item.motivo);
        }
      } catch (error) {
        falhas += 1;
        motivos.add(error instanceof Error ? error.message : "Falha ao enviar.");
      }
      setProgresso((atual) => atual ? { feito: atual.feito + 1, total: atual.total } : null);
    }
    setProgresso(null);
    setMarcadas([]);
    const porque = [...motivos].slice(0, 3).join(" ");
    setAviso(enviados > 0
      ? `${enviados} relatório(s) enviado(s) com o boleto já existente.${pulados ? ` ${pulados} já tinham e-mail e foram pulados.` : ""}${falhas ? ` ${falhas} não saíram. ${porque}` : ""}`
      : pulados > 0 && falhas === 0
        ? "Nenhum e-mail novo. Essas cobranças já tinham relatório e o boleto não foi duplicado."
        : `Nenhum e-mail enviado. ${porque || "O boleto existente foi mantido."}`);
    await atualizar();
  }

  const filtrando = de !== monthStart() || ate !== monthEnd() || Boolean(situacao) || Boolean(busca) || Boolean(empresaId);
  function limparFiltros() {
    setDe(monthStart());
    setAte(monthEnd());
    setSituacao("");
    setBusca("");
    setEmpresaId("");
  }

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Contas a receber"
        descricao="Cobranças enviadas ao Asaas: gere uma cobrança avulsa, envie o relatório, dê baixa e emita a nota fiscal."
      />
      {erro ? <Alerta>{erro}</Alerta> : null}

      <Card className="grid gap-4">
        <div>
          <h2 className="text-[15px] font-bold text-navy-900">Nova cobrança</h2>
          <p className="text-sm text-slate-500">Escolha a empresa e preencha os dados. O cliente é criado ou atualizado no Asaas e a fatura sai por e-mail.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-6 xl:grid-cols-12 xl:items-start">
          <div className="relative sm:col-span-6 xl:col-span-4">
            <Field label="Empresa">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input value={busca} placeholder="Razão social, fantasia ou CNPJ" className="pl-9" onChange={(event) => { setBusca(event.target.value); setEmpresaId(""); }} />
              </div>
            </Field>
            {/* Depois de escolher, a lista fecha: aberta, ela cobria o botão "Gerar cobrança". */}
            {!empresaId && empresas.data?.data.length ? (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {empresas.data.data.map((empresa) => (
                  <button key={empresa.id_empresa} type="button" className="block w-full px-3 py-2 text-left text-sm transition duration-150 hover:bg-slate-50" onClick={() => { setEmpresaId(empresa.id_empresa); setBusca(semEntidades(empresa.nome_fantasia || empresa.razao_social || "")); setErro(""); }}>
                    <span className="font-medium text-navy-900">{semEntidades(empresa.nome_fantasia || empresa.razao_social || "")}</span>
                    <span className="block text-xs text-slate-500">{semEntidades(empresa.razao_social || "")} · {formatCnpj(empresa.cnpj)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {empresaId || busca ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                {empresaId ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-800"><Check size={13} /> Empresa selecionada. A lista abaixo mostra só ela.</span> : null}
                <button type="button" className="font-semibold text-cyan-700 hover:underline" onClick={() => { setBusca(""); setEmpresaId(""); }}>Limpar e ver todas</button>
              </p>
            ) : null}
          </div>
          <div className="sm:col-span-2 xl:col-span-2"><Field label="Valor"><Input inputMode="decimal" placeholder="0,00" value={valor} onChange={(event) => setValor(event.target.value)} /></Field></div>
          <div className="sm:col-span-2 xl:col-span-2"><Field label="Vencimento"><Input type="date" value={vencimento} onChange={(event) => setVencimento(event.target.value)} /></Field></div>
          <div className="sm:col-span-2 xl:col-span-2">
            <Field label="Forma de pagamento">
              <Select value={forma} onChange={(event) => setForma(event.target.value)}>
                <option value="UNDEFINED">Cliente escolhe</option>
                <option value="BOLETO">Boleto</option>
                <option value="PIX">Pix</option>
                <option value="CREDIT_CARD">Cartão</option>
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-6 xl:col-span-2"><Field label="Descrição"><Input placeholder="Ex.: Faturamento 11/2026" value={descricao} onChange={(event) => setDescricao(event.target.value)} /></Field></div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
          {!empresaId ? <span className="text-xs text-slate-500">Escolha a empresa na lista para liberar o botão.</span> : null}
          <Button type="button" disabled={criar.isPending || !empresaId} onClick={() => criar.mutate()}><Plus size={16} /> {criar.isPending ? "Gerando…" : "Gerar cobrança"}</Button>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
          <CampoFiltro rotulo="Vencimento de"><Input type="date" aria-label="De" value={de} onChange={(event) => setDe(event.target.value)} /></CampoFiltro>
          <CampoFiltro rotulo="Até"><Input type="date" aria-label="Até" value={ate} onChange={(event) => setAte(event.target.value)} /></CampoFiltro>
          <CampoFiltro rotulo="Situação">
            <Select aria-label="Status" value={situacao} onChange={(event) => setSituacao(event.target.value)}>
              <option value="">Todas</option>
              <option value="aberta">A pagar</option>
              <option value="paga">Paga</option>
              <option value="cancelada">Cancelada</option>
            </Select>
          </CampoFiltro>
        </div>
      </Card>
      <ResumoResultados total={query.isLoading ? null : rows.length} singular="cobrança" plural="cobranças" filtrando={filtrando} carregando={query.isLoading} onLimpar={limparFiltros} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={Boolean(progresso) || pendentes.length === 0} onClick={() => setMarcadas(pendentes.map((row) => row.id))}>
          <ListChecks size={16} /> Selecionar todas a pagar sem envio ({pendentes.length})
        </Button>
        {marcadas.length > 0 ? (
          <>
            <span className="text-sm text-slate-500"><span className="font-bold tabular-nums text-navy-900">{marcadas.length}</span> {marcadas.length === 1 ? "selecionada" : "selecionadas"}</span>
            <Button type="button" disabled={Boolean(progresso)} onClick={() => enviarPendentes(marcadas)}><Send size={16} /> Enviar relatório e boleto</Button>
          </>
        ) : null}
      </div>
      {progresso ? (
        <div className="grid gap-1" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-cyan-700 transition-[width]" style={{ width: `${Math.round((progresso.feito / progresso.total) * 100)}%` }} />
          </div>
          <p className="text-sm text-slate-500">Enviando {progresso.feito} de {progresso.total}…</p>
        </div>
      ) : null}
      {aviso ? <Alerta tom={aviso.startsWith("Nenhum") ? "aviso" : "info"}>{aviso}</Alerta> : null}

      {query.isLoading ? <Skeleton className="h-64" /> : query.isError ? (
        <Alerta>{query.error instanceof ApiError ? query.error.message : "Não foi possível carregar as cobranças."}</Alerta>
      ) : rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table min-w-[1120px]">
            <thead>
              <tr>
                <th className="w-px"><span className="sr-only">Selecionar</span></th>
                <th>Empresa</th>
                <th>Descrição</th>
                <th>Vencimento</th>
                <th className="text-right">Valor</th>
                <th>Situação</th>
                <th>Relatório por e-mail</th>
                <th className="text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const podeEnviar = row.situacao === "aberta" && !row.envio;
                const marcada = marcadas.includes(row.id);
                const nome = textoPlano(row.empresa_fantasia) || textoPlano(row.empresa_razao) || "Empresa sem nome";
                return (
                  <tr key={row.id} className={marcada ? "bg-cyan-50" : undefined}>
                    <td>
                      {podeEnviar ? (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${nome}`}
                          className="h-4 w-4 accent-cyan-700"
                          checked={marcada}
                          onChange={(event) => setMarcadas((atual) => event.target.checked ? [...atual, row.id] : atual.filter((id) => id !== row.id))}
                        />
                      ) : null}
                    </td>
                    <td className="min-w-48 max-w-72">
                      <p className="truncate font-semibold text-navy-900" title={nome}>{nome}</p>
                      {row.empresa_cnpj ? <p className="whitespace-nowrap text-xs tabular-nums text-slate-500">{formatCnpj(row.empresa_cnpj)}</p> : null}
                    </td>
                    <td className="min-w-40 text-slate-600">{row.descricao}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(row.vencimento)}</td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums text-navy-900">{money(row.valor)}</td>
                    <td><Badge value={row.situacao === "paga" ? "ativa" : row.situacao === "aberta" ? "aberta" : "encerrada"}>{situacaoLabel[row.situacao] ?? row.situacao}</Badge></td>
                    <td className="whitespace-nowrap text-slate-600">{row.envio ? <span className="tabular-nums">Enviado em {dataEnvio(row.envio)}</span> : <span className="text-slate-400">Não enviado</span>}</td>
                    <td>
                      <div className="flex min-w-56 flex-wrap justify-end gap-1.5">
                        <button type="button" className="acao acao-cyan" onClick={() => { const ref = competencia(row.descricao); setRelatorio({ empresaId: row.id_empresa, mes: ref?.mes ?? "", ano: ref?.ano ?? "" }); }}>Relatório</button>
                        {row.url_pagamento ? <a className="acao acao-cyan inline-flex items-center gap-1" href={row.url_pagamento} target="_blank" rel="noreferrer">Link <ExternalLink size={12} /></a> : null}
                        {podeEnviar ? <button type="button" className="acao acao-cyan" disabled={Boolean(progresso)} onClick={() => enviarPendentes([row.id])}>Enviar relatório</button> : null}
                        <button type="button" className="acao acao-cyan" onClick={() => sincronizar.mutate(row.id)}>Verificar</button>
                        {row.situacao === "aberta" ? <button type="button" className="acao acao-cyan" onClick={() => setPagamento({ id: row.id, data: new Date().toISOString().slice(0, 10) })}>Baixar</button> : null}
                        {row.situacao !== "cancelada" ? <button type="button" className="acao acao-cyan" onClick={() => void abrirNota(row)}>Nota</button> : null}
                        {row.notas.map((item) => item.pdf_url ? <a key={item.id} className="acao acao-cyan inline-flex items-center gap-1" href={item.pdf_url} target="_blank" rel="noreferrer">PDF da nota <ExternalLink size={12} /></a> : (
                          <button key={item.id} type="button" className="acao acao-cyan" disabled={baixarNota.isPending} onClick={() => {
                            const aba = window.open("about:blank", "_blank");
                            baixarNota.mutate(item.id, {
                              onSuccess: (resultado) => {
                                const url = resultado.data.pdf_url;
                                if (aba) aba.location.href = url;
                                else window.location.assign(url);
                              },
                              onError: () => aba?.close(),
                            });
                          }}>PDF da nota</button>
                        ))}
                        {row.situacao === "aberta" ? <button type="button" className="acao acao-rose" onClick={() => excluir.mutate(row.id)}>Excluir</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            Em aberto nesta lista <span className="font-bold tabular-nums text-navy-900">{money(total)}</span>
          </div>
        </Card>
      ) : busca.trim() || empresaId ? (
        <Empty title="Nenhuma cobrança dessa empresa no período" text="Mude as datas ou use “Limpar e ver todas” para ver as outras empresas." />
      ) : filtrando ? (
        <Empty title="Nenhuma cobrança com esses filtros" text="Amplie o período de vencimento, troque a situação ou limpe os filtros." />
      ) : (
        <Empty title="Nenhuma cobrança com vencimento neste mês" text="Gere uma cobrança acima ou mude o período de vencimento." />
      )}

      {relatorio ? <RelatorioEmpresaPainel empresaId={relatorio.empresaId} mes={relatorio.mes} ano={relatorio.ano} onClose={() => setRelatorio(null)} /> : null}
      {pagamento ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="recebimento-titulo">
          <Card className="motion-pop grid w-full max-w-md gap-4">
            <div>
              <h2 id="recebimento-titulo" className="text-[15px] font-bold text-navy-900">Data do recebimento</h2>
              <p className="text-sm text-slate-500">Dá baixa no Asaas como recebido em dinheiro, com o valor cheio.</p>
            </div>
            <Field label="Data"><Input type="date" value={pagamento.data} onChange={(event) => setPagamento({ ...pagamento, data: event.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPagamento(null)}>Cancelar</Button>
              <Button type="button" disabled={receber.isPending} onClick={() => receber.mutate()}><Check size={16} /> {receber.isPending ? "Confirmando…" : "Confirmar recebimento"}</Button>
            </div>
          </Card>
        </div>
      ) : null}
      {nota ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="nota-titulo">
          <Card className="motion-pop grid max-h-[90vh] w-full max-w-lg gap-4 overflow-auto">
            <div>
              <h2 id="nota-titulo" className="text-[15px] font-bold text-navy-900">Emitir nota fiscal</h2>
              <p className="text-sm text-slate-500">Confira o serviço, o ISS, o valor e a descrição antes de emitir.</p>
            </div>
            {nota.origem === "carregando" ? <Skeleton className="h-32" /> : null}
            {nota.origem === "misto" ? <Alerta tom="info">Esta cobrança tem estágio e CLT, então saem duas notas.</Alerta> : null}
            {nota.origem === "padrao" ? <Alerta tom="aviso">Não encontrei os contratos deste mês. Confira o serviço antes de emitir.</Alerta> : null}
            {nota.itens.map((item, index) => (
              <div key={`${item.tipo}-${index}`} className="grid gap-3 rounded-lg border border-slate-200 p-3">
                {nota.itens.length > 1 ? <p className="text-sm font-semibold text-navy-900">{item.descricao}</p> : null}
                <div className="grid gap-3 sm:grid-cols-6">
                  <div className="sm:col-span-3"><Field label="Código do serviço municipal"><Input value={item.codigo} onChange={(event) => setNota({ ...nota, itens: nota.itens.map((atual, i) => i === index ? { ...atual, codigo: event.target.value } : atual) })} /></Field></div>
                  <div className="sm:col-span-1"><Field label="ISS (%)"><Input value={item.iss} onChange={(event) => setNota({ ...nota, itens: nota.itens.map((atual, i) => i === index ? { ...atual, iss: event.target.value } : atual) })} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Valor"><Input value={item.valor} onChange={(event) => setNota({ ...nota, itens: nota.itens.map((atual, i) => i === index ? { ...atual, valor: event.target.value } : atual) })} /></Field></div>
                  <div className="sm:col-span-6"><Field label="Descrição"><Input value={item.descricao} onChange={(event) => setNota({ ...nota, itens: nota.itens.map((atual, i) => i === index ? { ...atual, descricao: event.target.value } : atual) })} /></Field></div>
                </div>
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setNota(null)}>Cancelar</Button>
              <Button type="button" disabled={emitir.isPending || nota.itens.length === 0 || nota.itens.some((item) => !item.codigo)} onClick={() => emitir.mutate()}><FileText size={16} /> {emitir.isPending ? "Emitindo…" : nota.itens.length > 1 ? "Emitir as duas" : "Emitir nota"}</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
