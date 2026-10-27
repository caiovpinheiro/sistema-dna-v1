import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Paginacao } from "@/components/paginacao";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCnpj } from "@/lib/format";

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

function ListingFooter({ total, visiveis }: { total: number; visiveis?: number }) {
  const ate = visiveis ?? total;
  return <p className="text-sm text-slate-500">{total === 0 ? "Nenhum registro encontrado" : `Mostrando 1 até ${ate} de ${total}`}</p>;
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

function Consulta({ carregando, erro }: { carregando: boolean; erro: unknown }) {
  if (carregando) return <p className="text-sm text-slate-500">Carregando...</p>;
  if (erro instanceof Error) return <p className="text-sm text-red-600">{erro.message}</p>;
  return null;
}

const documentos = [
  "Acordo de cooperação do ensino superior",
  "Aditivo mudança data de início",
  "Aditivo mudança de horário",
  "Aditivo mudança de salário",
  "Aditivo mudança de supervisor",
  "Cabeçalho relatorio ensino médio automatico",
  "Cabeçalho relatorio ensino superior automatico",
  "Contrato prestação de serviços CLT",
  "Contrato prestação de serviços de estágio com treinamento",
  "Contrato prestação de serviços de estágio sem treinamento",
  "Declaração de estágio ensino médio",
  "Minuta Convênio Empresa - Software",
  "Minuta Convênio Empresa Software - DISC",
  "Minuta de ciência do estagiário",
  "Realização estágio do ensino médio",
  "Realização estágio do ensino superior",
  "Relatório de atividades do ensino médio",
  "Relatório de atividades do ensino superior",
  "Rescisão estágio ensino médio",
  "Rescisão estágio ensino superior",
  "Termo aditivo ensino médio",
  "Termo aditivo ensino superior",
  "Termo de compromisso de estágio",
];

type Documento = { nome: string | null; assinatura: string | null; vencimento: string | null; atraso: number; datainicio: string | null; modalidade: string | null; documento: string | null; empresa: string | null; status: string | null; instrucao: string | null };

export function DocumentosPendentesPage() {
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["documentos-pendentes", busca, pagina],
    queryFn: () => api<Documento[]>(`/api/v1/documentos-pendentes?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: "20" })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Relatório" subtitle="Documento Pendente">
      <form onSubmit={(event) => { event.preventDefault(); setBusca(lerFiltros(event, ["modalidade", "empresa", "documento", "candidato", "de", "ate"])); setPagina(1); }}>
      <Card className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        <Field label="Modalidade da Vaga">
          <Select name="modalidade" aria-label="Modalidade da Vaga" defaultValue="Todos">
            <option>Todos</option>
            <option>CLT</option>
            <option>Estágio</option>
            <option>Pessoa Juridica</option>
          </Select>
        </Field>
        <Field label="Empresa"><Input name="empresa" aria-label="Empresa" /></Field>
        <Field label="Documento">
          <Select name="documento" aria-label="Documento" defaultValue="Todos">
            <option>Todos</option>
            {documentos.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Candidato"><Input name="candidato" aria-label="Candidato" /></Field>
        <Field label="Data De"><Input name="de" aria-label="Data De" type="date" /></Field>
        <Field label="Data Até"><Input name="ate" aria-label="Data Até" type="date" /></Field>
        <Button type="submit" variant="secondary" className="self-end">Pesquisar</Button>
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={["Nome", "Tipo de Assinatura", "Data Vencimento", "Dias Atraso", "Data Início", "Modalidade da Vaga", "Documento", "Empresa", "Status", "Instruções", "Instruções"]}
        rows={linhas.map((item) => [item.nome, item.assinatura, dateBr(item.vencimento), item.atraso, dateBr(item.datainicio), item.modalidade, item.documento, item.empresa, item.status, item.instrucao, ""])}
      />
      <Paginacao pagina={pagina} tamanho={20} total={total} onPagina={setPagina} />
      <ListingFooter total={total} visiveis={linhas.length} />
    </Screen>
  );
}

type Modelo = { id_modelo: number; nome: string | null; cargo: string | null; tipo: string | null };

export function ConsultarModelosPage() {
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["modelos", busca, pagina],
    queryFn: () => api<Modelo[]>(`/api/v1/modelos?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: "50" })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="Buscar" subtitle="Modelo de Vaga">
      <form onSubmit={(event) => { event.preventDefault(); setBusca(lerFiltros(event, ["nome", "cargo", "modalidade"])); setPagina(1); }}>
      <Card className="grid gap-4 md:grid-cols-4">
        <Field label="Nome"><Input name="nome" aria-label="Nome" /></Field>
        <Field label="Cargo da Vaga"><Input name="cargo" aria-label="Cargo da Vaga" placeholder="Cargo" /></Field>
        <Field label="Modalidade">
          <Select name="modalidade" aria-label="Modalidade" defaultValue="Todos">
            <option>Todos</option>
            <option>CLT</option>
            <option>Estágio</option>
            <option>Pessoa Juridica</option>
          </Select>
        </Field>
        <Button type="submit" variant="secondary" className="self-end">Pesquisar</Button>
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={["Nome", "Cargo", "Tipo de vaga", "Abrir Vaga"]}
        rows={linhas.map((item) => [item.nome, item.cargo, item.tipo, "Abrir"])}
      />
      <Paginacao pagina={pagina} tamanho={50} total={total} onPagina={setPagina} />
      <ListingFooter total={total} visiveis={linhas.length} />
    </Screen>
  );
}

export function CadastrarModeloPage() {
  return (
    <Screen title="Cadastrar" subtitle="Modelo de Vaga">
      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="Nome">
          <Input aria-label="Nome" placeholder="Identificação do modelo EX: Modelo de Operador de caixa Estágio" />
        </Field>
        <Field label="Tipo de Vaga">
          <Select aria-label="Tipo de Vaga" defaultValue="">
            <option value="">Selecione</option>
            <option>CLT</option>
            <option>Estágio</option>
            <option>Pessoa Juridica</option>
          </Select>
        </Field>
        <Field label="Cargo"><Input aria-label="Cargo" placeholder="Ex: Operador de Telemarketing" /></Field>
        <Field label="Nível">
          <Select aria-label="Nível" defaultValue="">
            <option value="">Selecione</option>
            <option>Júnior</option>
            <option>Pleno</option>
            <option>Sênior</option>
          </Select>
        </Field>
        <Field label="Tempo Experiência">
          <Select aria-label="Tempo Experiência" defaultValue="">
            <option value="">Selecione</option>
            <option>Sem Experiência</option>
            <option>6 meses a 1 ano</option>
            <option>1 a 3 anos</option>
            <option>3 a 5 anos</option>
            <option>Acima 5 anos</option>
          </Select>
        </Field>
        <Field label="Bolsa Auxilio">
          <Input aria-label="Bolsa Auxilio" placeholder="1.000,00" />
          <p className="text-xs text-slate-500">Salário que deseja pagar / Bolsa Auxilio que deseja pagar</p>
        </Field>
        <Field label="Tipo de Remuneração">
          <Select aria-label="Tipo de Remuneração" defaultValue="">
            <option value="">Selecione</option>
            <option>Mensal</option>
            <option>Comissionista Puro (Mínimo Garantido)</option>
            <option>Comissionista Misto (Fixo + Comissão)</option>
            <option>Por Hora</option>
          </Select>
        </Field>
        <Field label="Distância"><Input aria-label="Distância" type="number" defaultValue={30} placeholder="Ex: 30" /></Field>
        <Field label="Atividades do Candidato"><Textarea aria-label="Atividades do Candidato" /></Field>
        <Field label="Atividades do Candidato no Contrato"><Textarea aria-label="Atividades do Candidato no Contrato" /></Field>
        <Field label="Requisitos Desejáveis"><Textarea aria-label="Requisitos Desejáveis" placeholder="Ex: Proativo, boa dicção, postura profissional" /></Field>
        <Field label="Destaques da Vaga"><Textarea aria-label="Destaques da Vaga" /></Field>
        <Field label="Idade De"><Input aria-label="Idade De" placeholder="Ex: 16" /></Field>
        <Field label="Até"><Input aria-label="Até" placeholder="Ex: 44" /></Field>
        <Field label="Sexo">
          <Select aria-label="Sexo" defaultValue="">
            <option value="">Selecione</option>
            <option>Ambos</option>
            <option>Masculino</option>
            <option>Feminino</option>
          </Select>
        </Field>
        <Field label="Formação">
          <Select aria-label="Formação" defaultValue="">
            <option value="">Selecione</option>
            <option>Ensino Médio</option>
            <option>Superior</option>
            <option>Supletivo</option>
            <option>Técnico</option>
          </Select>
        </Field>
        <Field label="Situação">
          <Select aria-label="Situação" defaultValue="">
            <option value="">Selecione</option>
            <option>Concluído</option>
            <option>Cursando</option>
            <option>Trancado</option>
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Button type="button">Salvar</Button>
        </div>
      </Card>
    </Screen>
  );
}

type Instituicao = { conveniada: string | null; data_inicio: string | null; data_termino: string | null; tipo_encino: string | null; parece: string | null; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; bairro: string | null; cidade: string | null; uf: string | null };

export function ConsultarInstituicoesPage() {
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  const result = useQuery({
    queryKey: ["instituicoes", busca, pagina],
    queryFn: () => api<Instituicao[]>(`/api/v1/instituicoes?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: "20" })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  return (
    <Screen title="buscar" subtitle="Instituição">
      <form onSubmit={(event) => { event.preventDefault(); setBusca(lerFiltros(event, ["q", "ensino", "conveniada", "cidade", "uf"])); setPagina(1); }}>
      <Card className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Buscar">
          <Input name="q" aria-label="Buscar" placeholder="Ex: Nome da faculdade" />
          <p className="text-xs text-slate-500">Pesquisar por: Razão Social, Nome Fantasia, CNPJ, Telefone, E-mail</p>
        </Field>
        <Field label="Tipo Ensino">
          <Select name="ensino" aria-label="Tipo Ensino" defaultValue="Todos">
            <option>Todos</option>
            <option>Ensino Médio</option>
            <option>Ensino Superior</option>
            <option>Ensino Supletivo</option>
            <option>Ensino Técnico</option>
          </Select>
        </Field>
        <Field label="Conveniada">
          <Select name="conveniada" aria-label="Conveniada" defaultValue="Todas">
            <option>Todas</option>
            <option>Sim</option>
            <option>Não</option>
          </Select>
        </Field>
        <Field label="Cidade"><Input name="cidade" aria-label="Cidade" placeholder="Ex: Nome da cidade" /></Field>
        <Field label="UF"><Input name="uf" aria-label="UF" placeholder="Ex: Sigla do estado" /></Field>
        <Button type="submit" variant="secondary" className="self-end">Pesquisar</Button>
      </Card>
      </form>
      <Consulta carregando={result.isLoading} erro={result.error} />
      <DataTable
        columns={["Conveniada", "Início do Convênio", "Término do Convênio", "Tipo Ensino", "Experiência", "CNPJ / INEP", "Razão Social", "Nome Fantasia", "Bairro", "Cidade", "Estado"]}
        rows={linhas.map((item) => [item.conveniada === "1" ? "Sim" : "Não", dateBr(item.data_inicio), item.conveniada === "1" && !item.data_termino ? "Indeterminada" : dateBr(item.data_termino), item.tipo_encino, "★".repeat(Number(item.parece) || 0), formatCnpj(item.cnpj), item.razao_social, item.nome_fantasia, item.bairro, item.cidade, item.uf])}
      />
      <Paginacao pagina={pagina} tamanho={20} total={total} onPagina={setPagina} />
      <ListingFooter total={total} visiveis={linhas.length} />
    </Screen>
  );
}

export function CadastrarInstituicaoPage() {
  return (
    <Screen title="Cadastrar Instituição de ensino" subtitle="Dados Cadastrais">
      <Card className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Tipo Ensino">
          <Select aria-label="Tipo Ensino" defaultValue="Ensino Médio">
            <option>Ensino Médio</option>
            <option>Ensino Superior</option>
            <option>Ensino Supletivo</option>
            <option>Ensino Técnico</option>
          </Select>
        </Field>
        <Field label="Tipo Instituição">
          <Select aria-label="Tipo Instituição" defaultValue="">
            <option value="">Selecione</option>
            <option>Particular</option>
            <option>Pública</option>
          </Select>
        </Field>
        <Field label="CNPJ / INEP"><Input aria-label="CNPJ / INEP" /></Field>
        <Field label="IE / IM"><Input aria-label="IE / IM" /></Field>
        <Field label="Mantenedora"><Input aria-label="Mantenedora" /></Field>
        <Field label="Razão Social"><Input aria-label="Razão Social" /></Field>
        <Field label="Nome Fantasia"><Input aria-label="Nome Fantasia" /></Field>
        <Field label="Diretor"><Input aria-label="Diretor" /></Field>
        <Field label="CPF Diretor"><Input aria-label="CPF Diretor" /></Field>
        <Field label="RG Diretor"><Input aria-label="RG Diretor" /></Field>
        <Field label="Diretor E-mail"><Input aria-label="Diretor E-mail" type="email" /></Field>
        <Field label="Representante Legal"><Input aria-label="Representante Legal" /></Field>
        <Field label="Representante Legal CPF"><Input aria-label="Representante Legal CPF" /></Field>
        <Field label="Cargo Representante Legal"><Input aria-label="Cargo Representante Legal" /></Field>
        <Field label="Representante E-mail"><Input aria-label="Representante E-mail" type="email" /></Field>
        <Field label="Telefone"><Input aria-label="Telefone" /></Field>
        <Field label="Telefone"><Input aria-label="Segundo telefone" /></Field>
        <Field label="E-mail"><Input aria-label="E-mail" type="email" /></Field>
        <Field label="Cep"><Input aria-label="Cep" /></Field>
        <Field label="Rua"><Input aria-label="Rua" /></Field>
        <Field label="Número"><Input aria-label="Número" /></Field>
        <Field label="Complemento"><Input aria-label="Complemento" /></Field>
        <Field label="Bairro"><Input aria-label="Bairro" /></Field>
        <Field label="Cidade"><Input aria-label="Cidade" /></Field>
        <Field label="Estado (Sigla)"><Input aria-label="Estado" /></Field>
        <Field label="Latitude"><Input aria-label="Latitude" /></Field>
        <Field label="Longitude"><Input aria-label="Longitude" /></Field>
        <div className="md:col-span-2 xl:col-span-3">
          <Button type="button">Salvar</Button>
        </div>
      </Card>
    </Screen>
  );
}
