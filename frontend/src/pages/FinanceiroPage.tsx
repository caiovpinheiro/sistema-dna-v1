import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const relatorio = useQuery({
    queryKey: ["faturamento-relatorio", aberta, busca.mes, busca.ano],
    queryFn: () => api<{ empresa: string | null; cnpj: string | null; email: string | null; total: number; itens: Array<{ nome: string | null; cargo: string | null; modalidade: string | null; inicio: string | null; situacao: string; valor: number }> }>(`/api/v1/faturamento/relatorio?${new URLSearchParams({ empresa: aberta ?? "", mes: busca.mes, ano: busca.ano })}`),
    enabled: Boolean(aberta),
  });
  const enviar = useMutation({
    mutationFn: (empresas: string[]) => api<{ enviados: number; falhas: Array<{ empresa: string | null; motivo: string }> }>("/api/v1/faturamento/relatorios", {
      method: "POST",
      body: JSON.stringify({ empresas, mes: busca.mes, ano: busca.ano }),
    }),
    onSuccess: async (resposta) => {
      setAviso(`${resposta.data.enviados} relatório(s) enviado(s)${resposta.data.falhas.length ? `. ${resposta.data.falhas.length} não saíram.` : "."}`);
      setMarcadas([]);
      await client.invalidateQueries({ queryKey: ["faturamento"] });
    },
    onError: (error: Error) => setAviso(error.message),
  });
  async function enviarLote(ids: string[]) {
    setProgresso({ feito: 0, total: ids.length });
    setAviso("");
    let enviados = 0;
    let falhas = 0;
    for (const id of ids) {
      try {
        const resposta = await api<{ enviados: number; falhas: Array<{ empresa: string | null; motivo: string }> }>("/api/v1/faturamento/relatorios", {
          method: "POST",
          body: JSON.stringify({ empresas: [id], mes: busca.mes, ano: busca.ano }),
        });
        enviados += resposta.data.enviados;
        falhas += resposta.data.falhas.length;
      } catch {
        falhas += 1;
      }
      setProgresso((atual) => atual ? { feito: atual.feito + 1, total: atual.total } : null);
    }
    setProgresso(null);
    setMarcadas([]);
    setAviso(`${enviados} relatório(s) e boleto(s) enviado(s)${falhas ? `. ${falhas} não saíram.` : "."}`);
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
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-slate-500">
            <tr className="border-b">
              <th className="px-4 py-3"><input aria-label="Selecionar página" type="checkbox" checked={Boolean(dados?.itens.length) && (dados?.itens.every((item) => marcadas.includes(item.id_empresa)) ?? false)} onChange={(event) => {
                const ids = dados?.itens.map((item) => item.id_empresa) ?? [];
                setMarcadas((atual) => event.target.checked ? [...new Set([...atual, ...ids])] : atual.filter((id) => !ids.includes(id)));
              }} /></th>
              {["Razão Social", "Nome Fantasia", "CNPJ", "Tipo", "DT Fechamento", "Itens", "Faturar", "Status", "Envio do Relatório"].map((coluna) => <th key={coluna} className="px-4 py-3 font-semibold whitespace-nowrap">{coluna}</th>)}
            </tr>
          </thead>
          <tbody>
            {(dados?.itens ?? []).map((item) => (
              <tr key={item.id_empresa} className="border-b border-slate-100">
                <td className="px-4 py-3"><input aria-label={`Selecionar ${item.nome_fantasia || item.razao_social}`} type="checkbox" checked={marcadas.includes(item.id_empresa)} onChange={() => setMarcadas((atual) => atual.includes(item.id_empresa) ? atual.filter((id) => id !== item.id_empresa) : [...atual, item.id_empresa])} /></td>
                <td className="px-4 py-3"><button type="button" className="font-semibold text-cyan-800" onClick={() => setAberta(item.id_empresa)}>{item.razao_social}</button></td>
                <td className="px-4 py-3">{item.nome_fantasia}</td>
                <td className="px-4 py-3">{formatCnpj(item.cnpj)}</td>
                <td className="px-4 py-3">{item.tipo}</td>
                <td className="px-4 py-3">{item.datafechamento}</td>
                <td className="px-4 py-3">{item.itens}</td>
                <td className="px-4 py-3">{item.valor == null ? "—" : money(item.valor)}</td>
                <td className="px-4 py-3">{item.status}</td>
                <td className="px-4 py-3">{dateBr(item.envio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {aberta ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{relatorio.data?.data.empresa || "Relatório"}</h2>
              <p className="text-xs text-slate-500">{relatorio.data?.data.email || "Sem e-mail financeiro"}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" disabled={enviar.isPending} onClick={() => enviar.mutate([aberta])}>Enviar este relatório</Button>
              <Button type="button" variant="secondary" onClick={() => setAberta(null)}>Fechar</Button>
            </div>
          </div>
          {relatorio.isLoading ? <p className="text-sm text-slate-500">Carregando relatório...</p> : (
            <div className="grid gap-2 text-sm">
              {(relatorio.data?.data.itens ?? []).map((linha, index) => (
                <p key={`${linha.nome}-${index}`}><strong>{linha.nome || "Sem nome"}</strong> · {linha.cargo} · {linha.modalidade} · {linha.situacao} · {money(linha.valor)}</p>
              ))}
              <p className="font-semibold">Total {money(relatorio.data?.data.total)}</p>
            </div>
          )}
        </Card>
      ) : null}
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
