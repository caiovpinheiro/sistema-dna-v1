import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Paginacao } from "@/components/paginacao";
import { Alerta, CabecalhoPagina, CampoFiltro, ResumoResultados } from "@/components/pagina";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, money, textoPlano } from "@/lib/format";

/** Moldura das telas antigas que ainda não têm ação no cabeçalho (só o formulário estático de modelo). */
function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="grid gap-5">
      <CabecalhoPagina titulo={title} descricao={subtitle} />
      {children}
    </div>
  );
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

/** "Todos"/"Todas" nos selects é o mesmo que não filtrar: não conta para o "Limpar filtros". */
function temFiltro(busca: Record<string, string>) {
  return Object.values(busca).some((valor) => valor && valor !== "Todos" && valor !== "Todas");
}

/** Título de seção dos formulários e fichas, com uma frase do que vai nela. */
function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 md:p-5">
      <header>
        <h2 className="text-[15px] font-bold text-navy-900">{titulo}</h2>
        {texto ? <p className="text-sm text-slate-500">{texto}</p> : null}
      </header>
      {children}
    </Card>
  );
}

/** Grade de 6 colunas: campos curtos (UF, número) ocupam 1, longos (nome, endereço) 3 ou 4. */
function Grade({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-6">{children}</div>;
}

function Celula({ span, children }: { span: 1 | 2 | 3 | 4 | 6; children: ReactNode }) {
  const largura = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" }[span];
  return <div className={largura}>{children}</div>;
}

function BuscaComIcone({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      {children}
    </div>
  );
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

/** Vínculo do candidato: Ativo e Encerrado em selo; outro valor aparece como veio. */
function Vinculo({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400">—</span>;
  const valor = status === "Ativo" ? "ativa" : status === "Encerrado" ? "encerrada" : undefined;
  return <Badge value={valor}>{status}</Badge>;
}

function Atraso({ dias }: { dias: number }) {
  if (!dias || dias <= 0) return <span className="text-sm text-slate-500">No prazo</span>;
  return <span className="font-semibold tabular-nums text-rose-700">{dias === 1 ? "1 dia" : `${dias.toLocaleString("pt-BR")} dias`}</span>;
}

export function DocumentosPendentesPage() {
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  // Muda ao limpar os filtros, para os campos (não controlados) voltarem ao vazio.
  const [versao, setVersao] = useState(0);
  const result = useQuery({
    queryKey: ["documentos-pendentes", busca, pagina],
    queryFn: () => api<Documento[]>(`/api/v1/documentos-pendentes?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: "20" })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  const filtrando = temFiltro(busca);
  function limpar() {
    setBusca({});
    setPagina(1);
    setVersao((atual) => atual + 1);
  }
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Documentos pendentes"
        descricao="Documentos gerados para candidatos que ainda não voltaram assinados, do vencimento mais antigo para o mais novo."
      />
      <Card>
        <form
          key={versao}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_9.5rem_9.5rem_auto] xl:items-end"
          onSubmit={(event) => { event.preventDefault(); setBusca(lerFiltros(event, ["modalidade", "empresa", "documento", "candidato", "de", "ate"])); setPagina(1); }}
        >
          <CampoFiltro rotulo="Modalidade da vaga">
            <Select name="modalidade" aria-label="Modalidade da vaga" defaultValue="Todos">
              <option value="Todos">Todas</option>
              <option value="CLT">CLT</option>
              <option value="Estágio">Estágio</option>
              <option value="Pessoa Juridica">Pessoa jurídica</option>
            </Select>
          </CampoFiltro>
          <CampoFiltro rotulo="Empresa">
            <Input name="empresa" aria-label="Empresa" placeholder="Todas" />
          </CampoFiltro>
          <CampoFiltro rotulo="Documento">
            <Select name="documento" aria-label="Documento" defaultValue="Todos">
              <option value="Todos">Todos</option>
              {documentos.map((item) => <option key={item}>{item}</option>)}
            </Select>
          </CampoFiltro>
          <CampoFiltro rotulo="Candidato">
            <BuscaComIcone><Input name="candidato" aria-label="Candidato" placeholder="Nome do candidato" className="pl-9" /></BuscaComIcone>
          </CampoFiltro>
          <CampoFiltro rotulo="Vencimento de">
            <Input name="de" aria-label="Vencimento de" type="date" />
          </CampoFiltro>
          <CampoFiltro rotulo="Vencimento até">
            <Input name="ate" aria-label="Vencimento até" type="date" />
          </CampoFiltro>
          <Button type="submit" className="h-10 sm:col-span-2 lg:col-span-1"><Search size={16} /> Pesquisar</Button>
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : total} singular="documento pendente" plural="documentos pendentes" filtrando={filtrando} carregando={result.isLoading} onLimpar={limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>Não foi possível listar os documentos pendentes. {result.error instanceof Error ? result.error.message : ""}</Alerta>
      ) : linhas.length || total > 0 ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Candidato</th>
                  <th>Documento</th>
                  <th>Empresa</th>
                  <th>Início</th>
                  <th>Vencimento</th>
                  <th className="text-right">Atraso</th>
                  <th>Vínculo</th>
                  <th>Instruções da empresa</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((item, indice) => {
                  const instrucao = textoPlano(item.instrucao);
                  return (
                    <tr key={indice}>
                      <td className="max-w-56">
                        <p className="truncate font-semibold text-navy-900">{textoPlano(item.nome) || "—"}</p>
                        <p className="text-xs text-slate-500">Assinatura {(item.assinatura ?? "—").toLowerCase()}</p>
                      </td>
                      <td className="max-w-64"><p className="line-clamp-2 text-slate-700">{item.documento ?? "—"}</p></td>
                      <td className="max-w-56">
                        <p className="truncate text-slate-700">{textoPlano(item.empresa) || "—"}</p>
                        {item.modalidade ? <p className="text-xs text-slate-500">{item.modalidade}</p> : null}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(item.datainicio)}</td>
                      <td className="whitespace-nowrap tabular-nums text-slate-700">{dateBr(item.vencimento)}</td>
                      <td className="whitespace-nowrap text-right"><Atraso dias={item.atraso} /></td>
                      <td className="whitespace-nowrap"><Vinculo status={item.status} /></td>
                      <td className="max-w-64">{instrucao ? <p className="line-clamp-2 text-xs text-slate-600" title={instrucao}>{instrucao}</p> : <span className="text-slate-400">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden">
            {linhas.map((item, indice) => (
              <li key={indice} className="grid gap-2 border-t border-slate-100 px-4 py-3 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">{textoPlano(item.nome) || "—"}</p>
                    <p className="text-sm text-slate-700">{item.documento ?? "—"}</p>
                    <p className="text-xs text-slate-500">{[textoPlano(item.empresa), item.modalidade].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Vinculo status={item.status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-slate-500">Vencimento</dt><dd className="tabular-nums text-slate-700">{dateBr(item.vencimento)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Atraso</dt><dd><Atraso dias={item.atraso} /></dd></div>
                  <div><dt className="text-xs text-slate-500">Início</dt><dd className="tabular-nums text-slate-700">{dateBr(item.datainicio)}</dd></div>
                  <div><dt className="text-xs text-slate-500">Assinatura</dt><dd className="text-slate-700">{item.assinatura ?? "—"}</dd></div>
                  {item.instrucao ? <div className="col-span-2 sm:col-span-4"><dt className="text-xs text-slate-500">Instruções da empresa</dt><dd className="text-slate-700">{textoPlano(item.instrucao)}</dd></div> : null}
                </dl>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={20} total={total} onPagina={setPagina} />
          </div>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhum documento pendente com esses filtros" text="Confira o nome digitado ou o período, ou limpe os filtros para ver todos." />
      ) : <Empty title="Nenhum documento pendente" text="Todos os documentos gerados para candidatos já voltaram assinados." />}
    </div>
  );
}

type ModeloConsulta = { vaga_id: string; cargo: string; tipo_vaga: string; salario: string; carga_horaria: string; horario: string };

function normalizarBusca(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** O servidor manda o salário no formato do sistema antigo ("2600,00" ou "2.600,00"). */
function salarioDoModelo(valor: string) {
  const limpo = valor.replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const numero = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

/** "Segunda a sexta, 08:00 às 17:00; sábado por escala, …" vira uma linha por grupo de dias. */
function linhasDoHorario(horario: string) {
  return horario.split(";").map((parte) => parte.trim()).filter(Boolean).map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1));
}

function Horario({ texto }: { texto: string }) {
  const linhas = linhasDoHorario(texto || "");
  if (!linhas.length) return <span className="text-slate-400">—</span>;
  return (
    <div className="grid gap-0.5">
      {linhas.map((linha) => <span key={linha} className="whitespace-nowrap text-slate-700">{linha}</span>)}
    </div>
  );
}

function Carga({ horas }: { horas: string }) {
  if (!horas) return <span className="text-slate-400">—</span>;
  return <span className="whitespace-nowrap tabular-nums text-slate-700">{horas} h <span className="text-xs text-slate-500">por semana</span></span>;
}

function ModalidadeModelo({ tipo }: { tipo: string }) {
  const valor = tipo === "CLT" ? "clt" : tipo === "Estágio" ? "estagio" : undefined;
  return <Badge value={valor}>{tipo}</Badge>;
}

/** Campo de cargo com sugestões dos cargos que já têm modelo. */
function Pesquisa({ label, value, onChange, sugestoes, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  sugestoes: string[];
  placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const termo = normalizarBusca(value.trim());
  const lista = sugestoes.filter((item) => normalizarBusca(item).includes(termo)).slice(0, 8);
  return (
    <div className="relative">
      <BuscaComIcone>
        <Input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          className="pl-9"
          onChange={(event) => { onChange(event.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onBlur={() => window.setTimeout(() => setAberto(false), 150)}
        />
      </BuscaComIcone>
      {aberto && lista.length ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {lista.map((item) => (
            <li key={item}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onMouseDown={(event) => { event.preventDefault(); onChange(item); setAberto(false); }}>
                {item}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ações compactas da linha do modelo: abrir uma vaga com ele, editar e apagar. */
function AcoesModelo({ item, apagando, onApagar }: { item: ModeloConsulta; apagando: boolean; onApagar: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
      <Link className="acao acao-cyan inline-flex items-center gap-1" to={`/grupos-empresas?aba=vaga&modelo=${item.vaga_id}`} title="Abrir uma vaga já preenchida com este modelo">
        <ExternalLink size={12} aria-hidden /> Abrir vaga
      </Link>
      <Link className="acao acao-cyan inline-flex items-center gap-1" to={`/vagas/modelos/${item.vaga_id}/editar`} aria-label={`Editar o modelo ${item.cargo} (${item.tipo_vaga})`}>
        <Pencil size={12} aria-hidden /> Editar
      </Link>
      <button type="button" className="acao acao-rose inline-flex items-center gap-1" disabled={apagando} onClick={onApagar} aria-label={`Apagar o modelo ${item.cargo} (${item.tipo_vaga})`}>
        <Trash2 size={12} aria-hidden /> Apagar
      </button>
    </div>
  );
}

export function ConsultarModelosPage() {
  const [params, setParams] = useSearchParams();
  const consulta = Object.fromEntries(params.entries());
  const [cargo, setCargo] = useState(params.get("cargo") ?? "");
  const client = useQueryClient();
  const result = useQuery({
    queryKey: ["modelos-consulta", consulta],
    queryFn: () => api<ModeloConsulta[]>(`/api/v1/vagas/modelos?${new URLSearchParams(consulta)}`),
  });
  const opcoes = useQuery({
    queryKey: ["modelos-opcoes"],
    queryFn: () => api<{ cargos: string[] }>("/api/v1/vagas/modelos/opcoes"),
  });
  const apagar = useMutation({
    mutationFn: (vagaId: string) => api(`/api/v1/vagas/modelos/${vagaId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["modelos-consulta"] });
      await client.invalidateQueries({ queryKey: ["modelos-vaga"] });
    },
  });
  useEffect(() => {
    setCargo(params.get("cargo") ?? "");
  }, [params]);
  function pesquisar(form: FormData) {
    const next = new URLSearchParams();
    if (cargo.trim()) next.set("cargo", cargo.trim());
    const tipo = form.get("tipo");
    if (typeof tipo === "string" && tipo && tipo !== "todos") next.set("tipo", tipo);
    setParams(next);
  }
  function confirmarApagar(item: ModeloConsulta) {
    if (window.confirm(`Apagar o modelo ${item.cargo} (${item.tipo_vaga})? As vagas já abertas não mudam.`)) apagar.mutate(item.vaga_id);
  }
  const linhas = result.data?.data ?? [];
  const filtrando = Boolean(params.get("cargo") || params.get("tipo"));
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Modelos de vaga"
        descricao="Um modelo por cargo e modalidade, para todas as empresas. Ao abrir uma vaga, o modelo preenche tudo menos a empresa."
        acoes={<Link to="/vagas/modelos/novo"><Button type="button"><Plus size={16} /> Novo modelo</Button></Link>}
      />
      <Card>
        {/* key: ao limpar os filtros, a modalidade volta para "Todas". */}
        <form
          key={params.toString()}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] lg:items-end"
          onSubmit={(event) => { event.preventDefault(); pesquisar(new FormData(event.currentTarget)); }}
        >
          <CampoFiltro rotulo="Cargo" className="sm:col-span-2 lg:col-span-1">
            <Pesquisa label="Cargo" value={cargo} onChange={setCargo} sugestoes={opcoes.data?.data.cargos ?? []} placeholder="Todos os cargos" />
          </CampoFiltro>
          <CampoFiltro rotulo="Modalidade">
            <Select name="tipo" aria-label="Modalidade" defaultValue={params.get("tipo") ?? "todos"}>
              <option value="todos">Todas</option>
              <option value="clt">CLT</option>
              <option value="estagio">Estágio</option>
            </Select>
          </CampoFiltro>
          <Button type="submit" className="h-10"><Search size={16} /> Pesquisar</Button>
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : linhas.length} singular="modelo" plural="modelos" filtrando={filtrando} carregando={result.isLoading} onLimpar={() => setParams(new URLSearchParams())} />
      {apagar.isError ? <Alerta>Não foi possível apagar o modelo. Tente de novo; se continuar, avise o suporte.</Alerta> : null}
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>Não foi possível consultar os modelos. Atualize a página; se continuar, avise o suporte.</Alerta>
      ) : linhas.length ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th className="text-right">Salário</th>
                  <th>Carga</th>
                  <th>Horário</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((item) => (
                  <tr key={item.vaga_id}>
                    <td className="max-w-72"><Link className="block truncate" to={`/vagas/modelos/${item.vaga_id}/editar`}>{item.cargo}</Link></td>
                    <td><ModalidadeModelo tipo={item.tipo_vaga} /></td>
                    <td className="whitespace-nowrap text-right tabular-nums">{money(salarioDoModelo(item.salario))}</td>
                    <td><Carga horas={item.carga_horaria} /></td>
                    <td><Horario texto={item.horario} /></td>
                    <td className="w-px"><AcoesModelo item={item} apagando={apagar.isPending} onApagar={() => confirmarApagar(item)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden">
            {linhas.map((item) => (
              <li key={item.vaga_id} className="grid gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <Link className="min-w-0 font-semibold text-cyan-800" to={`/vagas/modelos/${item.vaga_id}/editar`}>{item.cargo}</Link>
                  <ModalidadeModelo tipo={item.tipo_vaga} />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-xs text-slate-500">Salário</dt><dd className="tabular-nums text-slate-700">{money(salarioDoModelo(item.salario))}</dd></div>
                  <div><dt className="text-xs text-slate-500">Carga</dt><dd><Carga horas={item.carga_horaria} /></dd></div>
                  <div className="col-span-2"><dt className="text-xs text-slate-500">Horário</dt><dd><Horario texto={item.horario} /></dd></div>
                </dl>
                <div className="flex justify-start"><AcoesModelo item={item} apagando={apagar.isPending} onApagar={() => confirmarApagar(item)} /></div>
              </li>
            ))}
          </ul>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhum modelo com esses filtros" text="Confira o cargo digitado ou troque a modalidade, ou limpe os filtros para ver todos." />
      ) : <Empty title="Nenhum modelo cadastrado" text="Use “Novo modelo” para criar o primeiro modelo de cargo e modalidade." />}
    </div>
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

/** Convênio em selo e o período embaixo: término vazio com convênio ativo é "indeterminado". */
function Convenio({ item }: { item: Instituicao }) {
  const ativo = item.conveniada === "1";
  const termino = ativo && !item.data_termino ? "prazo indeterminado" : `até ${dateBr(item.data_termino)}`;
  const periodo = item.data_inicio || item.data_termino || ativo ? `De ${dateBr(item.data_inicio)} ${termino}` : null;
  return (
    <div className="grid gap-0.5">
      <span><Badge value={ativo ? "ativa" : "encerrada"}>{ativo ? "Conveniada" : "Sem convênio"}</Badge></span>
      {periodo ? <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{periodo}</span> : null}
    </div>
  );
}

function Experiencia({ nota }: { nota: string | null }) {
  const estrelas = Number(nota) || 0;
  if (estrelas <= 0) return <span className="text-slate-400">—</span>;
  return <span className="tracking-wider text-amber-800" title={`Nota ${estrelas}`} aria-label={`Nota ${estrelas}`}>{"★".repeat(estrelas)}</span>;
}

export function ConsultarInstituicoesPage() {
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [pagina, setPagina] = useState(1);
  // Muda ao limpar os filtros, para os campos (não controlados) voltarem ao vazio.
  const [versao, setVersao] = useState(0);
  const result = useQuery({
    queryKey: ["instituicoes", busca, pagina],
    queryFn: () => api<Instituicao[]>(`/api/v1/instituicoes?${new URLSearchParams({ ...busca, page: String(pagina), pageSize: "20" })}`),
  });
  const linhas = result.data?.data ?? [];
  const total = Number(result.data?.meta?.total ?? 0);
  const filtrando = temFiltro(busca);
  function limpar() {
    setBusca({});
    setPagina(1);
    setVersao((atual) => atual + 1);
  }
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Instituições de ensino"
        descricao="Escolas e faculdades cadastradas no sistema antigo, com a situação do convênio, o tipo de ensino e a cidade."
      />
      <Card>
        <form
          key={versao}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_5rem_auto] lg:items-end"
          onSubmit={(event) => { event.preventDefault(); setBusca(lerFiltros(event, ["q", "ensino", "conveniada", "cidade", "uf"])); setPagina(1); }}
        >
          <CampoFiltro rotulo="Buscar" className="sm:col-span-2 lg:col-span-1">
            <BuscaComIcone>
              <Input name="q" aria-label="Buscar" placeholder="Nome, CNPJ, telefone ou e-mail" title="Pesquisa por razão social, nome fantasia, CNPJ, telefone e e-mail" className="pl-9" />
            </BuscaComIcone>
          </CampoFiltro>
          <CampoFiltro rotulo="Tipo de ensino">
            <Select name="ensino" aria-label="Tipo de ensino" defaultValue="Todos">
              <option value="Todos">Todos</option>
              <option value="Ensino Médio">Ensino médio</option>
              <option value="Ensino Superior">Ensino superior</option>
              <option value="Ensino Supletivo">Ensino supletivo</option>
              <option value="Ensino Técnico">Ensino técnico</option>
            </Select>
          </CampoFiltro>
          <CampoFiltro rotulo="Convênio">
            <Select name="conveniada" aria-label="Conveniada" defaultValue="Todas">
              <option value="Todas">Todas</option>
              <option value="Sim">Conveniadas</option>
              <option value="Não">Sem convênio</option>
            </Select>
          </CampoFiltro>
          <CampoFiltro rotulo="Cidade">
            <Input name="cidade" aria-label="Cidade" placeholder="Todas" />
          </CampoFiltro>
          <CampoFiltro rotulo="UF">
            <Input name="uf" aria-label="UF" placeholder="SP" maxLength={2} className="uppercase" />
          </CampoFiltro>
          <Button type="submit" className="h-10 sm:col-span-2 lg:col-span-1"><Search size={16} /> Pesquisar</Button>
        </form>
      </Card>
      <ResumoResultados total={result.isLoading ? null : total} singular="instituição" plural="instituições" filtrando={filtrando} carregando={result.isLoading} onLimpar={limpar} />
      {result.isLoading ? <Skeleton className="h-64" /> : result.isError ? (
        <Alerta>Não foi possível pesquisar as instituições. {result.error instanceof Error ? result.error.message : ""}</Alerta>
      ) : linhas.length || total > 0 ? (
        <Card className="p-0">
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instituição</th>
                  <th>CNPJ / INEP</th>
                  <th>Tipo de ensino</th>
                  <th>Convênio</th>
                  <th>Experiência</th>
                  <th>Local</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((item, indice) => {
                  const fantasia = textoPlano(item.nome_fantasia);
                  const razao = textoPlano(item.razao_social);
                  return (
                    <tr key={`${item.cnpj ?? ""}-${indice}`}>
                      <td className="max-w-80">
                        <p className="truncate font-semibold text-navy-900">{fantasia || razao || "—"}</p>
                        {fantasia && razao && razao !== fantasia ? <p className="truncate text-xs text-slate-500">{razao}</p> : null}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(item.cnpj)}</td>
                      <td className="whitespace-nowrap text-slate-700">{item.tipo_encino || "—"}</td>
                      <td><Convenio item={item} /></td>
                      <td className="whitespace-nowrap"><Experiencia nota={item.parece} /></td>
                      <td className="max-w-56">
                        <p className="truncate text-slate-700">{[item.cidade, item.uf].filter(Boolean).join(" / ") || "—"}</p>
                        {item.bairro ? <p className="truncate text-xs text-slate-500">{item.bairro}</p> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="lg:hidden">
            {linhas.map((item, indice) => {
              const fantasia = textoPlano(item.nome_fantasia);
              const razao = textoPlano(item.razao_social);
              return (
                <li key={`${item.cnpj ?? ""}-${indice}`} className="grid gap-2 border-t border-slate-100 px-4 py-3 first:border-t-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">{fantasia || razao || "—"}</p>
                    {fantasia && razao && razao !== fantasia ? <p className="text-xs text-slate-500">{razao}</p> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div><dt className="text-xs text-slate-500">CNPJ / INEP</dt><dd className="tabular-nums text-slate-700">{formatCnpj(item.cnpj)}</dd></div>
                    <div><dt className="text-xs text-slate-500">Tipo de ensino</dt><dd className="text-slate-700">{item.tipo_encino || "—"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Convênio</dt><dd><Convenio item={item} /></dd></div>
                    <div><dt className="text-xs text-slate-500">Experiência</dt><dd><Experiencia nota={item.parece} /></dd></div>
                    <div className="col-span-2"><dt className="text-xs text-slate-500">Local</dt><dd className="text-slate-700">{[item.bairro, item.cidade, item.uf].filter(Boolean).join(" · ") || "—"}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100">
            <Paginacao pagina={pagina} tamanho={20} total={total} onPagina={setPagina} />
          </div>
        </Card>
      ) : filtrando ? (
        <Empty title="Nenhuma instituição com esses filtros" text="Confira o nome ou o CNPJ digitado, ou limpe os filtros para ver todas." />
      ) : <Empty title="Nenhuma instituição encontrada" text="A cópia do sistema antigo ainda não trouxe instituições de ensino." />}
    </div>
  );
}

/** Formulário visual: o botão Salvar ainda não grava nada (não há rota de cadastro no backend). */
export function CadastrarInstituicaoPage() {
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Nova instituição de ensino"
        descricao="Dados da escola ou faculdade, de quem assina pelo convênio, contato e endereço."
      />
      <Alerta tom="aviso">Este cadastro ainda não grava no sistema: o botão Salvar não envia os dados. Por enquanto, cadastre a instituição no sistema antigo.</Alerta>
      <Secao titulo="Instituição" texto="Tipo de ensino, documentos e nomes como aparecem no convênio.">
        <Grade>
          <Celula span={3}>
            <Field label="Tipo de ensino">
              <Select aria-label="Tipo Ensino" defaultValue="Ensino Médio">
                <option value="Ensino Médio">Ensino médio</option>
                <option value="Ensino Superior">Ensino superior</option>
                <option value="Ensino Supletivo">Ensino supletivo</option>
                <option value="Ensino Técnico">Ensino técnico</option>
              </Select>
            </Field>
          </Celula>
          <Celula span={3}>
            <Field label="Tipo de instituição">
              <Select aria-label="Tipo Instituição" defaultValue="">
                <option value="">Selecione</option>
                <option>Particular</option>
                <option>Pública</option>
              </Select>
            </Field>
          </Celula>
          <Celula span={3}><Field label="CNPJ / INEP"><Input aria-label="CNPJ / INEP" placeholder="00.000.000/0000-00 ou código INEP" /></Field></Celula>
          <Celula span={3}><Field label="IE / IM"><Input aria-label="IE / IM" /></Field></Celula>
          <Celula span={6}><Field label="Mantenedora"><Input aria-label="Mantenedora" /></Field></Celula>
          <Celula span={3}><Field label="Razão social"><Input aria-label="Razão Social" /></Field></Celula>
          <Celula span={3}><Field label="Nome fantasia"><Input aria-label="Nome Fantasia" /></Field></Celula>
        </Grade>
      </Secao>
      <Secao titulo="Direção e representante legal" texto="Quem dirige a instituição e quem assina os termos de estágio.">
        <Grade>
          <Celula span={4}><Field label="Diretor"><Input aria-label="Diretor" /></Field></Celula>
          <Celula span={2}><Field label="E-mail do diretor"><Input aria-label="Diretor E-mail" type="email" /></Field></Celula>
          <Celula span={3}><Field label="CPF do diretor"><Input aria-label="CPF Diretor" placeholder="000.000.000-00" /></Field></Celula>
          <Celula span={3}><Field label="RG do diretor"><Input aria-label="RG Diretor" /></Field></Celula>
          <Celula span={4}><Field label="Representante legal"><Input aria-label="Representante Legal" /></Field></Celula>
          <Celula span={2}><Field label="CPF do representante"><Input aria-label="Representante Legal CPF" placeholder="000.000.000-00" /></Field></Celula>
          <Celula span={3}><Field label="Cargo do representante"><Input aria-label="Cargo Representante Legal" /></Field></Celula>
          <Celula span={3}><Field label="E-mail do representante"><Input aria-label="Representante E-mail" type="email" /></Field></Celula>
        </Grade>
      </Secao>
      <Secao titulo="Contato" texto="Telefones e e-mail da secretaria.">
        <Grade>
          <Celula span={2}><Field label="Telefone"><Input aria-label="Telefone" placeholder="(11) 0000-0000" /></Field></Celula>
          <Celula span={2}><Field label="Segundo telefone"><Input aria-label="Segundo telefone" placeholder="(11) 90000-0000" /></Field></Celula>
          <Celula span={2}><Field label="E-mail"><Input aria-label="E-mail" type="email" /></Field></Celula>
        </Grade>
      </Secao>
      <Secao titulo="Endereço" texto="Endereço da unidade, com latitude e longitude se souber.">
        <Grade>
          <Celula span={2}><Field label="CEP"><Input aria-label="Cep" placeholder="00000-000" /></Field></Celula>
          <Celula span={4}><Field label="Rua"><Input aria-label="Rua" /></Field></Celula>
          <Celula span={1}><Field label="Número"><Input aria-label="Número" /></Field></Celula>
          <Celula span={2}><Field label="Complemento"><Input aria-label="Complemento" /></Field></Celula>
          <Celula span={3}><Field label="Bairro"><Input aria-label="Bairro" /></Field></Celula>
          <Celula span={4}><Field label="Cidade"><Input aria-label="Cidade" /></Field></Celula>
          <Celula span={2}><Field label="UF"><Input aria-label="Estado" placeholder="SP" maxLength={2} className="uppercase" /></Field></Celula>
          <Celula span={3}><Field label="Latitude"><Input aria-label="Latitude" placeholder="-23.5505" /></Field></Celula>
          <Celula span={3}><Field label="Longitude"><Input aria-label="Longitude" placeholder="-46.6333" /></Field></Celula>
        </Grade>
      </Secao>
      <div className="flex justify-end">
        <Button type="button"><Save size={16} /> Salvar instituição</Button>
      </div>
    </div>
  );
}
