import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, ListChecks, Loader2, Receipt, Search, Send, Wallet, X } from "lucide-react";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Paginacao } from "@/components/paginacao";
import { Alerta, CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, cn } from "@/components/ui";
import { RelatorioEmpresaPainel } from "@/components/relatorio-empresa";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, money, textoPlano } from "@/lib/format";

const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const nomesMes = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function nowMonth() {
  return String(new Date().getMonth() + 1).padStart(2, "0");
}

function nowYear() {
  return String(new Date().getFullYear());
}

/** Filtros guardados na tela (não na URL): a versão muda ao limpar, para os campos com defaultValue voltarem ao padrão. */
function useLimpeza<T extends Record<string, string>>(inicial: T, busca: Record<string, string>, aplicar: (valor: T) => void) {
  const [versao, setVersao] = useState(0);
  const chaves = new Set([...Object.keys(inicial), ...Object.keys(busca)]);
  const filtrando = [...chaves].some((chave) => (busca[chave] ?? "") !== ((inicial as Record<string, string>)[chave] ?? ""));
  function limpar() {
    aplicar(inicial);
    setVersao((atual) => atual + 1);
  }
  return { versao, filtrando, limpar };
}

function EmpresaField() {
  return (
    <CampoFiltro rotulo="Empresa">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input name="empresa" aria-label="Empresa" placeholder="Nome ou razão social" className="pl-9" />
      </div>
    </CampoFiltro>
  );
}

function MonthField({ todos = false }: { todos?: boolean }) {
  return (
    <CampoFiltro rotulo="Mês">
      <Select name="mes" aria-label="Mês" defaultValue={todos ? "" : nowMonth()}>
        {todos ? <option value="">Todos</option> : null}
        {months.map((month, index) => <option key={month} value={month}>{nomesMes[index]}</option>)}
      </Select>
    </CampoFiltro>
  );
}

function YearField() {
  return <CampoFiltro rotulo="Ano"><Input name="ano" aria-label="Ano" defaultValue={nowYear()} inputMode="numeric" /></CampoFiltro>;
}

function MonthRange() {
  const ate = `${nowYear()}-${nowMonth()}`;
  const de = `${nowYear()}-01`;
  return (
    <>
      <CampoFiltro rotulo="De"><Input name="de" aria-label="De Início" type="month" defaultValue={de} /></CampoFiltro>
      <CampoFiltro rotulo="Até"><Input name="ate" aria-label="Até" type="month" defaultValue={ate} /></CampoFiltro>
    </>
  );
}

/** Pesquisar sempre dá retorno: fica "Pesquisando…" enquanto a lista carrega. */
function SearchButton({ carregando = false }: { carregando?: boolean }) {
  return (
    <Button type="submit" className="h-10" disabled={carregando} aria-busy={carregando}>
      {carregando ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {carregando ? "Pesquisando…" : "Pesquisar"}
    </Button>
  );
}

function reais(valor: number | string | boolean | null | undefined) {
  const numero = typeof valor === "number" ? valor : Number(valor ?? 0);
  return money(Number.isFinite(numero) ? numero : 0);
}

function lerFiltros(event: FormEvent<HTMLFormElement>, chaves: string[]) {
  const data = new FormData(event.currentTarget);
  const next: Record<string, string> = {};
  for (const chave of chaves) {
    const valor = String(data.get(chave) ?? "").trim();
    if (valor) next[chave] = valor;
  }
  return next;
}

function ExcelButton({ onClick, disabled }: { onClick?: (event: MouseEvent<HTMLButtonElement>) => void; disabled?: boolean }) {
  return <Button type="button" variant="secondary" className="h-10" disabled={disabled} onClick={onClick}><FileSpreadsheet size={16} /> Gerar Excel</Button>;
}

/** Nome fantasia em destaque e razão social embaixo, com as entidades HTML do sistema antigo limpas. */
function NomeEmpresa({ fantasia, razao, extra }: { fantasia: string | null; razao: string | null; extra?: ReactNode }) {
  const principal = textoPlano(fantasia) || textoPlano(razao) || "Empresa sem nome";
  const segunda = fantasia && razao ? textoPlano(razao) : "";
  return (
    <div className="min-w-0 max-w-80">
      <p className="truncate font-semibold text-navy-900" title={principal}>{principal}</p>
      {segunda && segunda !== principal ? <p className="truncate text-xs text-slate-500" title={segunda}>{segunda}</p> : null}
      {extra}
    </div>
  );
}

function Resumo({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold text-slate-500">{rotulo}</dt>
      <dd className={cn("mt-0.5 font-extrabold tabular-nums text-navy-900", destaque ? "text-2xl" : "text-xl")}>{valor}</dd>
      {detalhe ? <dd className="mt-0.5 text-xs text-slate-500">{detalhe}</dd> : null}
    </div>
  );
}

/** Rodapé da tabela: total à esquerda (quando houver) e a paginação à direita. */
function RodapeTabela({ total, pagina, registros, onPagina }: { total?: ReactNode; pagina: number; registros: number; onPagina: (pagina: number) => void }) {
  const paginas = Math.ceil(registros / TAMANHO);
  if (!total && paginas <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
      {total ? <p className="px-4 py-3 text-sm text-slate-500">{total}</p> : <span />}
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={registros} onPagina={onPagina} />
    </div>
  );
}

function erroDe(erro: unknown, padrao: string) {
  return erro instanceof Error && erro.message ? erro.message : padrao;
}

function PayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <Card className="motion-pop grid w-full max-w-md gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="pay-title" className="text-[15px] font-bold text-navy-900">Pagar comissão</h2>
            <p className="text-sm text-slate-500">Qual a data de pagamento?</p>
          </div>
          <button type="button" aria-label="Fechar" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" onClick={onClose}><X size={18} /></button>
        </div>
        <Field label="Data do pagamento"><Input aria-label="Data" type="date" /></Field>
        <Alerta tom="aviso">O pagamento de comissão ainda não é gravado pelo sistema.</Alerta>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={onClose}>Confirmar</Button>
        </div>
      </Card>
    </div>
  );
}

const TAMANHO = 50;

const tomFatura: Record<string, string> = { Aberta: "aberta", Parcial: "pausada", Faturado: "ativa", Faturada: "ativa", Paga: "ativa", Pago: "ativa", Cancelada: "encerrada", Vencido: "recusado", Aberto: "aberta" };

function SeloStatus({ status }: { status: string | null | undefined }) {
  if (!status || status === "—") return <span className="text-slate-400">—</span>;
  return <Badge value={tomFatura[status]}>{status}</Badge>;
}

/** "10" vira "Dia 10"; outros formatos aparecem como vieram. */
function fechamento(valor: string | null) {
  if (!valor) return "—";
  return /^\d{1,2}$/.test(valor.trim()) ? `Dia ${valor.trim()}` : dateBr(valor);
}

export function GerarFaturamentoPage() {
  const client = useQueryClient();
  const inicial = { mes: nowMonth(), ano: nowYear(), status: "3" };
  const [busca, setBusca] = useState(inicial);
  const [rodada, setRodada] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [aviso, setAviso] = useState("");
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const limpeza = useLimpeza(inicial, busca, (valor) => { setBusca(valor); setPagina(1); });
  const result = useQuery({
    // "rodada" muda a cada Pesquisar: a mesma busca repetida também recarrega.
    queryKey: ["faturamento", busca, pagina, rodada],
    queryFn: () => api<{ matriz: Array<{ razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; datafechamento: string | null; status: string }>; itens: Array<{ id_empresa: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; tipo: string | null; datafechamento: string | null; itens: number; valor: number | null; status: string; envio: string | null }> }>(`/api/v1/faturamento?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const boletos = useMutation({
    mutationFn: () => api<{ gerados: number; falhas: Array<{ empresa: string | null; motivo: string }> }>("/api/v1/faturamento/boletos", {
      method: "POST",
      body: JSON.stringify({ mes: busca.mes, ano: busca.ano }),
    }),
    onSuccess: async (resposta) => {
      const falhas = resposta.data.falhas.length;
      setAviso(resposta.data.gerados === 0 && falhas === 0
        ? "Este mês não tem fatura em aberto sem boleto."
        : `${resposta.data.gerados} boleto(s) gerado(s)${falhas ? `. ${falhas} não saíram.` : "."}`);
      await client.invalidateQueries({ queryKey: ["faturamento"] });
    },
    onError: (error: Error) => setAviso(error.message),
  });
  async function enviarLote(ids: string[]) {
    setProgresso({ feito: 0, total: ids.length });
    setAviso("");
    let enviados = 0;
    let boletos = 0;
    let pulados = 0;
    let falhas = 0;
    const motivos = new Set<string>();
    for (const id of ids) {
      try {
        const resposta = await api<{ enviados: number; boletos?: number; pulados?: number; falhas: Array<{ empresa: string | null; motivo: string }> }>("/api/v1/faturamento/relatorios", {
          method: "POST",
          body: JSON.stringify({ empresas: [id], mes: busca.mes, ano: busca.ano }),
        });
        enviados += resposta.data.enviados;
        boletos += resposta.data.boletos ?? 0;
        pulados += resposta.data.pulados ?? 0;
        falhas += resposta.data.falhas.length;
        for (const falha of resposta.data.falhas) motivos.add(falha.motivo);
      } catch (error) {
        falhas += 1;
        motivos.add(error instanceof Error ? error.message : "Falha ao enviar.");
      }
      setProgresso((atual) => atual ? { feito: atual.feito + 1, total: atual.total } : null);
    }
    setProgresso(null);
    if (enviados > 0) setMarcadas([]);
    const porque = [...motivos].slice(0, 3).join(" ");
    const avisoPulados = pulados ? ` ${pulados} já tinham relatório neste mês e não foram enviados de novo.` : "";
    setAviso(enviados > 0
      ? `${enviados} relatório(s) e boleto(s) enviado(s).${avisoPulados}${falhas ? ` ${falhas} não saíram. ${porque}` : " As cobranças estão em Contas a receber."}`
      : boletos > 0
        ? `${boletos} boleto(s) já estão em Contas a receber. O e-mail não saiu.${avisoPulados} ${porque}`
        : pulados > 0 && falhas === 0
          ? `Nenhuma cobrança nova. ${pulados} já tinham relatório neste mês.`
          : `Nenhuma cobrança foi gerada. ${porque || "O envio falhou antes de criar o boleto."}`);
    await client.invalidateQueries({ queryKey: ["faturamento"] });
  }
  async function selecionarTodas() {
    try {
      const params = new URLSearchParams({ ...busca, page: "1", pageSize: "100" });
      const primeira = await api<{ itens: Array<{ id_empresa: string }> }>(`/api/v1/faturamento?${params}`);
      let ids = primeira.data.itens.map((item) => item.id_empresa);
      const totalBusca = Number(primeira.meta?.total ?? ids.length);
      if (totalBusca > 100) {
        params.set("page", "2");
        const segunda = await api<{ itens: Array<{ id_empresa: string }> }>(`/api/v1/faturamento?${params}`);
        ids = [...ids, ...segunda.data.itens.map((item) => item.id_empresa)];
      }
      setMarcadas(ids);
      setAviso(ids.length ? `${ids.length} empresas selecionadas.` : "Nenhuma empresa para selecionar.");
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "Não foi possível selecionar as empresas.");
    }
  }
  const dados = result.data?.data;
  const total = Number(result.data?.meta?.total ?? 0);
  const meta = result.data?.meta as { asaas?: { valor: number; quantidade: number } | null; conferencia?: { valor: number; quantidade: number }; totalReceber?: number } | undefined;
  const itens = dados?.itens ?? [];
  const matriz = dados?.matriz ?? [];
  const paginaMarcada = itens.length > 0 && itens.every((item) => marcadas.includes(item.id_empresa));
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Gerar faturamento"
        descricao="Calcula quanto cada empresa deve no mês e envia o relatório com o boleto do Asaas."
        acoes={(
          <Button type="button" variant="secondary" disabled={boletos.isPending} onClick={() => {
            if (window.confirm(`Gerar os boletos de ${busca.mes}/${busca.ano} no Asaas para as faturas em aberto que ainda não têm cobrança?`)) boletos.mutate();
          }}><Receipt size={16} /> {boletos.isPending ? "Gerando…" : "Gerar boletos do mês"}</Button>
        )}
      />
      <dl className="grid gap-3 sm:grid-cols-2">
        <Resumo rotulo="Valor a receber no mês" valor={reais(meta?.totalReceber)} detalhe="Calculado como no sistema antigo: recorrente mais recrutamento." destaque />
        <Resumo rotulo="Em aberto no Asaas" valor={meta?.asaas ? reais(meta.asaas.valor) : "—"} detalhe={meta?.asaas ? `${meta.asaas.quantidade} cobranças em aberto no Asaas` : "Asaas indisponível neste momento"} destaque />
      </dl>
      <Card>
        <form key={limpeza.versao} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_minmax(0,1.2fr)_auto] lg:items-end" onSubmit={(event) => {
          event.preventDefault();
          // "Todas" tem valor vazio: precisa ir explícito, senão vale o "3" (aberta e parcial) do estado inicial.
          const status = String(new FormData(event.currentTarget).get("status") ?? "");
          setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "mes", "ano"]), status });
          setPagina(1);
          setRodada((atual) => atual + 1);
        }}>
          <EmpresaField />
          <MonthField />
          <YearField />
          <CampoFiltro rotulo="Situação da fatura">
            <Select name="status" aria-label="Status" defaultValue="3">
              <option value="">Todas</option>
              <option value="0">Aberta</option>
              <option value="3">Aberta e parcial</option>
              <option value="2">Parcial</option>
              <option value="1">Faturada</option>
            </Select>
          </CampoFiltro>
          <SearchButton carregando={result.isFetching} />
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : total} singular="empresa a faturar" plural="empresas a faturar" filtrando={limpeza.filtrando} carregando={result.isLoading} onLimpar={limpeza.limpar} />

      {matriz.length ? (
        <section className="grid gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Matrizes sem candidatos</h2>
            <p className="text-sm text-slate-500">Matrizes que não entram na lista: o faturamento das filiais fica agrupado nelas.</p>
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="data-table compact">
              <thead><tr><th>Empresa</th><th>CNPJ</th><th>Fechamento</th><th>Situação</th></tr></thead>
              <tbody>
                {matriz.map((item, index) => (
                  <tr key={`${item.cnpj}-${index}`}>
                    <td><NomeEmpresa fantasia={item.nome_fantasia} razao={item.razao_social} /></td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(item.cnpj)}</td>
                    <td className="whitespace-nowrap text-slate-600">{fechamento(item.datafechamento)}</td>
                    <td><SeloStatus status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={Boolean(progresso) || !total} onClick={() => void selecionarTodas()}>
          <ListChecks size={16} /> Selecionar todas ({total})
        </Button>
        {marcadas.length > 0 ? (
          <>
            <span className="text-sm text-slate-500"><span className="font-bold tabular-nums text-navy-900">{marcadas.length}</span> {marcadas.length === 1 ? "selecionada" : "selecionadas"}</span>
            <Button type="button" disabled={Boolean(progresso)} onClick={() => enviarLote(marcadas)}><Send size={16} /> Enviar relatório e boleto</Button>
          </>
        ) : null}
      </div>
      {progresso ? <Progresso feito={progresso.feito} total={progresso.total} /> : null}
      {aviso ? <Alerta tom={aviso.startsWith("Nenhuma") ? "erro" : "info"}>{aviso}</Alerta> : null}

      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>{erroDe(result.error, "Não foi possível carregar o faturamento.")}</Alerta>
      ) : itens.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table min-w-[1040px]">
            <thead>
              <tr>
                <th className="w-px">
                  <input aria-label="Selecionar página" type="checkbox" className="h-4 w-4 accent-cyan-700" checked={paginaMarcada} onChange={(event) => {
                    const ids = itens.map((item) => item.id_empresa);
                    setMarcadas((atual) => event.target.checked ? [...new Set([...atual, ...ids])] : atual.filter((id) => !ids.includes(id)));
                  }} />
                </th>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Tipo</th>
                <th>Fechamento</th>
                <th className="text-right">Itens</th>
                <th className="text-right">A faturar</th>
                <th>Situação</th>
                <th>Relatório enviado</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => {
                const marcada = marcadas.includes(item.id_empresa);
                return (
                  <tr key={item.id_empresa} className={marcada ? "bg-cyan-50" : undefined}>
                    <td><input aria-label={`Selecionar ${textoPlano(item.nome_fantasia || item.razao_social)}`} type="checkbox" className="h-4 w-4 accent-cyan-700" checked={marcada} onChange={() => setMarcadas((atual) => atual.includes(item.id_empresa) ? atual.filter((id) => id !== item.id_empresa) : [...atual, item.id_empresa])} /></td>
                    <td><NomeEmpresa fantasia={item.nome_fantasia} razao={item.razao_social} /></td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(item.cnpj)}</td>
                    <td className="text-slate-600">{item.tipo || "—"}</td>
                    <td className="whitespace-nowrap text-slate-600">{fechamento(item.datafechamento)}</td>
                    <td className="text-right tabular-nums">{item.itens}</td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums text-navy-900">{item.valor == null ? "—" : money(item.valor)}</td>
                    <td><SeloStatus status={item.status} /></td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{item.envio ? dateBr(item.envio) : <span className="text-slate-400">Não enviado</span>}</td>
                    <td className="w-px whitespace-nowrap text-right">
                      <button type="button" className="acao acao-cyan inline-flex items-center gap-1" onClick={() => setAberta(item.id_empresa)}><FileText size={13} /> Relatório</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <RodapeTabela pagina={pagina} registros={total} onPagina={setPagina} total={<>Total a receber <span className="font-bold tabular-nums text-navy-900">{reais(meta?.totalReceber)}</span></>} />
        </Card>
      ) : limpeza.filtrando ? (
        <Empty title="Nenhuma empresa com esses filtros" text="Troque o mês, a situação ou a empresa, ou limpe os filtros para voltar ao mês atual." />
      ) : (
        <Empty title="Nenhuma empresa a faturar neste mês" text="As empresas com contratação ativa e valor de contrato aparecem aqui quando houver o que faturar." />
      )}
      {aberta ? <RelatorioEmpresaPainel empresaId={aberta} mes={busca.mes} ano={busca.ano} onClose={() => setAberta(null)} /> : null}
    </div>
  );
}

function Progresso({ feito, total }: { feito: number; total: number }) {
  return (
    <div className="grid gap-1" role="status">
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-cyan-700 transition-[width]" style={{ width: `${Math.round((feito / total) * 100)}%` }} />
      </div>
      <p className="text-sm text-slate-500">Enviando {feito} de {total}…</p>
    </div>
  );
}

type Procfy = {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  tipo: string | null;
  vencimento: string | null;
  valor: number | null;
  recorrente: number;
  recrutamento: number;
  desconto: number;
  parcela: string | null;
  forma_pg: string | null;
  data_pg: string | null;
  status: string;
};
type ProcfyDetalhe = {
  empresa: string | null;
  razao: string | null;
  cnpj: string | null;
  valor: number;
  desconto: number;
  parcela: string | null;
  vencimento: string | null;
  itens: Array<{ tipo: string; nome: string | null; cargo: string | null; valor: number }>;
};
type Comissao = { nome_fantasia: string | null; cnpj: string | null; vencimento: string | null; data_pg: string | null; status_boleto: string; itens: number; vendedor: string | null; treinamento: string | null; valor: number | null; status: string };
type ComissaoEmpresa = { nome_fantasia: string | null; vendedor: string | null; data_cadastro: string | null; primeira_contratacao: string | null; primeira_vaga: string | null; tipo: string | null; valor: number | null; status: string };
type Holerite = { id_empresa: string; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; candidatos: number; estagiarios: number };

function vencida(item: Procfy) {
  if (item.status !== "Aberta" || !item.vencimento) return false;
  return item.vencimento.slice(0, 10).replaceAll("/", "-") < new Date().toISOString().slice(0, 10);
}

export function RelatorioProcfyPage() {
  const inicial = { de: `${nowYear()}-01`, ate: `${nowYear()}-${nowMonth()}`, tipoData: "vencimento_fatura", sistema: "ambos", status: "" };
  const [busca, setBusca] = useState(inicial);
  const [rodada, setRodada] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagamento, setPorPagamento] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const limpeza = useLimpeza(inicial, busca, (valor) => { setBusca(valor); setPagina(1); setPorPagamento(false); });
  const result = useQuery({
    // "rodada" muda a cada Pesquisar: a mesma busca repetida também recarrega.
    queryKey: ["procfy", busca, pagina, rodada],
    queryFn: () => api<Procfy[]>(`/api/v1/procfy?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const detalhe = useQuery({
    queryKey: ["procfy-fatura", detalheId],
    queryFn: () => api<ProcfyDetalhe>(`/api/v1/procfy/fatura/${detalheId}`),
    enabled: Boolean(detalheId),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  function excel(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const data = form ? new FormData(form) : null;
    const tipoData = String(data?.get("tipoData") ?? busca.tipoData);
    const filtros = {
      de: String(data?.get("de") ?? busca.de),
      ate: String(data?.get("ate") ?? busca.ate),
      tipoData,
      sistema: String(data?.get("sistema") ?? busca.sistema),
      status: tipoData === "data_pg" ? "1" : String(data?.get("status") ?? busca.status),
    };
    setBusca(filtros);
    setPagina(1);
    const link = document.createElement("a");
    link.href = `/api/v1/procfy/excel?${new URLSearchParams(filtros)}`;
    link.download = "Faturas.xls";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  const fatura = detalhe.data?.data;
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Relatório Procfy"
        descricao="Faturas do sistema antigo (contas a receber DNA + DISC), com os candidatos de cada fatura e exportação para Excel."
      />
      <Card>
        <form key={limpeza.versao} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end" onSubmit={(event) => {
          event.preventDefault();
          const filtros = lerFiltros(event, ["tipoData", "de", "ate", "status", "sistema"]);
          const status = String(new FormData(event.currentTarget).get("status") ?? "");
          filtros.status = filtros.tipoData === "data_pg" ? "1" : status;
          setBusca({ ...inicial, ...filtros });
          setPagina(1);
          setRodada((atual) => atual + 1);
        }}>
          <CampoFiltro rotulo="Filtrar pela data de">
            <Select name="tipoData" aria-label="Tipo data" defaultValue="vencimento_fatura" onChange={(event) => setPorPagamento(event.target.value === "data_pg")}>
              <option value="vencimento_fatura">Vencimento</option>
              <option value="data_pg">Pagamento</option>
              <option value="data_cadastro">Cadastro da cobrança</option>
            </Select>
          </CampoFiltro>
          <MonthRange />
          {porPagamento ? (
            <CampoFiltro rotulo="Situação">
              <p className="flex h-10 items-center text-sm text-slate-500">Só as pagas</p>
            </CampoFiltro>
          ) : (
            <CampoFiltro rotulo="Situação">
              <Select name="status" aria-label="Status" defaultValue="">
                <option value="">Todas</option>
                <option value="0">Aberta</option>
                <option value="1">Paga</option>
                <option value="2">Cancelada</option>
              </Select>
            </CampoFiltro>
          )}
          <CampoFiltro rotulo="Sistema">
            <Select name="sistema" aria-label="Sistema" defaultValue="ambos">
              <option value="ambos">DNA e DISC</option>
              <option value="dna">DNA</option>
              <option value="disc">DISC</option>
            </Select>
          </CampoFiltro>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
            <SearchButton carregando={result.isFetching} />
            <ExcelButton onClick={excel} />
          </div>
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : total} singular="fatura" plural="faturas" filtrando={limpeza.filtrando} carregando={result.isLoading} onLimpar={limpeza.limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>{erroDe(result.error, "Não foi possível carregar as faturas.")}</Alerta>
      ) : linhas.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table min-w-[960px]">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Tipo</th>
                <th>Vencimento</th>
                <th className="text-right">Valor</th>
                <th>Forma de pagamento</th>
                <th>Pago em</th>
                <th>Situação</th>
                <th><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item) => {
                const atrasada = vencida(item);
                return (
                  <tr key={item.id}>
                    <td><NomeEmpresa fantasia={item.nome_fantasia} razao={item.razao_social} /></td>
                    <td className="text-slate-600">{item.tipo || "—"}</td>
                    <td className={cn("whitespace-nowrap tabular-nums", atrasada ? "font-semibold text-rose-700" : "text-slate-600")}>{dateBr(item.vencimento)}</td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums text-navy-900">{money(item.valor)}</td>
                    <td className="text-slate-600">{item.forma_pg || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_pg)}</td>
                    <td><SeloStatus status={atrasada ? "Vencido" : item.status} /></td>
                    <td className="w-px whitespace-nowrap text-right">
                      <button type="button" className="acao acao-cyan" onClick={() => setDetalheId(item.id)}>Ver detalhes</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <RodapeTabela pagina={pagina} registros={total} onPagina={setPagina} total={<>Total a receber <span className="font-bold tabular-nums text-navy-900">{reais(result.data?.meta?.totalReceber)}</span></>} />
        </Card>
      ) : limpeza.filtrando ? (
        <Empty title="Nenhuma fatura com esses filtros" text="Amplie o período, troque a situação ou limpe os filtros." />
      ) : (
        <Empty title="Nenhuma fatura neste ano" text="Escolha outro período em De e Até e clique em Pesquisar." />
      )}
      {detalheId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="procfy-titulo">
          <Card className="motion-pop grid max-h-[90vh] w-full max-w-3xl gap-4 overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="procfy-titulo" className="text-lg font-bold text-navy-900">{textoPlano(fatura?.empresa) || "Fatura"}</h2>
                <p className="text-sm text-slate-500">{textoPlano(fatura?.razao)}{fatura?.cnpj ? ` · ${formatCnpj(fatura.cnpj)}` : ""}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setDetalheId(null)}><X size={16} /> Fechar</Button>
            </div>
            {detalhe.isLoading ? <Skeleton className="h-40" /> : null}
            {detalhe.error instanceof Error ? <Alerta>{detalhe.error.message}</Alerta> : null}
            {fatura ? (
              <>
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <Dado rotulo="Valor"><span className="font-bold tabular-nums text-navy-900">{money(fatura.valor)}</span></Dado>
                  {fatura.desconto > 0 ? <Dado rotulo="Desconto"><span className="tabular-nums">{money(fatura.desconto)}</span></Dado> : null}
                  {fatura.parcela && fatura.parcela !== "1/1" ? <Dado rotulo="Parcela"><span className="tabular-nums">{fatura.parcela}</span></Dado> : null}
                  <Dado rotulo="Vencimento"><span className="tabular-nums">{dateBr(fatura.vencimento)}</span></Dado>
                </dl>
                {fatura.itens.length ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="data-table compact min-w-[560px]">
                      <thead><tr><th>Tipo</th><th>Candidato</th><th>Cargo</th><th className="text-right">Valor</th></tr></thead>
                      <tbody>
                        {fatura.itens.map((linha, index) => (
                          <tr key={`${linha.nome}-${index}`}>
                            <td className="text-slate-600">{linha.tipo}</td>
                            <td className="font-medium text-navy-900">{linha.nome || "Sem nome"}</td>
                            <td className="text-slate-600">{linha.cargo || "—"}</td>
                            <td className="whitespace-nowrap text-right tabular-nums">{money(linha.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-slate-500">Esta fatura não tem candidatos vinculados.</p>}
              </>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}

function ComissaoFilters({ versao, onSubmit, carregando }: { versao: number; onSubmit: (event: FormEvent<HTMLFormElement>) => void; carregando?: boolean }) {
  return (
    <Card>
      <form key={versao} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_6rem_minmax(0,1fr)_auto] lg:items-end" onSubmit={onSubmit}>
        <EmpresaField />
        <CampoFiltro rotulo="Consultor">
          <Select name="consultor" aria-label="Consultor" defaultValue="todos">
            <option value="todos">Todos</option>
            <option>Fabio Base Dose</option>
            <option>Messias</option>
            <option>Scheilla Marran</option>
          </Select>
        </CampoFiltro>
        <MonthField todos />
        <YearField />
        <CampoFiltro rotulo="Situação">
          <Select name="status" aria-label="Status" defaultValue="">
            <option value="">Todas</option>
            <option value="0">Aberta</option>
            <option value="1">Paga</option>
          </Select>
        </CampoFiltro>
        <SearchButton carregando={carregando} />
      </form>
    </Card>
  );
}

function BotaoPagarComissao({ onClick }: { onClick: () => void }) {
  return <Button type="button" variant="secondary" onClick={onClick}><Wallet size={16} /> Pagar comissão</Button>;
}

export function ComissaoConsultarPage() {
  const inicial = { ano: nowYear() };
  const [paying, setPaying] = useState(false);
  const [busca, setBusca] = useState<Record<string, string>>(inicial);
  const [rodada, setRodada] = useState(0);
  const [pagina, setPagina] = useState(1);
  const limpeza = useLimpeza(inicial, busca, (valor) => { setBusca(valor); setPagina(1); });
  const result = useQuery({
    // "rodada" muda a cada Pesquisar: a mesma busca repetida também recarrega.
    queryKey: ["comissao", busca, pagina, rodada],
    queryFn: () => api<Comissao[]>(`/api/v1/comissao?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Comissão"
        descricao="Comissões de vendas por fatura: vendedor, treinamento, valor e se o boleto e a comissão já foram pagos."
        acoes={<BotaoPagarComissao onClick={() => setPaying(true)} />}
      />
      <ComissaoFilters versao={limpeza.versao} carregando={result.isFetching} onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "consultor", "mes", "ano", "status"]) }); setPagina(1); setRodada((atual) => atual + 1); }} />
      <ResumoResultados total={result.isLoading ? null : total} singular="comissão" plural="comissões" filtrando={limpeza.filtrando} carregando={result.isLoading} onLimpar={limpeza.limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>{erroDe(result.error, "Não foi possível carregar as comissões.")}</Alerta>
      ) : linhas.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table min-w-[1040px]">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Vencimento</th>
                <th>Boleto</th>
                <th className="text-right">Itens</th>
                <th>Vendedor</th>
                <th>Treinamento</th>
                <th className="text-right">Comissão</th>
                <th>Pago em</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item, index) => (
                <tr key={`${item.cnpj}-${item.vencimento}-${index}`}>
                  <td><NomeEmpresa fantasia={item.nome_fantasia} razao={null} extra={item.cnpj ? <p className="text-xs tabular-nums text-slate-500">{formatCnpj(item.cnpj)}</p> : null} /></td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.vencimento)}</td>
                  <td><SeloStatus status={item.status_boleto} /></td>
                  <td className="text-right tabular-nums">{item.itens}</td>
                  <td className="text-slate-600">{item.vendedor || "—"}</td>
                  <td className="text-slate-600">{item.treinamento || "—"}</td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums text-navy-900">{item.valor == null ? "—" : money(item.valor)}</td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_pg)}</td>
                  <td><SeloStatus status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <RodapeTabela pagina={pagina} registros={total} onPagina={setPagina} total={<>Total das comissões no filtro <span className="font-bold tabular-nums text-navy-900">{reais(result.data?.meta?.totalReceber)}</span></>} />
        </Card>
      ) : limpeza.filtrando ? (
        <Empty title="Nenhuma comissão com esses filtros" text="Troque o consultor, o mês ou a situação, ou limpe os filtros." />
      ) : (
        <Empty title="Nenhuma comissão neste ano" text="Escolha outro ano e clique em Pesquisar." />
      )}
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </div>
  );
}

export function ComissaoEmpresasPage() {
  const inicial = { ano: nowYear() };
  const [paying, setPaying] = useState(false);
  const [busca, setBusca] = useState<Record<string, string>>(inicial);
  const [rodada, setRodada] = useState(0);
  const [pagina, setPagina] = useState(1);
  const limpeza = useLimpeza(inicial, busca, (valor) => { setBusca(valor); setPagina(1); });
  const result = useQuery({
    // "rodada" muda a cada Pesquisar: a mesma busca repetida também recarrega.
    queryKey: ["comissao-empresas", busca, pagina, rodada],
    queryFn: () => api<ComissaoEmpresa[]>(`/api/v1/comissao/empresas?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Comissão de empresas"
        descricao="Comissão de cadastro de cada empresa: vendedor, primeira contratação, primeira vaga e valor."
        acoes={<BotaoPagarComissao onClick={() => setPaying(true)} />}
      />
      <ComissaoFilters versao={limpeza.versao} carregando={result.isFetching} onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "consultor", "mes", "ano", "status"]) }); setPagina(1); setRodada((atual) => atual + 1); }} />
      <ResumoResultados total={result.isLoading ? null : total} singular="empresa" plural="empresas" filtrando={limpeza.filtrando} carregando={result.isLoading} onLimpar={limpeza.limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>{erroDe(result.error, "Não foi possível carregar as comissões de empresas.")}</Alerta>
      ) : linhas.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table min-w-[960px]">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Vendedor</th>
                <th>Cadastro</th>
                <th>1ª contratação</th>
                <th>1ª vaga aberta</th>
                <th>Tipo</th>
                <th className="text-right">Valor</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item, index) => (
                <tr key={`${item.nome_fantasia}-${index}`}>
                  <td><NomeEmpresa fantasia={item.nome_fantasia} razao={null} /></td>
                  <td className="text-slate-600">{item.vendedor || "—"}</td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.data_cadastro)}</td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.primeira_contratacao)}</td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.primeira_vaga)}</td>
                  <td className="text-slate-600">{item.tipo || "—"}</td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums text-navy-900">{item.valor == null ? "—" : money(item.valor)}</td>
                  <td><SeloStatus status={item.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <RodapeTabela pagina={pagina} registros={total} onPagina={setPagina} total={<>Total das comissões no filtro <span className="font-bold tabular-nums text-navy-900">{reais(result.data?.meta?.totalReceber)}</span></>} />
        </Card>
      ) : limpeza.filtrando ? (
        <Empty title="Nenhuma empresa com esses filtros" text="Troque o consultor, o mês ou a situação, ou limpe os filtros." />
      ) : (
        <Empty title="Nenhuma comissão de empresa neste ano" text="Escolha outro ano e clique em Pesquisar." />
      )}
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </div>
  );
}

export function GerarHoleritePage() {
  const inicial = { mes: nowMonth(), ano: nowYear() };
  const [busca, setBusca] = useState(inicial);
  const [rodada, setRodada] = useState(0);
  const [pagina, setPagina] = useState(1);
  const limpeza = useLimpeza(inicial, busca, (valor) => { setBusca(valor); setPagina(1); });
  const result = useQuery({
    // "rodada" muda a cada Pesquisar: a mesma busca repetida também recarrega.
    queryKey: ["holerite", busca, pagina, rodada],
    queryFn: () => api<Holerite[]>(`/api/v1/holerite?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Holerite"
        descricao="Empresas com contratados ativos no mês. Clique em “Lançar folha” para lançar faltas e valores e gerar os holerites de estágio em PDF."
      />
      <Card>
        <form key={limpeza.versao} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "mes", "ano"]) }); setPagina(1); setRodada((atual) => atual + 1); }}>
          <EmpresaField />
          <MonthField />
          <YearField />
          <SearchButton carregando={result.isFetching} />
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : total} singular="empresa" plural="empresas" filtrando={limpeza.filtrando} carregando={result.isLoading} onLimpar={limpeza.limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>{erroDe(result.error, "Não foi possível carregar o holerite.")}</Alerta>
      ) : linhas.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th className="text-right">Contratados ativos</th>
                <th className="text-right">Estagiários</th>
                <th><span className="sr-only">Lançar folha</span></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((item, index) => (
                <tr key={`${item.cnpj}-${index}`}>
                  <td><NomeEmpresa fantasia={item.nome_fantasia} razao={item.razao_social} /></td>
                  <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(item.cnpj)}</td>
                  <td className="text-right tabular-nums text-slate-600">{item.candidatos}</td>
                  <td className="text-right font-semibold tabular-nums text-navy-900">{item.estagiarios}</td>
                  <td className="w-px whitespace-nowrap text-right">
                    {item.estagiarios > 0 ? (
                      <Link to={`/financeiro/holerite/${item.id_empresa}?competencia=${busca.ano}-${String(busca.mes).padStart(2, "0")}`}>
                        <Button type="button" className="h-9"><FileText size={15} /> Lançar folha</Button>
                      </Link>
                    ) : <span className="text-xs text-slate-500" title="O holerite CLT ainda não está no sistema novo">Só CLT</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <RodapeTabela pagina={pagina} registros={total} onPagina={setPagina} />
        </Card>
      ) : limpeza.filtrando ? (
        <Empty title="Nenhuma empresa com esses filtros" text="Troque o mês, o ano ou a empresa, ou limpe os filtros para voltar ao mês atual." />
      ) : (
        <Empty title="Nenhuma empresa com candidatos ativos neste mês" text="Escolha outro mês e clique em Pesquisar." />
      )}
    </div>
  );
}
