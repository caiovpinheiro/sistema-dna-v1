import { useState, type ReactNode } from "react";
import { Button, Card, Field, Input, Select } from "@/components/ui";

const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const fechamentos = ["1", "10", "20", "30", "31", "5"];

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
  return <Field label="Empresa"><Input aria-label="Empresa" placeholder="Empresa" /></Field>;
}

function MonthField() {
  return (
    <Field label="Mês">
      <Select aria-label="Mês" defaultValue={nowMonth()}>
        {months.map((month) => <option key={month}>{month}</option>)}
      </Select>
    </Field>
  );
}

function YearField() {
  return <Field label="Ano"><Input aria-label="Ano" defaultValue={nowYear()} inputMode="numeric" /></Field>;
}

function MonthRange() {
  const value = `${nowYear()}-${nowMonth()}`;
  return (
    <>
      <Field label="De Início"><Input aria-label="De Início" type="month" defaultValue={value} /></Field>
      <Field label="Até"><Input aria-label="Até" type="month" defaultValue={value} /></Field>
    </>
  );
}

function SearchButton() {
  return <Button type="button" variant="secondary" className="self-end">Pesquisar</Button>;
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

export function GerarFaturamentoPage() {
  return (
    <Screen title="Faturamento" subtitle="Gerar Faturamento">
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
        <EmpresaField />
        <Field label="Faturamento">
          <Select aria-label="Faturamento" defaultValue="">
            <option value="">Selecione</option>
            {fechamentos.map((day) => <option key={day}>{day}</option>)}
          </Select>
        </Field>
        <MonthField />
        <YearField />
        <Field label="Status">
          <Select aria-label="Status" defaultValue="3">
            <option value="">Todos</option>
            <option value="0">Aberta</option>
            <option value="3">Aberta e Parcial</option>
            <option value="2">Parcial</option>
            <option value="1">Faturado</option>
          </Select>
        </Field>
        <SearchButton />
      </Card>
      <div className="grid gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Matriz (Sem candidatos) com faturamento de filiais agrupado</h2>
        <DataTable
          columns={["Razão Social", "Nome Fantasia", "CNPJ", "DT Fechamento", "Status"]}
          rows={[]}
        />
      </div>
      <DataTable
        columns={["Razão Social", "Nome Fantasia", "CNPJ", "Tipo", "DT Fechamento", "Itens", "Faturar", "Status", "Envio do Relatório"]}
        rows={[]}
      />
      <ListingFooter count={0} total="R$ 0,00" />
    </Screen>
  );
}

export function RelatorioProcfyPage() {
  return (
    <Screen title="Contas" subtitle="Contas a Receber DNA + DISC">
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Field label="Tipo data">
          <Select aria-label="Tipo data" defaultValue="vencimento_fatura">
            <option value="vencimento_fatura">Vencimento</option>
            <option value="data_pg">Pagamento</option>
            <option value="data_cadastro">Cadastro da cobrança</option>
          </Select>
        </Field>
        <MonthRange />
        <Field label="Status">
          <Select aria-label="Status" defaultValue="0">
            <option value="">Selecione</option>
            <option value="0">Aberta</option>
            <option value="1">Paga</option>
            <option value="2">Cancelada</option>
          </Select>
        </Field>
        <Field label="Sistema">
          <Select aria-label="Sistema" defaultValue="ambos">
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
      <DataTable
        columns={["Razão Social", "Nome Fantasia", "Tipo", "Vencimento", "Valor da Fatura", "Forma de Pagamento", "Data de Pagamento", "Status", "Detalhes"]}
        rows={[]}
      />
      <ListingFooter count={0} total="R$ 0,00" />
    </Screen>
  );
}

function ComissaoFilters() {
  return (
    <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-6">
      <EmpresaField />
      <Field label="Consultor">
        <Select aria-label="Consultor" defaultValue="todos">
          <option value="todos">Todos</option>
          <option>Fabio Base Dose</option>
          <option>Messias</option>
          <option>Scheilla Marran</option>
        </Select>
      </Field>
      <MonthField />
      <YearField />
      <Field label="Status">
        <Select aria-label="Status" defaultValue="">
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
  const [paying, setPaying] = useState(false);
  return (
    <Screen title="Comissão" subtitle="Consultar Comissão">
      <ComissaoFilters />
      <DataTable
        columns={[<input key="all" aria-label="Selecionar todos" type="checkbox" />, "Nome Fantasia", "CNPJ", "Data Vencimento", "Data Pg", "Status Boleto", "Itens", "Vendedor", "Treinamento", "Faturar", "Status"]}
        rows={[]}
      />
      <ListingFooter count={0} total="R$ 0,00" />
      <div><Button type="button" variant="secondary" onClick={() => setPaying(true)}>Pagar Comissão</Button></div>
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </Screen>
  );
}

export function ComissaoEmpresasPage() {
  const [paying, setPaying] = useState(false);
  return (
    <Screen title="Comissão" subtitle="Consultar Comissão Empresa">
      <ComissaoFilters />
      <DataTable
        columns={[<input key="all" aria-label="Selecionar todos" type="checkbox" />, "Nome Fantasia", "Vendedor", "Data Cadastro", "1ª Contratação", "1ª Abertura de Vaga", "Tipo", "Valor", "Status"]}
        rows={[]}
      />
      <ListingFooter count={0} total="R$ 0,00" />
      <div><Button type="button" variant="secondary" onClick={() => setPaying(true)}>Pagar Comissão</Button></div>
      <PayDialog open={paying} onClose={() => setPaying(false)} />
    </Screen>
  );
}

export function GerarHoleritePage() {
  return (
    <Screen title="Holerite">
      <Card className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-4">
        <EmpresaField />
        <MonthField />
        <YearField />
        <SearchButton />
      </Card>
      <DataTable
        columns={["Lançar Folha", "CNPJ", "Razão Social", "Nome Fantasia", "Quant. de Candidatos"]}
        rows={[]}
      />
      <p className="text-sm font-semibold text-slate-500">Nenhum registro encontrado</p>
    </Screen>
  );
}
