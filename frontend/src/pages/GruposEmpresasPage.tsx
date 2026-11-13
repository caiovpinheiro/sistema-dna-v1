import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Save, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BuscaOpcao, normalizarBusca } from "@/components/busca-opcao";
import { CobrancaEmpresa, type ValorEmpresa } from "@/components/cobranca-empresa";
import { Alerta, CabecalhoPagina, FiltroChips } from "@/components/pagina";
import { Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatCnpj } from "@/lib/format";
import { cargoDoModelo, type CargoOpcao } from "@/lib/cargo";
import { DIAS_ESCALA, textoDoHorario, type DiaEscala, type ModoDia } from "@/lib/horario-escala";

type Aba = "grupo" | "empresa" | "vaga";
type Grupo = { id: string; nome: string; email: string | null; telefone: string | null };
type Empresa = {
  id: string;
  grupo_id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  local: string | null;
};
type GrupoDetalhe = Grupo & { empresas: Empresa[] };

const abas: Array<{ id: Aba; label: string }> = [
  { id: "grupo", label: "Grupo" },
  { id: "empresa", label: "Empresa" },
  { id: "vaga", label: "Vaga" },
];

function Aviso({ texto }: { texto: string }) {
  return texto ? <Alerta>{texto}</Alerta> : null;
}

function Sucesso({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{children}</p>;
}

/** Bloco numerado do formulário (mesmo visual do gerador de TCE): número, título e uma frase do que vai nele. */
function Bloco({ numero, titulo, texto, children }: { numero: number; titulo: string; texto: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-700 text-sm font-bold text-white">{numero}</span>
        <div>
          <h2 className="text-base font-bold text-navy-900">{titulo}</h2>
          <p className="text-sm text-slate-500">{texto}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Grade de 6 colunas: campos curtos (UF, número) ocupam 1, longos (nome, endereço) 3 ou 4. */
function Grade({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:grid-cols-6", className)}>{children}</div>;
}

const LARGURAS = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" } as const;

function Celula({ span, children }: { span: keyof typeof LARGURAS; children: ReactNode }) {
  return <div className={cn("min-w-0", LARGURAS[span])}>{children}</div>;
}

function limpar(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
}

export function GruposEmpresasPage() {
  const [params, setParams] = useSearchParams();
  const aba = (abas.some((item) => item.id === params.get("aba")) ? params.get("aba") : "grupo") as Aba;
  const grupoId = params.get("grupo") ?? "";
  function abrir(nextAba: Aba, grupo = grupoId) {
    const next = new URLSearchParams(params);
    next.set("aba", nextAba);
    if (grupo) next.set("grupo", grupo); else next.delete("grupo");
    setParams(next);
  }
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Grupos, empresas e vagas"
        descricao="Cadastre nesta ordem: primeiro o grupo, depois a empresa do grupo e por fim a vaga da empresa."
      />
      <FiltroChips rotulo="O que cadastrar" opcoes={abas.map((item) => ({ id: item.id, rotulo: item.label }))} valor={aba} onChange={(id) => abrir(id)} />
      {aba === "grupo" ? <AbaGrupo selecionado={grupoId} onSelect={(id) => abrir("grupo", id)} /> : null}
      {aba === "empresa" ? <AbaEmpresa grupoInicial={grupoId} /> : null}
      {aba === "vaga" ? (
        <AbaVaga
          key={`${params.get("modelo") ?? ""}:${params.get("empresa") ?? ""}`}
          empresaInicial={params.get("empresa") ?? ""}
          modeloInicial={params.get("modelo") ?? ""}
        />
      ) : null}
    </div>
  );
}

function Erro({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return null;
  return <Alerta>{error.message}</Alerta>;
}

function AbaGrupo({ selecionado, onSelect }: { selecionado: string; onSelect: (id: string) => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const grupos = useQuery({ queryKey: ["grupos"], queryFn: () => api<Grupo[]>("/api/v1/grupos") });
  const detalhe = useQuery({
    queryKey: ["grupo", selecionado],
    enabled: Boolean(selecionado),
    queryFn: () => api<GrupoDetalhe>(`/api/v1/grupos/${selecionado}`),
  });
  const cobranca = useQuery({
    queryKey: ["grupo-cobranca", selecionado],
    enabled: Boolean(selecionado),
    queryFn: () => api<Array<{ id_empresa: string; nome: string; cnpj: string | null; cobranca: ValorEmpresa | null }>>(`/api/v1/grupos/${selecionado}/cobranca`),
  });
  const [form, setForm] = useState({ nome: "", email: "", telefone: "" });
  const save = useMutation({
    mutationFn: () => api("/api/v1/grupos", { method: "POST", body: JSON.stringify(limpar(form)) }),
    onSuccess: async () => {
      setForm({ nome: "", email: "", telefone: "" });
      await client.invalidateQueries({ queryKey: ["grupos"] });
    },
  });
  const [busca, setBusca] = useState("");
  const grupo = detalhe.data?.data;
  const termo = normalizarBusca(busca.trim());
  const lista = (grupos.data?.data ?? []).filter((item) => normalizarBusca(`${item.nome} ${item.email ?? ""} ${item.telefone ?? ""}`).includes(termo));
  if (selecionado) {
    return (
      <div className="grid gap-4">
        <div>
          <Button type="button" variant="ghost" className="-ml-2" onClick={() => onSelect("")}><ArrowLeft size={16} /> Voltar para os grupos</Button>
        </div>
        {detalhe.isLoading ? <Skeleton className="h-48" /> : null}
        {detalhe.isError ? <Erro error={detalhe.error} /> : null}
        {grupo ? (
          <Card className="grid gap-4 p-0">
            <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 md:px-5 md:pt-5">
              <div>
                <h2 className="text-xl font-extrabold text-navy-900">{grupo.nome}</h2>
                <p className="text-sm text-slate-500">{[grupo.email, grupo.telefone].filter(Boolean).join(" · ") || "Sem contato"}</p>
              </div>
              <Link to={`/grupos-empresas?aba=empresa&grupo=${grupo.id}`} className="text-sm font-semibold text-cyan-700 hover:underline">Cadastrar empresa neste grupo</Link>
            </header>
            <div className="grid gap-2">
              <h3 className="px-4 text-[15px] font-bold text-navy-900 md:px-5">Empresas do grupo</h3>
              {grupo.empresas.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr><th>Empresa</th><th>CNPJ</th><th>Endereço</th><th><span className="sr-only">Ações</span></th></tr></thead>
                    <tbody>
                      {grupo.empresas.map((empresa) => (
                        <tr key={empresa.id} className="cursor-pointer" onClick={() => navigate(`/empresas/${empresa.id}`)}>
                          <td className="max-w-80">
                            <Link to={`/empresas/${empresa.id}`} className="block truncate" onClick={(event) => event.stopPropagation()}>
                              {empresa.nome_fantasia || empresa.razao_social}
                            </Link>
                            {empresa.nome_fantasia && empresa.razao_social !== empresa.nome_fantasia ? <p className="truncate text-xs text-slate-500">{empresa.razao_social}</p> : null}
                          </td>
                          <td className="whitespace-nowrap tabular-nums text-slate-600">{formatCnpj(empresa.cnpj)}</td>
                          <td className="text-slate-600">{empresa.local || <span className="text-slate-400">Endereço não informado</span>}</td>
                          <td className="w-px whitespace-nowrap text-right">
                            <Link to={`/empresas/${empresa.id}`} onClick={(event) => event.stopPropagation()} aria-label={`Abrir ${empresa.nome_fantasia || empresa.razao_social}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-4 pb-4 text-sm text-slate-500 md:px-5">Nenhuma empresa neste grupo ainda.</p>}
            </div>
          </Card>
        ) : null}
        {grupo && grupo.empresas.length ? (
          <Card className="grid gap-3 md:p-5">
            <div>
              <h3 className="text-[15px] font-bold text-navy-900">Cobrança das empresas</h3>
              <p className="text-sm text-slate-500">Condições do contrato de cada empresa. Clique para ver os detalhes.</p>
            </div>
            {cobranca.isLoading ? <Skeleton className="h-20" /> : null}
            <Erro error={cobranca.error} />
            {(cobranca.data?.data ?? []).map((item) => item.cobranca
              ? <CobrancaEmpresa key={item.id_empresa} valor={item.cobranca} />
              : (
                <div key={item.id_empresa} className="rounded-xl border border-dashed border-slate-200 p-4 text-sm">
                  <span className="font-semibold text-navy-900">{item.nome}</span>
                  <span className="text-slate-500"> · sem condições de cobrança cadastradas</span>
                </div>
              ))}
          </Card>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="md:p-5">
        <form className="grid content-start gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Novo grupo</h2>
            <p className="text-sm text-slate-500">O grupo junta as empresas de um mesmo dono ou rede.</p>
          </div>
          <Erro error={save.error} />
          {save.isSuccess ? <Sucesso>Grupo gravado.</Sucesso> : null}
          <Field label="Nome"><Input required minLength={2} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></Field>
          {/* Basta um dos dois contatos: cada um só é exigido enquanto o outro estiver vazio. */}
          <Field label="E-mail"><Input type="email" required={!form.telefone.trim()} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Telefone"><Input required={!form.email.trim()} value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} /></Field>
          <p className="text-xs text-slate-500">Informe o e-mail ou o telefone (ou os dois).</p>
          <Button disabled={save.isPending}><Save size={16} /> {save.isPending ? "Salvando…" : "Salvar grupo"}</Button>
        </form>
      </Card>
      <Card className="grid content-start gap-3 p-0">
        <div className="grid gap-1.5 px-4 pt-4 md:px-5 md:pt-5">
          <span className="text-xs font-semibold text-slate-500">Pesquisar grupo</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={busca} aria-label="Pesquisar grupo" placeholder="Nome, e-mail ou telefone" autoComplete="off" className="pl-9" onChange={(event) => setBusca(event.target.value)} />
          </div>
          {grupos.data ? <p className="text-sm text-slate-500"><span className="font-bold tabular-nums text-navy-900">{lista.length}</span> {lista.length === 1 ? "grupo" : "grupos"}{busca.trim() ? " com essa pesquisa" : ""}. Clique num grupo para ver as empresas e a cobrança.</p> : null}
        </div>
        {grupos.isLoading ? <div className="px-4 pb-4 md:px-5"><Skeleton className="h-48" /></div> : grupos.isError ? <div className="px-4 pb-4 md:px-5"><Erro error={grupos.error} /></div> : lista.length ? (
          <ul className="max-h-[36rem] overflow-y-auto">
            {lista.map((item) => (
              <li key={item.id} className="border-t border-slate-100">
                <button type="button" onClick={() => onSelect(item.id)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50 md:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-cyan-700">{item.nome}</span>
                    <span className="block truncate text-xs text-slate-500">{[item.email, item.telefone].filter(Boolean).join(" · ") || "Sem contato"}</span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 pb-4 md:px-5">
            <Empty title={busca.trim() ? "Nenhum grupo com essa pesquisa" : "Nenhum grupo cadastrado"} text={busca.trim() ? "Confira o nome digitado ou apague a pesquisa para ver todos." : "Cadastre o grupo antes da empresa, no formulário ao lado."} />
          </div>
        )}
      </Card>
    </div>
  );
}

function AbaEmpresa({ grupoInicial }: { grupoInicial: string }) {
  const client = useQueryClient();
  const grupos = useQuery({ queryKey: ["grupos"], queryFn: () => api<Grupo[]>("/api/v1/grupos") });
  const [form, setForm] = useState({
    grupo_id: grupoInicial, cnpj: "", razao_social: "", nome_fantasia: "", cep: "", logradouro: "", numero: "",
    complemento: "", bairro: "", cidade: "", uf: "", email: "", telefone: "",
  });
  const [aviso, setAviso] = useState("");
  const [avisoCep, setAvisoCep] = useState("");
  const save = useMutation({
    mutationFn: () => api<{ id: string; reativada: boolean }>("/api/v1/grupos-empresas/empresas", { method: "POST", body: JSON.stringify(limpar(form)) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["grupo"] });
      await client.invalidateQueries({ queryKey: ["empresas-tela"] });
    },
  });
  async function buscarCep() {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setAvisoCep("");
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
    if (data.erro) {
      setAvisoCep("CEP não encontrado. Preencha o endereço.");
      return;
    }
    setForm((atual) => ({
      ...atual,
      cep,
      logradouro: data.logradouro || atual.logradouro,
      bairro: data.bairro || atual.bairro,
      cidade: data.localidade || atual.cidade,
      uf: data.uf || atual.uf,
    }));
  }
  return (
    <form className="grid w-full gap-4" onSubmit={(event) => { event.preventDefault(); if (!form.grupo_id) { setAviso("Escolha o grupo da empresa."); return; } setAviso(""); save.mutate(); }}>
      <Erro error={save.error} />
      <Aviso texto={aviso} />
      {save.isSuccess ? <Sucesso>{save.data.data.reativada ? "Empresa reativada e copiada para o grupo." : "Empresa gravada."}</Sucesso> : null}
      <Bloco numero={1} titulo="Grupo e identificação" texto="O grupo da empresa e os nomes como aparecem no contrato.">
        <Grade>
          <Celula span={4}>
            <Field label="Grupo">
              <BuscaOpcao
                value={form.grupo_id}
                onChange={(grupoId) => setForm({ ...form, grupo_id: grupoId })}
                opcoes={(grupos.data?.data ?? []).map((grupo) => ({ id: grupo.id, label: grupo.nome }))}
                placeholder="Pesquisar grupo"
              />
            </Field>
          </Celula>
          <Celula span={2}><Field label="CNPJ (opcional)"><Input value={form.cnpj} placeholder="Em branco se não tiver CNPJ" onChange={(event) => setForm({ ...form, cnpj: event.target.value })} /></Field></Celula>
          <Celula span={3}><Field label="Razão social"><Input required value={form.razao_social} onChange={(event) => setForm({ ...form, razao_social: event.target.value })} /></Field></Celula>
          <Celula span={3}><Field label="Nome fantasia"><Input required value={form.nome_fantasia} onChange={(event) => setForm({ ...form, nome_fantasia: event.target.value })} /></Field></Celula>
        </Grade>
      </Bloco>
      <Bloco numero={2} titulo="Endereço" texto="Digite o CEP e saia do campo: rua, bairro, cidade e UF são preenchidos sozinhos.">
        <Grade>
          <Celula span={2}><Field label="CEP"><Input required value={form.cep} placeholder="00000-000" onBlur={() => void buscarCep()} onChange={(event) => setForm({ ...form, cep: event.target.value })} /></Field></Celula>
          <Celula span={4}><Field label="Endereço"><Input required value={form.logradouro} onChange={(event) => setForm({ ...form, logradouro: event.target.value })} /></Field></Celula>
          <Celula span={1}><Field label="Número"><Input value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} /></Field></Celula>
          <Celula span={2}><Field label="Complemento"><Input value={form.complemento} onChange={(event) => setForm({ ...form, complemento: event.target.value })} /></Field></Celula>
          <Celula span={3}><Field label="Bairro"><Input required value={form.bairro} onChange={(event) => setForm({ ...form, bairro: event.target.value })} /></Field></Celula>
          <Celula span={4}><Field label="Cidade"><Input required value={form.cidade} onChange={(event) => setForm({ ...form, cidade: event.target.value })} /></Field></Celula>
          <Celula span={2}><Field label="UF"><Input required minLength={2} maxLength={2} placeholder="SP" className="uppercase" value={form.uf} onChange={(event) => setForm({ ...form, uf: event.target.value })} /></Field></Celula>
        </Grade>
        {avisoCep ? <Alerta tom="aviso">{avisoCep}</Alerta> : null}
      </Bloco>
      <Bloco numero={3} titulo="Contato" texto="Informe o e-mail ou o telefone da empresa (ou os dois).">
        <Grade>
          <Celula span={3}><Field label="E-mail"><Input type="email" required={!form.telefone.trim()} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field></Celula>
          <Celula span={3}><Field label="Telefone"><Input required={!form.email.trim()} value={form.telefone} placeholder="(11) 90000-0000" onChange={(event) => setForm({ ...form, telefone: event.target.value })} /></Field></Celula>
        </Grade>
      </Bloco>
      <div className="flex justify-end"><Button disabled={save.isPending}><Save size={16} /> {save.isPending ? "Salvando…" : "Salvar empresa"}</Button></div>
    </form>
  );
}

type FormularioVaga = {
  tipo: string;
  carga_horaria: string;
  cargo: string;
  cargo_id: string;
  descricao?: string;
  requisitos?: string;
  salario: string;
  horario_entrada: string;
  horario_saida: string;
  sexo: string;
  idade: string;
  idade_ate: string;
  atividades: string;
  segunda_entrada: string;
  segunda_saida: string;
  terca_entrada: string;
  terca_saida: string;
  quarta_entrada: string;
  quarta_saida: string;
  quinta_entrada: string;
  quinta_saida: string;
  sexta_entrada: string;
  sexta_saida: string;
  sab_entrada: string;
  sab_saida: string;
  domingo_entrada: string;
  domingo_saida: string;
  beneficios: string;
};
type Modelo = {
  vagaId: string;
  formulario: Omit<FormularioVaga, "cargo_id"> & { cargo_id: string | null; escala?: DiaEscala[]; folga?: DiaEscala[] };
};
const NOVO_CARGO = "novo";
const novoCargoVazio = { nome: "", descricao: "", requisitos: "" };
const vagaVazia: FormularioVaga & { empresa_id: string; quantidade: string } = {
  empresa_id: "", tipo: "estagio", carga_horaria: "30", cargo: "", cargo_id: "", salario: "", horario_entrada: "", horario_saida: "",
  sexo: "I", idade: "", idade_ate: "", atividades: "", quantidade: "1",
  segunda_entrada: "", segunda_saida: "", terca_entrada: "", terca_saida: "", quarta_entrada: "", quarta_saida: "",
  quinta_entrada: "", quinta_saida: "", sexta_entrada: "", sexta_saida: "", sab_entrada: "", sab_saida: "",
  domingo_entrada: "", domingo_saida: "", beneficios: "",
};
const diasHorario: Array<{ nome: string; entrada: keyof FormularioVaga; saida: keyof FormularioVaga }> = [
  { nome: "Segunda", entrada: "segunda_entrada", saida: "segunda_saida" },
  { nome: "Terça", entrada: "terca_entrada", saida: "terca_saida" },
  { nome: "Quarta", entrada: "quarta_entrada", saida: "quarta_saida" },
  { nome: "Quinta", entrada: "quinta_entrada", saida: "quinta_saida" },
  { nome: "Sexta", entrada: "sexta_entrada", saida: "sexta_saida" },
  { nome: "Sábado", entrada: "sab_entrada", saida: "sab_saida" },
  { nome: "Domingo", entrada: "domingo_entrada", saida: "domingo_saida" },
];

function minutosRelogio(hora: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const DIAS_SEMANA = ["segunda", "terca", "quarta", "quinta", "sexta", "sab", "domingo"] as const;

/** Quantos dias a carga pede com essa entrada e saída: 30 h com 6 h por dia são 5 dias. */
function diasPelaCarga(carga: string, entrada: string, saida: string): number | null {
  const inicio = minutosRelogio(entrada);
  const fim = minutosRelogio(saida);
  if (inicio == null || fim == null || !Number(carga)) return null;
  let minutos = fim - inicio;
  if (minutos <= 0) minutos += 24 * 60;
  return Math.min(7, Math.max(1, Math.round(Number(carga) / (minutos / 60))));
}

/**
 * Preenche os dias fixos a partir de segunda com a entrada e a saída, até cobrir a carga.
 * Um dia editado à mão (diferente do horário base anterior) fica como está, e dias de escala ou folga nunca mudam.
 */
function preencherDias<T extends FormularioVaga>(atual: T, proximo: T, modos?: Record<string, string>): T {
  const dias = diasPelaCarga(proximo.carga_horaria, proximo.horario_entrada, proximo.horario_saida);
  if (dias == null) return proximo;
  const resultado: Record<string, string> = { ...proximo };
  let fixos = 0;
  DIAS_SEMANA.forEach((dia) => {
    if (modos && modos[dia] !== "fixo") return;
    const posicao = fixos;
    fixos += 1;
    const entrada = `${dia}_entrada` as keyof FormularioVaga;
    const saida = `${dia}_saida` as keyof FormularioVaga;
    const vazio = !atual[entrada] && !atual[saida];
    const automatico = atual[entrada] === atual.horario_entrada && atual[saida] === atual.horario_saida;
    if (!vazio && !automatico) return;
    resultado[entrada] = posicao < dias ? proximo.horario_entrada : "";
    resultado[saida] = posicao < dias ? proximo.horario_saida : "";
  });
  return resultado as T;
}

const modosFixos = Object.fromEntries(DIAS_ESCALA.map((dia) => [dia, "fixo"])) as Record<DiaEscala, ModoDia>;

/** Dia de folga não conta horas nem vai com horário: o servidor grava "0". */
function semFolga<T extends FormularioVaga>(form: T, modos: Record<DiaEscala, ModoDia>): T {
  const resultado: Record<string, string> = { ...form };
  for (const dia of DIAS_ESCALA) {
    if (modos[dia] !== "folga") continue;
    resultado[`${dia}_entrada`] = "";
    resultado[`${dia}_saida`] = "";
  }
  return resultado as T;
}

/** Só os dias fixos contam para a carga: escala não é toda semana e folga não trabalha. */
function soDiasFixos<T extends FormularioVaga>(form: T, modos: Record<DiaEscala, ModoDia>): T {
  const resultado: Record<string, string> = { ...form };
  for (const dia of DIAS_ESCALA) {
    if (modos[dia] === "fixo") continue;
    resultado[`${dia}_entrada`] = "";
    resultado[`${dia}_saida`] = "";
  }
  return resultado as T;
}

/** O mesmo texto que o servidor grava: com escala ou folga em dia útil, o texto por dia; senão "08:00 às 17:00". */
function textoPrevisto(form: FormularioVaga, modos: Record<DiaEscala, ModoDia>) {
  const especial = DIAS_ESCALA.some((dia) => modos[dia] === "escala") || DIAS_ESCALA.slice(0, 5).some((dia) => modos[dia] === "folga");
  if (!especial) return form.horario_entrada && form.horario_saida ? `${form.horario_entrada} às ${form.horario_saida}` : "";
  return textoDoHorario(DIAS_ESCALA.map((dia, indice) => {
    const entrada = form[`${dia}_entrada` as keyof FormularioVaga] as string;
    const saida = form[`${dia}_saida` as keyof FormularioVaga] as string;
    // Dia útil vazio usa a entrada e a saída da vaga, como no servidor.
    const base = indice < 5 && !entrada && !saida;
    return { modo: modos[dia], entrada: base ? form.horario_entrada : entrada, saida: base ? form.horario_saida : saida };
  }));
}

function cargaDoHorario(form: FormularioVaga) {
  const pares: Array<[string, string]> = [
    [form.segunda_entrada, form.segunda_saida],
    [form.terca_entrada, form.terca_saida],
    [form.quarta_entrada, form.quarta_saida],
    [form.quinta_entrada, form.quinta_saida],
    [form.sexta_entrada, form.sexta_saida],
    [form.sab_entrada, form.sab_saida],
    [form.domingo_entrada, form.domingo_saida],
  ];
  const preenchidos = pares.filter(([entrada, saida]) => entrada && saida);
  const usados = preenchidos.length
    ? preenchidos
    : form.horario_entrada && form.horario_saida
      ? Array.from({ length: 5 }, () => [form.horario_entrada, form.horario_saida] as [string, string])
      : [];
  let minutos = 0;
  for (const [entrada, saida] of usados) {
    const inicio = minutosRelogio(entrada);
    const fim = minutosRelogio(saida);
    if (inicio == null || fim == null) continue;
    let diff = fim - inicio;
    if (diff <= 0) diff += 24 * 60;
    minutos += diff;
  }
  const horas = minutos / 60;
  if (horas <= 0) return "";
  if (form.tipo === "clt") return horas >= 42 ? "44" : "40";
  return horas >= 25 ? "30" : "20";
}

function rotuloModelo(modelo: Modelo) {
  const tipo = modelo.formulario.tipo === "clt" ? "CLT" : "Estágio";
  return `${modelo.formulario.cargo || "Sem cargo"} · ${tipo}`;
}

function semModos(modelo: Modelo) {
  const { escala: _escala, folga: _folga, ...formulario } = modelo.formulario;
  return formulario;
}

/** Tipo de cada dia que o modelo guardou: o que não é escala nem folga é fixo. */
function modosDoModelo(modelo: Modelo): Record<DiaEscala, ModoDia> {
  const escala = new Set(modelo.formulario.escala ?? []);
  const folga = new Set(modelo.formulario.folga ?? []);
  return Object.fromEntries(DIAS_ESCALA.map((dia) => [dia, folga.has(dia) ? "folga" : escala.has(dia) ? "escala" : "fixo"])) as Record<DiaEscala, ModoDia>;
}

/** Criar ou editar um modelo global: o mesmo formulário da vaga, sem empresa e sem quantidade. */
export function ModeloFormPage() {
  const { id } = useParams();
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo={id ? "Editar modelo de vaga" : "Novo modelo de vaga"}
        descricao="Um modelo por cargo e modalidade, para todas as empresas. Ao abrir uma vaga, ele preenche tudo menos a empresa."
        acoes={<Link to="/vagas/modelos"><Button type="button" variant="secondary"><ArrowLeft size={16} /> Voltar aos modelos</Button></Link>}
      />
      <AbaVaga key={id ?? "novo"} modo="modelo" empresaInicial="" modeloInicial={id ?? ""} />
    </div>
  );
}

function AbaVaga({ empresaInicial, modeloInicial, modo = "vaga" }: { empresaInicial: string; modeloInicial: string; modo?: "vaga" | "modelo" }) {
  const ehModelo = modo === "modelo";
  const navigate = useNavigate();
  const empresas = useQuery({ queryKey: ["empresas-tela"], enabled: !ehModelo, queryFn: () => api<Empresa[]>("/api/v1/grupos-empresas/empresas") });
  const [form, setForm] = useState({ ...vagaVazia, empresa_id: empresaInicial });
  const [modos, setModos] = useState(modosFixos);
  const [aviso, setAviso] = useState("");
  const queryClient = useQueryClient();
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api<CargoOpcao[]>("/api/v1/cargos") });
  const listaCargos = cargos.data?.data ?? [];
  const [cargoNovo, setCargoNovo] = useState<typeof novoCargoVazio | null>(null);
  const cargoNovoRef = useRef<typeof novoCargoVazio | null>(null);
  const textoCargoRef = useRef("");
  const [buscaModelo, setBuscaModelo] = useState("");
  const [modeloAberto, setModeloAberto] = useState(false);
  const aplicouModelo = useRef(false);
  const modelos = useQuery({
    queryKey: ["modelos-vaga"],
    enabled: !ehModelo,
    queryFn: () => api<Modelo[]>("/api/v1/grupos-empresas/vagas"),
  });
  const detalhe = useQuery({
    queryKey: ["modelo-abrir", modeloInicial],
    enabled: Boolean(modeloInicial),
    queryFn: () => api<Modelo>(`/api/v1/vagas/modelos/${modeloInicial}`),
  });
  useEffect(() => {
    const modelo = detalhe.data?.data;
    // Espera a lista de cargos responder, com dados ou com erro: sem ela o modelo cai em "Novo cargo".
    if (!modelo || !cargos.isFetched || aplicouModelo.current) return;
    aplicouModelo.current = true;
    setBuscaModelo(rotuloModelo(modelo));
    const doCargo = cargoDoFormulario(modelo);
    setForm((atual) => ({ ...atual, ...semModos(modelo), ...doCargo, empresa_id: atual.empresa_id || empresaInicial, quantidade: atual.quantidade }));
    setModos(modosDoModelo(modelo));
  }, [detalhe.data, cargos.isFetched, empresaInicial]);
  const assinaturaHorario = [
    form.tipo, form.horario_entrada, form.horario_saida,
    form.segunda_entrada, form.segunda_saida, form.terca_entrada, form.terca_saida,
    form.quarta_entrada, form.quarta_saida, form.quinta_entrada, form.quinta_saida,
    form.sexta_entrada, form.sexta_saida, form.sab_entrada, form.sab_saida,
    form.domingo_entrada, form.domingo_saida, ...DIAS_ESCALA.map((dia) => modos[dia]),
  ].join("|");
  useEffect(() => {
    const calculada = cargaDoHorario(soDiasFixos(form, modos));
    if (!calculada) return;
    setForm((atual) => atual.carga_horaria === calculada ? atual : { ...atual, carga_horaria: calculada });
  }, [assinaturaHorario]);
  type EscolhaCargo = { cargoId: string; novo: typeof novoCargoVazio | null };
  function corpo(escolha: EscolhaCargo) {
    const { cargo: _cargo, cargo_id: _cargoId, descricao: _descricao, requisitos: _requisitos, ...resto } = semFolga(form, modos);
    const escala = DIAS_ESCALA.filter((dia) => modos[dia] === "escala");
    const folga = DIAS_ESCALA.filter((dia) => modos[dia] === "folga");
    return { ...limpar(resto), escala, folga, ...(escolha.novo ? { novo_cargo: escolha.novo } : { cargo_id: escolha.cargoId }) };
  }
  const save = useMutation({
    mutationFn: (escolha: EscolhaCargo) => api<{ codigo: string; quantidade: number; cargo: { nome: string; reaproveitado: boolean } }>("/api/v1/grupos-empresas/vagas", { method: "POST", body: JSON.stringify(corpo(escolha)) }),
    onSuccess: (_resposta, escolha) => {
      if (escolha.novo) void queryClient.invalidateQueries({ queryKey: ["cargos"] });
    },
  });
  const salvarModelo = useMutation({
    mutationFn: (escolha: EscolhaCargo) => {
      const body: Record<string, unknown> = corpo(escolha);
      delete body.empresa_id;
      delete body.quantidade;
      return modeloInicial
        ? api(`/api/v1/vagas/modelos/${modeloInicial}`, { method: "PUT", body: JSON.stringify(body) })
        : api("/api/v1/vagas/modelos", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: async (_resposta, escolha) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["modelos-consulta"] }),
        queryClient.invalidateQueries({ queryKey: ["modelos-vaga"] }),
        queryClient.invalidateQueries({ queryKey: ["modelo-abrir"] }),
        escolha.novo ? queryClient.invalidateQueries({ queryKey: ["cargos"] }) : Promise.resolve(),
      ]);
      navigate("/vagas/modelos");
    },
  });
  /** Cargo do modelo aplicado: da lista, ou "Novo cargo" já com o nome do modelo. */
  function cargoDoFormulario(modelo: Modelo) {
    const cargo = cargoDoModelo(modelo.formulario, listaCargos);
    setCargoNovo(cargo ? null : { ...novoCargoVazio, nome: modelo.formulario.cargo });
    cargoNovoRef.current = cargo ? null : { ...novoCargoVazio, nome: modelo.formulario.cargo };
    return { cargo_id: cargo?.id ?? "", cargo: cargo?.nome ?? modelo.formulario.cargo };
  }
  function definirCargoNovo(proximo: typeof novoCargoVazio | null) {
    cargoNovoRef.current = proximo;
    setCargoNovo(proximo);
  }
  function nomeDigitado() {
    const nome = textoCargoRef.current.trim();
    return nome && nome !== "+ Novo cargo" ? nome : "";
  }
  /** Lista, nome já aberto como novo, ou o texto digitado quando não está na lista. */
  function resolverCargo() {
    if (form.cargo_id) return { cargoId: form.cargo_id, novo: null as typeof novoCargoVazio | null };
    if (cargoNovoRef.current) return { cargoId: "", novo: cargoNovoRef.current };
    const nome = nomeDigitado();
    const existente = listaCargos.find((cargo) => normalizarBusca(cargo.nome) === normalizarBusca(nome));
    if (existente) return { cargoId: existente.id, novo: null };
    if (!nome) return { cargoId: "", novo: null };
    const novo = { ...novoCargoVazio, nome };
    definirCargoNovo(novo);
    return { cargoId: "", novo };
  }
  function escolherCargo(id: string) {
    if (id === NOVO_CARGO) {
      const proximo = { ...(cargoNovoRef.current ?? novoCargoVazio), nome: nomeDigitado() || cargoNovoRef.current?.nome || "" };
      definirCargoNovo(proximo);
      setForm((atual) => ({ ...atual, cargo_id: "" }));
      return;
    }
    // Digitar no campo limpa a escolha; no modo "Novo cargo" os textos já digitados ficam.
    if (!id && cargoNovoRef.current) return;
    definirCargoNovo(null);
    setForm((atual) => ({ ...atual, cargo_id: id, cargo: listaCargos.find((cargo) => cargo.id === id)?.nome ?? "" }));
  }
  const cargas = form.tipo === "estagio" ? ["20", "30"] : ["40", "44"];
  const lista = modelos.data?.data ?? [];
  const termoModelo = normalizarBusca(buscaModelo);
  const modelosVisiveis = lista
    .map((modelo) => ({ modelo, rotulo: rotuloModelo(modelo) }))
    .filter((item) => normalizarBusca(item.rotulo).includes(termoModelo))
    .slice(0, 20);
  /** Número de cada bloco: no modelo não há o bloco da empresa, então tudo sobe um. */
  const ordemBlocos = ehModelo ? ["cargo", "horario", "perfil", "atividades"] : ["empresa", "cargo", "horario", "perfil", "atividades"];
  const numero = (bloco: string) => ordemBlocos.indexOf(bloco) + 1;
  function aplicarModelo(modelo: Modelo, rotulo: string) {
    setBuscaModelo(rotulo);
    setModeloAberto(false);
    const doCargo = cargoDoFormulario(modelo);
    setForm((atual) => ({ ...atual, ...semModos(modelo), ...doCargo, empresa_id: atual.empresa_id, quantidade: atual.quantidade }));
    setModos(modosDoModelo(modelo));
  }
  return (
    <form className="grid w-full gap-4" onSubmit={(event) => {
      event.preventDefault();
      const escolha = resolverCargo();
      const novoIncompleto = escolha.novo && (escolha.novo.nome.trim().length < 2 || escolha.novo.descricao.trim().length < 3 || escolha.novo.requisitos.trim().length < 3);
      const falta = !ehModelo && !form.empresa_id
        ? "Escolha a empresa da vaga."
        : !escolha.cargoId && !escolha.novo
          ? "Escolha um cargo da lista ou \"+ Novo cargo\"."
          : novoIncompleto
            ? "Preencha o nome, a descrição e os requisitos do novo cargo."
            : "";
      setAviso(falta);
      if (falta) return;
      if (ehModelo) salvarModelo.mutate(escolha); else save.mutate(escolha);
    }}>
      <Erro error={save.error} />
      <Erro error={salvarModelo.error} />
      <Aviso texto={aviso} />
      <Erro error={detalhe.error} />
      <Erro error={cargos.error} />
      {save.isSuccess ? <Sucesso>{save.data.data.quantidade} vaga(s) abertas com o código {save.data.data.codigo}.{save.data.data.cargo.reaproveitado ? ` O cargo ${save.data.data.cargo.nome} já existia: a vaga usa a descrição e os requisitos dele.` : ""}</Sucesso> : null}
      {ehModelo ? null : (
        <Bloco numero={numero("empresa")} titulo="Empresa e modelo" texto="A empresa da vaga e, se quiser, um modelo para preencher o resto do formulário.">
          <Grade>
            <Celula span={3}>
              <Field label="Empresa">
                <BuscaOpcao
                  value={form.empresa_id}
                  onChange={(empresaId) => setForm({ ...form, empresa_id: empresaId })}
                  opcoes={(empresas.data?.data ?? []).map((empresa) => ({ id: empresa.id, label: empresa.nome_fantasia || empresa.razao_social }))}
                  placeholder="Pesquisar empresa"
                />
              </Field>
            </Celula>
            <Celula span={2}>
              <Field label="Modelo (opcional)">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={buscaModelo}
                    className="pl-9"
                    placeholder={modelos.isLoading ? "Carregando modelos…" : lista.length ? "Pesquisar modelo pelo cargo" : "Nenhum modelo criado"}
                    autoComplete="off"
                    onChange={(event) => { setBuscaModelo(event.target.value); setModeloAberto(true); }}
                    onFocus={() => setModeloAberto(true)}
                    onBlur={() => window.setTimeout(() => setModeloAberto(false), 150)}
                  />
                  {modeloAberto ? (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                      {modelosVisiveis.length ? modelosVisiveis.map(({ modelo, rotulo }) => (
                        <li key={modelo.vagaId}>
                          <button type="button" className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50" onMouseDown={(event) => { event.preventDefault(); aplicarModelo(modelo, rotulo); }}>
                            {rotulo}
                          </button>
                        </li>
                      )) : <li className="px-3 py-2 text-sm text-slate-500">{lista.length ? "Nenhum modelo encontrado" : "Nenhum modelo criado"}</li>}
                    </ul>
                  ) : null}
                </div>
              </Field>
            </Celula>
            <Celula span={1}><Field label="Quantidade"><Input type="number" required min={1} max={20} value={form.quantidade} onChange={(event) => setForm({ ...form, quantidade: event.target.value })} /></Field></Celula>
          </Grade>
        </Bloco>
      )}
      <Bloco numero={numero("cargo")} titulo="Cargo e remuneração" texto="Modalidade, carga semanal, cargo e salário (ou bolsa).">
        <Grade>
          <Celula span={1}>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(event) => {
                const tipo = event.target.value;
                setForm((atual) => preencherDias(atual, { ...atual, tipo, carga_horaria: tipo === "estagio" ? "30" : "40" }, modos));
              }}>
                <option value="estagio">Estágio</option>
                <option value="clt">CLT</option>
              </Select>
            </Field>
          </Celula>
          <Celula span={1}>
            <Field label="Carga horária">
              <Select value={form.carga_horaria} onChange={(event) => { const carga_horaria = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, carga_horaria }, modos)); }}>
                {cargas.map((carga) => <option key={carga} value={carga}>{carga} horas</option>)}
              </Select>
            </Field>
          </Celula>
          <Celula span={2}>
            <Field label="Cargo">
              <BuscaOpcao
                value={cargoNovo ? NOVO_CARGO : form.cargo_id}
                onChange={escolherCargo}
                opcoes={listaCargos.map((cargo) => ({ id: cargo.id, label: cargo.nome }))}
                fixas={[{ id: NOVO_CARGO, label: "+ Novo cargo" }]}
                preservarTexto={[NOVO_CARGO]}
                onTexto={(texto) => { textoCargoRef.current = texto; }}
                placeholder={cargos.isLoading ? "Carregando cargos…" : "Pesquisar cargo"}
              />
            </Field>
          </Celula>
          <Celula span={2}><Field label="Salário"><Input required placeholder="1800,00" value={form.salario} onChange={(event) => setForm({ ...form, salario: event.target.value })} /></Field></Celula>
        </Grade>
        {cargoNovo ? (
          <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-700">Novo cargo: a descrição e os requisitos valem para todas as vagas deste cargo.</p>
            <Field label="Nome do cargo"><Input required minLength={2} value={cargoNovo.nome} onChange={(event) => definirCargoNovo({ ...cargoNovo, nome: event.target.value })} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Descrição"><Textarea required minLength={3} className="min-h-20" value={cargoNovo.descricao} onChange={(event) => definirCargoNovo({ ...cargoNovo, descricao: event.target.value })} /></Field>
              <Field label="Requisitos"><Textarea required minLength={3} className="min-h-20" value={cargoNovo.requisitos} onChange={(event) => definirCargoNovo({ ...cargoNovo, requisitos: event.target.value })} /></Field>
            </div>
          </div>
        ) : null}
      </Bloco>
      <Bloco numero={numero("horario")} titulo="Horário" texto="Entrada e saída de um dia normal; os dias fixos se preenchem pela carga. Ajuste cada dia se precisar.">
        <Grade>
          <Celula span={1}><Field label="Entrada"><Input type="time" required value={form.horario_entrada} onChange={(event) => { const horario_entrada = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, horario_entrada }, modos)); }} /></Field></Celula>
          <Celula span={1}><Field label="Saída"><Input type="time" required value={form.horario_saida} onChange={(event) => { const horario_saida = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, horario_saida }, modos)); }} /></Field></Celula>
        </Grade>
        <div className="grid gap-2">
          <p className="text-xs text-slate-500">Fixo: trabalha toda semana. Escala: trabalha nesse dia conforme a escala da empresa, não toda semana. Folga: não trabalha.</p>
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
            {diasHorario.map((dia, indice) => {
              const chave = DIAS_ESCALA[indice];
              const folga = modos[chave] === "folga";
              return (
                <div key={dia.nome} className="grid min-w-0 grid-cols-[4.5rem_6rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
                  <span className="text-sm font-medium text-slate-700">{dia.nome}</span>
                  <Select aria-label={`${dia.nome} tipo`} className="min-w-0 px-2" value={modos[chave]} onChange={(event) => setModos({ ...modos, [chave]: event.target.value as ModoDia })}>
                    <option value="fixo">Fixo</option>
                    <option value="escala">Escala</option>
                    <option value="folga">Folga</option>
                  </Select>
                  <Input type="time" className="min-w-0 disabled:opacity-50" aria-label={`${dia.nome} entrada`} disabled={folga} required={modos[chave] === "escala"} value={folga ? "" : form[dia.entrada]} onChange={(event) => setForm({ ...form, [dia.entrada]: event.target.value })} />
                  <Input type="time" className="min-w-0 disabled:opacity-50" aria-label={`${dia.nome} saída`} disabled={folga} required={modos[chave] === "escala"} value={folga ? "" : form[dia.saida]} onChange={(event) => setForm({ ...form, [dia.saida]: event.target.value })} />
                </div>
              );
            })}
          </div>
          {textoPrevisto(form, modos) ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Texto do horário: <span className="font-semibold text-navy-900">{textoPrevisto(form, modos)}</span></p> : null}
        </div>
      </Bloco>
      <Bloco numero={numero("perfil")} titulo="Perfil do candidato" texto="Sexo aceito e faixa de idade.">
        <Grade>
          <Celula span={2}>
            <Field label="Sexo">
              <Select value={form.sexo} onChange={(event) => setForm({ ...form, sexo: event.target.value })}>
                <option value="I">Aceita os dois</option>
                <option value="F">Feminina</option>
                <option value="M">Masculina</option>
              </Select>
            </Field>
          </Celula>
          <Celula span={1}><Field label="Idade de"><Input type="number" required min={14} max={80} value={form.idade} onChange={(event) => setForm({ ...form, idade: event.target.value })} /></Field></Celula>
          <Celula span={1}><Field label="Idade até"><Input type="number" required min={14} max={80} value={form.idade_ate} onChange={(event) => setForm({ ...form, idade_ate: event.target.value })} /></Field></Celula>
        </Grade>
      </Bloco>
      <Bloco numero={numero("atividades")} titulo="Atividades e benefícios" texto="O que a pessoa vai fazer e o que a vaga oferece além do salário.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Atividades"><Textarea required minLength={3} className="min-h-28" value={form.atividades} onChange={(event) => setForm({ ...form, atividades: event.target.value })} /></Field>
          <Field label="Benefícios"><Textarea className="min-h-28" placeholder={"Um por linha. Ex.: Auxílio Transporte — Mensal"} value={form.beneficios} onChange={(event) => setForm({ ...form, beneficios: event.target.value })} /></Field>
        </div>
      </Bloco>
      <div className="flex flex-wrap justify-end gap-2">
        {ehModelo ? (
          <>
            <Button type="button" variant="secondary" onClick={() => navigate("/vagas/modelos")}>Cancelar</Button>
            <Button disabled={salvarModelo.isPending}><Save size={16} /> {salvarModelo.isPending ? "Salvando…" : "Salvar modelo"}</Button>
          </>
        ) : <Button disabled={save.isPending}><Save size={16} /> {save.isPending ? "Salvando…" : "Abrir vaga"}</Button>}
      </div>
    </form>
  );
}
