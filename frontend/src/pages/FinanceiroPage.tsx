import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Paginacao } from "@/components/paginacao";
import { Button, Card, Field, Input, Select } from "@/components/ui";
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
  const ate = `${nowYear()}-${nowMonth()}`;
  const de = `${nowYear()}-01`;
  return (
    <>
      <Field label="De Início"><Input name="de" aria-label="De Início" type="month" defaultValue={de} /></Field>
      <Field label="Até"><Input name="ate" aria-label="Até" type="month" defaultValue={ate} /></Field>
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

function ExcelButton() {
  return <Button type="button" variant="secondary" className="self-end">Gerar excel</Button>;
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
  const inicial = { mes: nowMonth(), ano: nowYear(), status: "3" };
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["faturamento", busca, pagina],
    queryFn: () => api<{ matriz: Array<{ razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; datafechamento: string | null; status: string }>; itens: Array<{ razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; tipo: string | null; datafechamento: string | null; itens: number; valor: number | null; status: string; envio: string | null }> }>(`/api/v1/faturamento?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const dados = result.data?.data;
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Faturamento" subtitle="Gerar Faturamento">
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
      <DataTable
        columns={["Razão Social", "Nome Fantasia", "CNPJ", "Tipo", "DT Fechamento", "Itens", "Faturar", "Status", "Envio do Relatório"]}
        rows={(dados?.itens ?? []).map((item) => [item.razao_social, item.nome_fantasia, formatCnpj(item.cnpj), item.tipo, item.datafechamento, item.itens, item.valor == null ? "—" : money(item.valor), item.status, dateBr(item.envio)])}
      />
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <ListingFooter count={total} total={reais(result.data?.meta?.totalReceber)} />
    </Screen>
  );
}

type Procfy = { razao_social: string | null; nome_fantasia: string | null; tipo: string | null; vencimento: string | null; valor: number | null; forma_pg: string | null; data_pg: string | null; status: string };
type Comissao = { nome_fantasia: string | null; cnpj: string | null; vencimento: string | null; data_pg: string | null; status_boleto: string; itens: number; vendedor: string | null; treinamento: string | null; valor: number | null; status: string };
type ComissaoEmpresa = { nome_fantasia: string | null; vendedor: string | null; data_cadastro: string | null; primeira_contratacao: string | null; primeira_vaga: string | null; tipo: string | null; valor: number | null; status: string };
type Holerite = { cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; candidatos: number };

export function RelatorioProcfyPage() {
  const inicial = { de: `${nowYear()}-01`, ate: `${nowYear()}-${nowMonth()}`, tipoData: "vencimento_fatura", sistema: "ambos" };
  const [busca, setBusca] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["procfy", busca, pagina],
    queryFn: () => api<Procfy[]>(`/api/v1/procfy?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: String(TAMANHO) })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Contas" subtitle="Contas a Receber DNA + DISC">
      <form onSubmit={(event) => { event.preventDefault(); setBusca({ ...inicial, ...lerFiltros(event, ["tipoData", "de", "ate", "status", "sistema"]) }); setPagina(1); }}>
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Field label="Tipo data">
          <Select name="tipoData" aria-label="Tipo data" defaultValue="vencimento_fatura">
            <option value="vencimento_fatura">Vencimento</option>
            <option value="data_pg">Pagamento</option>
            <option value="data_cadastro">Cadastro da cobrança</option>
          </Select>
        </Field>
        <MonthRange />
        <Field label="Status">
          <Select name="status" aria-label="Status" defaultValue="">
            <option value="">Selecione</option>
            <option value="0">Aberta</option>
            <option value="1">Paga</option>
            <option value="2">Cancelada</option>
          </Select>
        </Field>
        <Field label="Sistema">
          <Select name="sistema" aria-label="Sistema" defaultValue="ambos">
            <option value="ambos">Ambos</option>
            <option value="dna">DNA</option>
            <option value="disc">DISC</option>
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <SearchButton />
          <ExcelButton />
        </div>
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={["Razão Social", "Nome Fantasia", "Tipo", "Vencimento", "Valor da Fatura", "Forma de Pagamento", "Data de Pagamento", "Status", "Detalhes"]}
        rows={linhas.map((item) => [item.razao_social, item.nome_fantasia, item.tipo, dateBr(item.vencimento), item.valor == null ? "—" : money(item.valor), item.forma_pg, dateBr(item.data_pg), item.status, "DNA"])}
      />
      <Paginacao pagina={pagina} tamanho={TAMANHO} total={total} onPagina={setPagina} />
      <ListingFooter count={total} total={reais(result.data?.meta?.totalReceber)} />
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
