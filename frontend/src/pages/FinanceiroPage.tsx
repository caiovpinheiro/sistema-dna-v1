import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Paginacao } from "@/components/paginacao";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { RelatorioEmpresaPainel } from "@/components/relatorio-empresa";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, money } from "@/lib/format";

const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

function nowMonth() {
  return String(new Date().getMonth() + 1).padStart(2, "0");
}

function nowYear() {
  return String(new Date().getFullYear());
}

function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function EmpresaField() {
  return <Field label="Empresa"><Input name="empresa" aria-label="Empresa" placeholder="Empresa" /></Field>;
}

function MonthField({ todos = false }: { todos?: boolean }) {
  return (
    <Field label="Mês">
      <Select name="mes" aria-label="Mês" defaultValue={todos ? "" : nowMonth()}>
        {todos ? <option value="">Todos</option> : null}
        {months.map((month) => <option key={month}>{month}</option>)}
      </Select>
    </Field>
  );
}

function YearField() {
  return <Field label="Ano"><Input name="ano" aria-label="Ano" defaultValue={nowYear()} inputMode="numeric" /></Field>;
}

function MonthRange() {
  const mes = `${nowYear()}-${nowMonth()}`;
  return (
    <>
      <Field label="De Início"><Input name="de" aria-label="De Início" type="month" defaultValue={mes} /></Field>
      <Field label="Até"><Input name="ate" aria-label="Até" type="month" defaultValue={mes} /></Field>
    </>
  );
}

function SearchButton() {
  return <Button type="submit" variant="secondary" className="self-end">Pesquisar</Button>;
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
  return <Button type="button" variant="secondary" className="self-end" disabled={disabled} onClick={onClick}>Gerar excel</Button>;
}

function DataTable({ columns, rows }: { columns: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="text-slate-500">
          <tr className="border-b">
            {columns.map((column, index) => <th key={index} className="px-4 py-3 font-semibold whitespace-nowrap">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-slate-100">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3 whitespace-nowrap">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ListingFooter({ count, total }: { count: number; total: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="font-semibold text-slate-500">{count === 0 ? "Nenhum registro encontrado" : `Mostrando 1 até ${count} de ${count} encontrados`}</p>
      <p className="ml-auto text-base font-semibold text-slate-800">Total a receber {total}</p>
    </div>
  );
}

function PayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <Card className="w-full max-w-md">
        <h2 id="pay-title" className="text-lg font-bold">Qual a data de pagamento?</h2>
        <div className="mt-4"><Field label="Data"><Input aria-label="Data" type="date" /></Field></div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" onClick={onClose}>Enviar</Button>
        </div>
      </Card>
    </div>
  );
}

const TAMANHO = 50;

function Consulta({ carregando, erro }: { carregando: boolean; erro: unknown }) {
  if (carregando) return <p className="text-sm text-slate-500">Carregando...</p>;
  if (erro instanceof Error) return <p className="text-sm text-red-600">{erro.message}</p>;
  return null;
}

export function GerarFaturamentoPage() {
  const client = useQueryClient();
  const inicial = { mes: nowMonth(), ano: nowYear(), status: "3" };
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const [aviso, setAviso] = useState("");
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null);
  const result = useQuery({
    queryKey: ["faturamento", busca, pagina],
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
  const dados = result.data?.data;
  const total = Number(result.data?.meta?.total ?? 0);
  const meta = result.data?.meta as { asaas?: { valor: number; quantidade: number } | null; conferencia?: { valor: number; quantidade: number }; totalReceber?: number } | undefined;
  return (
    <Screen title="Faturamento" subtitle="Gerar Faturamento">
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valor a receber</p>
          <p className="mt-2 text-3xl font-extrabold">{reais(meta?.totalReceber)}</p>
          <p className="mt-1 text-sm text-slate-500">Calculado neste mês, como no sistema antigo: recorrente mais recrutamento.</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Asaas</p>
          <p className="mt-2 text-3xl font-extrabold">{meta?.asaas ? reais(meta.asaas.valor) : "—"}</p>
          <p className="mt-1 text-sm text-slate-500">{meta?.asaas ? `${meta.asaas.quantidade} cobranças em aberto no Asaas` : "Asaas indisponível neste momento"}</p>
        </Card>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "mes", "ano", "status"]) }); setPagina(1); }}>
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-5">
        <EmpresaField />
        <MonthField />
        <YearField />
        <Field label="Status">
          <Select name="status" aria-label="Status" defaultValue="3">
            <option value="">Todos</option>
            <option value="0">Aberta</option>
            <option value="3">Aberta e Parcial</option>
            <option value="2">Parcial</option>
            <option value="1">Faturado</option>
          </Select>
        </Field>
        <SearchButton />
      </Card>
      </form>
      <div className="grid gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Matriz (Sem candidatos) com faturamento de filiais agrupado</h2>
        <DataTable
          columns={["Razão Social", "Nome Fantasia", "CNPJ", "DT Fechamento", "Status"]}
          rows={(dados?.matriz ?? []).map((item) => [item.razao_social, item.nome_fantasia, formatCnpj(item.cnpj), item.datafechamento, item.status])}
        />
      </div>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={Boolean(progresso) || !total} onClick={async () => {
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
          }}>Selecionar todas ({total})</Button>
          {marcadas.length > 0 ? (
            <Button type="button" disabled={Boolean(progresso)} onClick={() => enviarLote(marcadas)}>Enviar relatório e boleto</Button>
          ) : null}
        </div>
        {progresso ? (
          <div className="grid gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-cyan-700 transition-[width]" style={{ width: `${Math.round((progresso.feito / progresso.total) * 100)}%` }} />
            </div>
            <p className="text-sm text-slate-500">{progresso.feito} de {progresso.total}</p>
          </div>
        ) : null}
        {aviso ? <p className={`text-sm font-semibold ${aviso.startsWith("Nenhuma") ? "text-rose-600" : "text-slate-200"}`}>{aviso}</p> : null}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-slate-500">
            <tr className="border-b">
              <th className="px-4 py-3"><input aria-label="Selecionar página" type="checkbox" checked={Boolean(dados?.itens.length) && (dados?.itens.every((item) => marcadas.includes(item.id_empresa)) ?? false)} onChange={(event) => {
                const ids = dados?.itens.map((item) => item.id_empresa) ?? [];
                setMarcadas((atual) => event.target.checked ? [...new Set([...atual, ...ids])] : atual.filter((id) => !ids.includes(id)));
              }} /></th>
              {["Razão Social", "Nome Fantasia", "CNPJ", "Tipo", "DT Fechamento", "Itens", "Faturar", "Status", "Envio do Relatório", "Relatório"].map((coluna) => <th key={coluna} className="px-4 py-3 font-semibold whitespace-nowrap">{coluna}</th>)}
            </tr>
          </thead>
          <tbody>
            {(dados?.itens ?? []).map((item) => (
              <tr key={item.id_empresa} className="border-b border-slate-100">
                <td className="px-4 py-3"><input aria-label={`Selecionar ${item.nome_fantasia || item.razao_social}`} type="checkbox" checked={marcadas.includes(item.id_empresa)} onChange={() => setMarcadas((atual) => atual.includes(item.id_empresa) ? atual.filter((id) => id !== item.id_empresa) : [...atual, item.id_empresa])} /></td>
                <td className="px-4 py-3 font-semibold">{item.razao_social}</td>
                <td className="px-4 py-3">{item.nome_fantasia}</td>
                <td className="px-4 py-3">{formatCnpj(item.cnpj)}</td>
                <td className="px-4 py-3">{item.tipo}</td>
                <td className="px-4 py-3">{item.datafechamento}</td>
                <td className="px-4 py-3">{item.itens}</td>
                <td className="px-4 py-3">{item.valor == null ? "—" : money(item.valor)}</td>
                <td className="px-4 py-3">{item.status}</td>
                <td className="px-4 py-3">{dateBr(item.envio)}</td>
                <td className="px-4 py-3"><button type="button" className="acao acao-cyan" onClick={() => setAberta(item.id_empresa)}>Relatório</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {aberta ? <RelatorioEmpresaPainel empresaId={aberta} mes={busca.mes} ano={busca.ano} onClose={() => setAberta(null)} /> : null}
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ListingFooter count={total} total={reais(meta?.totalReceber)} />
        <Button type="button" disabled={boletos.isPending} onClick={() => {
          if (window.confirm(`Gerar os boletos de ${busca.mes}/${busca.ano} no Asaas para as faturas em aberto que ainda não têm cobrança?`)) boletos.mutate();
        }}>{boletos.isPending ? "Gerando..." : "Gerar boletos do mês"}</Button>
      </div>
      {aviso ? <p className="text-sm text-slate-600">{aviso}</p> : null}
    </Screen>
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
type Holerite = { cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; candidatos: number };

function vencida(item: Procfy) {
  if (item.status !== "Aberta" || !item.vencimento) return false;
  return item.vencimento.slice(0, 10).replaceAll("/", "-") < new Date().toISOString().slice(0, 10);
}

export function RelatorioProcfyPage() {
  const mes = `${nowYear()}-${nowMonth()}`;
  const inicial = { de: mes, ate: mes, tipoData: "vencimento_fatura", sistema: "ambos", status: "0" };
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const [porPagamento, setPorPagamento] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["procfy", busca, pagina],
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
  return (
    <Screen title="Contas" subtitle="Contas a Receber DNA + DISC">
      <form onSubmit={(event) => {
        event.preventDefault();
        const filtros = lerFiltros(event, ["tipoData", "de", "ate", "status", "sistema"]);
        const status = String(new FormData(event.currentTarget).get("status") ?? "");
        filtros.status = filtros.tipoData === "data_pg" ? "1" : status;
        setBusca({ ...inicial, ...filtros });
        setPagina(1);
      }}>
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Field label="Tipo data">
          <Select name="tipoData" aria-label="Tipo data" defaultValue="vencimento_fatura" onChange={(event) => setPorPagamento(event.target.value === "data_pg")}>
            <option value="vencimento_fatura">Vencimento</option>
            <option value="data_pg">Pagamento</option>
            <option value="data_cadastro">Cadastro da cobrança</option>
          </Select>
        </Field>
        <MonthRange />
        {porPagamento ? null : (
          <Field label="Status">
            <Select name="status" aria-label="Status" defaultValue="0">
              <option value="">Selecione</option>
              <option value="0">Aberta</option>
              <option value="1">Paga</option>
              <option value="2">Cancelada</option>
            </Select>
          </Field>
        )}
        <Field label="Sistema">
          <Select name="sistema" aria-label="Sistema" defaultValue="ambos">
            <option value="ambos">Ambos</option>
            <option value="dna">DNA</option>
            <option value="disc">DISC</option>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <SearchButton />
          <ExcelButton onClick={excel} />
        </div>
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-slate-500">
            <tr className="border-b">
              {["Razão Social", "Nome Fantasia", "Tipo", "Vencimento", "Valor da Fatura", "Forma de Pagamento", "Data de Pagamento", "Status", ""].map((coluna) => <th key={coluna || "detalhe"} className="px-4 py-3 font-semibold whitespace-nowrap">{coluna}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="px-4 py-3">{item.razao_social}</td>
                <td className="px-4 py-3">{item.nome_fantasia}</td>
                <td className="px-4 py-3">{item.tipo}</td>
                <td className={`px-4 py-3 ${vencida(item) ? "font-semibold text-rose-600" : ""}`}>{dateBr(item.vencimento)}</td>
                <td className="px-4 py-3">{money(item.valor)}</td>
                <td className="px-4 py-3">{item.forma_pg}</td>
                <td className="px-4 py-3">{dateBr(item.data_pg)}</td>
                <td className="px-4 py-3">{vencida(item) ? "Vencido" : item.status}</td>
                <td className="px-4 py-3"><button type="button" className="acao acao-cyan" onClick={() => setDetalheId(item.id)}>Detalhes</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <ListingFooter count={total} total={reais(result.data?.meta?.totalReceber)} />
      {detalheId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4" role="dialog" aria-modal="true">
          <Card className="grid max-h-[90vh] w-full max-w-3xl gap-4 overflow-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{detalhe.data?.data.empresa || "Fatura"}</h2>
                <p className="text-sm text-slate-500">{detalhe.data?.data.razao}{detalhe.data?.data.cnpj ? ` · ${formatCnpj(detalhe.data.data.cnpj)}` : ""}</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setDetalheId(null)}>Fechar</Button>
            </div>
            {detalhe.isLoading ? <p className="text-sm text-slate-500">Carregando relatório...</p> : null}
            {detalhe.error instanceof Error ? <p className="text-sm text-rose-600">{detalhe.error.message}</p> : null}
            {detalhe.data ? (
              <>
                <p className="text-sm">Valor {money(detalhe.data.data.valor)}{detalhe.data.data.desconto > 0 ? ` · desconto ${money(detalhe.data.data.desconto)}` : ""}{detalhe.data.data.parcela && detalhe.data.data.parcela !== "1/1" ? ` · parcela ${detalhe.data.data.parcela}` : ""} · vencimento {dateBr(detalhe.data.data.vencimento)}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-400">
                      <tr><th className="py-2">Tipo</th><th>Candidato</th><th>Cargo</th><th>Valor</th></tr>
                    </thead>
                    <tbody>
                      {detalhe.data.data.itens.map((linha, index) => (
                        <tr key={`${linha.nome}-${index}`} className="border-t border-slate-100">
                          <td className="py-2">{linha.tipo}</td>
                          <td>{linha.nome || "Sem nome"}</td>
                          <td>{linha.cargo}</td>
                          <td>{money(linha.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detalhe.data.data.itens.length === 0 ? <p className="text-sm text-slate-500">Esta fatura não tem candidatos vinculados.</p> : null}
              </>
            ) : null}
          </Card>
        </div>
      ) : null}
    </Screen>
  );
}

function ComissaoFilters() {
  return (
    <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
      <EmpresaField />
      <Field label="Consultor">
        <Select name="consultor" aria-label="Consultor" defaultValue="todos">
          <option value="todos">Todos</option>
          <option>Fabio Base Dose</option>
          <option>Messias</option>
          <option>Scheilla Marran</option>
        </Select>
      </Field>
      <MonthField todos />
      <YearField />
      <Field label="Status">
        <Select name="status" aria-label="Status" defaultValue="">
          <option value="">Todos</option>
          <option value="0">Aberta</option>
          <option value="1">Pago</option>
        </Select>
      </Field>
      <SearchButton />
    </Card>
  );
}

export function ComissaoConsultarPage() {
  const inicial = { ano: nowYear() };
  const [paying, setPaying] = useState(false);
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["comissao", busca, pagina],
    queryFn: () => api<Comissao[]>(`/api/v1/comissao?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Comissão" subtitle="Consultar Comissão">
      <form onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "consultor", "mes", "ano", "status"]) }); setPagina(1); }}>
        <ComissaoFilters />
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={[<input key="all" aria-label="Selecionar todos" type="checkbox" />, "Nome Fantasia", "CNPJ", "Data Vencimento", "Data Pg", "Status Boleto", "Itens", "Vendedor", "Treinamento", "Faturar", "Status"]}
        rows={linhas.map((item) => ["", item.nome_fantasia, formatCnpj(item.cnpj), dateBr(item.vencimento), dateBr(item.data_pg), item.status_boleto, item.itens, item.vendedor, item.treinamento, item.valor == null ? "—" : money(item.valor), item.status])}
      />
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <ListingFooter count={total} total={reais(result.data?.meta?.totalReceber)} />
      <div><Button type="button" variant="secondary" onClick={() => setPaying(true)}>Pagar Comissão</Button></div>
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </Screen>
  );
}

export function ComissaoEmpresasPage() {
  const inicial = { ano: nowYear() };
  const [paying, setPaying] = useState(false);
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["comissao-empresas", busca, pagina],
    queryFn: () => api<ComissaoEmpresa[]>(`/api/v1/comissao/empresas?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Comissão" subtitle="Consultar Comissão Empresa">
      <form onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "consultor", "mes", "ano", "status"]) }); setPagina(1); }}>
        <ComissaoFilters />
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={[<input key="all" aria-label="Selecionar todos" type="checkbox" />, "Nome Fantasia", "Vendedor", "Data Cadastro", "1ª Contratação", "1ª Abertura de Vaga", "Tipo", "Valor", "Status"]}
        rows={linhas.map((item) => ["", item.nome_fantasia, item.vendedor, dateBr(item.data_cadastro), dateBr(item.primeira_contratacao), dateBr(item.primeira_vaga), item.tipo, item.valor == null ? "—" : money(item.valor), item.status])}
      />
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <ListingFooter count={total} total={reais(result.data?.meta?.totalReceber)} />
      <div><Button type="button" variant="secondary" onClick={() => setPaying(true)}>Pagar Comissão</Button></div>
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </Screen>
  );
}

export function GerarHoleritePage() {
  const inicial = { mes: nowMonth(), ano: nowYear() };
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["holerite", busca, pagina],
    queryFn: () => api<Holerite[]>(`/api/v1/holerite?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Holerite">
      <form onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["empresa", "mes", "ano"]) }); setPagina(1); }}>
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
        <EmpresaField />
        <MonthField />
        <YearField />
        <SearchButton />
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={["Lançar Folha", "CNPJ", "Razão Social", "Nome Fantasia", "Quant. de Candidatos"]}
        rows={linhas.map((item) => ["", formatCnpj(item.cnpj), item.razao_social, item.nome_fantasia, item.candidatos])}
      />
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <p className="text-sm font-semibold text-slate-500">{total === 0 ? "Nenhum registro encontrado" : `Mostrando 1 até ${linhas.length} de ${total} encontrados`}</p>
    </Screen>
  );
}
