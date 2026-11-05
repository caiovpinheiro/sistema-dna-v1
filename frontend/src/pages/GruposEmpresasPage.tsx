import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BuscaOpcao, normalizarBusca } from "@/components/busca-opcao";
import { Button, Card, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatCnpj } from "@/lib/format";
import { cargoDoModelo, type CargoOpcao } from "@/lib/cargo";

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
  return texto ? <p role="alert" className="text-sm font-semibold text-rose-600">{texto}</p> : null;
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
      <div>
        <h1 className="text-2xl font-extrabold">Grupos, Empresas e Vagas</h1>
        <p className="text-sm text-slate-500">Primeiro o grupo, depois a empresa do grupo, depois a vaga da empresa.</p>
      </div>
      <div className="flex gap-2">
        {abas.map((item) => (
          <button key={item.id} type="button" onClick={() => abrir(item.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${aba === item.id ? "bg-navy-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
            {item.label}
          </button>
        ))}
      </div>
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
  return <p className="text-sm text-rose-600">{error.message}</p>;
}

function AbaGrupo({ selecionado, onSelect }: { selecionado: string; onSelect: (id: string) => void }) {
  const client = useQueryClient();
  const grupos = useQuery({ queryKey: ["grupos"], queryFn: () => api<Grupo[]>("/api/v1/grupos") });
  const detalhe = useQuery({
    queryKey: ["grupo", selecionado],
    enabled: Boolean(selecionado),
    queryFn: () => api<GrupoDetalhe>(`/api/v1/grupos/${selecionado}`),
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
        <div><Button type="button" variant="secondary" onClick={() => onSelect("")}>Voltar</Button></div>
        {detalhe.isLoading ? <p className="text-sm text-slate-500">Carregando empresas do grupo…</p> : null}
        {detalhe.isError ? <Erro error={detalhe.error} /> : null}
        {grupo ? (
          <Card className="grid gap-4">
            <div>
              <h2 className="text-xl font-extrabold">{grupo.nome}</h2>
              <p className="text-sm text-slate-600">{[grupo.email, grupo.telefone].filter(Boolean).join(" · ") || "Sem contato"}</p>
            </div>
            <h3 className="text-sm font-bold text-slate-700">Empresas associadas</h3>
            {grupo.empresas.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-slate-500"><tr className="border-b"><th className="py-2 pr-3">Empresa</th><th className="py-2 pr-3">CNPJ</th><th className="py-2">Endereço</th></tr></thead>
                  <tbody>
                    {grupo.empresas.map((empresa) => (
                      <tr key={empresa.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-3">
                          <div className="font-semibold">{empresa.nome_fantasia || empresa.razao_social}</div>
                          <div className="text-xs text-slate-500">{empresa.razao_social}</div>
                        </td>
                        <td className="py-2 pr-3">{formatCnpj(empresa.cnpj)}</td>
                        <td className="py-2 text-slate-600">{empresa.local || "Endereço não informado"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">Nenhuma empresa neste grupo.</p>}
          </Card>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card className="content-start">
        <form className="grid content-start gap-3" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <h2 className="font-extrabold">Novo grupo</h2>
          <Erro error={save.error} />
          {save.isSuccess ? <p className="text-sm font-semibold text-emerald-700">Grupo gravado.</p> : null}
          <Field label="Nome"><Input required minLength={2} value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></Field>
          {/* Basta um dos dois contatos: cada um só é exigido enquanto o outro estiver vazio. */}
          <Field label="E-mail"><Input type="email" required={!form.telefone.trim()} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Telefone"><Input required={!form.email.trim()} value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} /></Field>
          <p className="text-xs text-slate-500">E-mail ou telefone, pode informar os dois.</p>
          <Button disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar grupo"}</Button>
        </form>
      </Card>
      <Card className="grid content-start gap-3">
        <Field label="Pesquisar grupo">
          <Input value={busca} placeholder="Nome, e-mail ou telefone" autoComplete="off" onChange={(event) => setBusca(event.target.value)} />
        </Field>
        {grupos.isLoading ? <p className="text-sm text-slate-500">Carregando grupos…</p> : grupos.isError ? <Erro error={grupos.error} /> : lista.length ? (
          <div className="grid max-h-[36rem] gap-1 overflow-y-auto">
            {lista.map((item) => (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} className="rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="block font-semibold">{item.nome}</span>
                <span className="block text-xs text-slate-500">{[item.email, item.telefone].filter(Boolean).join(" · ") || "Sem contato"}</span>
              </button>
            ))}
          </div>
        ) : <Empty title="Nenhum grupo" text={busca.trim() ? "Nenhum grupo encontrado para essa pesquisa." : "Cadastre o grupo antes da empresa."} />}
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
    <form className="grid w-full gap-3" onSubmit={(event) => { event.preventDefault(); if (!form.grupo_id) { setAviso("Escolha o grupo da empresa."); return; } setAviso(""); save.mutate(); }}>
      <Erro error={save.error} />
      <Aviso texto={aviso} />
      {save.isSuccess ? <p className="text-sm font-semibold text-emerald-700">{save.data.data.reativada ? "Empresa reativada e copiada para o grupo." : "Empresa gravada."}</p> : null}
      <Card className="grid gap-3 md:grid-cols-3">
        <Field label="Grupo">
          <BuscaOpcao
            value={form.grupo_id}
            onChange={(grupoId) => setForm({ ...form, grupo_id: grupoId })}
            opcoes={(grupos.data?.data ?? []).map((grupo) => ({ id: grupo.id, label: grupo.nome }))}
            placeholder="Pesquisar grupo"
          />
        </Field>
        <Field label="CNPJ"><Input required value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} /></Field>
        <Field label="Razão social"><Input required value={form.razao_social} onChange={(event) => setForm({ ...form, razao_social: event.target.value })} /></Field>
        <Field label="Nome fantasia"><Input required value={form.nome_fantasia} onChange={(event) => setForm({ ...form, nome_fantasia: event.target.value })} /></Field>
        <Field label="CEP"><Input required value={form.cep} onBlur={() => void buscarCep()} onChange={(event) => setForm({ ...form, cep: event.target.value })} /></Field>
        <Field label="Endereço"><Input required value={form.logradouro} onChange={(event) => setForm({ ...form, logradouro: event.target.value })} /></Field>
        <Field label="Número"><Input value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} /></Field>
        <Field label="Complemento"><Input value={form.complemento} onChange={(event) => setForm({ ...form, complemento: event.target.value })} /></Field>
        <Field label="Bairro"><Input required value={form.bairro} onChange={(event) => setForm({ ...form, bairro: event.target.value })} /></Field>
        <Field label="Cidade"><Input required value={form.cidade} onChange={(event) => setForm({ ...form, cidade: event.target.value })} /></Field>
        <Field label="UF"><Input required minLength={2} maxLength={2} value={form.uf} onChange={(event) => setForm({ ...form, uf: event.target.value })} /></Field>
        <Field label="E-mail"><Input type="email" required={!form.telefone.trim()} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Telefone"><Input required={!form.email.trim()} value={form.telefone} onChange={(event) => setForm({ ...form, telefone: event.target.value })} /></Field>
        <p className="text-xs text-slate-500">E-mail ou telefone, pode informar os dois.</p>
      </Card>
      {avisoCep ? <p className="text-sm text-amber-700">{avisoCep}</p> : null}
      <div><Button disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar empresa"}</Button></div>
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
};
type Modelo = { vagaId: string; empresaNome?: string; formulario: Omit<FormularioVaga, "cargo_id"> & { cargo_id: string | null } };
const NOVO_CARGO = "novo";
const novoCargoVazio = { nome: "", descricao: "", requisitos: "" };
const vagaVazia: FormularioVaga & { empresa_id: string; quantidade: string } = {
  empresa_id: "", tipo: "estagio", carga_horaria: "30", cargo: "", cargo_id: "", salario: "", horario_entrada: "", horario_saida: "",
  sexo: "I", idade: "", idade_ate: "", atividades: "", quantidade: "1",
  segunda_entrada: "", segunda_saida: "", terca_entrada: "", terca_saida: "", quarta_entrada: "", quarta_saida: "",
  quinta_entrada: "", quinta_saida: "", sexta_entrada: "", sexta_saida: "", sab_entrada: "", sab_saida: "",
  domingo_entrada: "", domingo_saida: "",
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
 * Preenche os dias a partir de segunda com a entrada e a saída, até cobrir a carga.
 * Um dia editado à mão (diferente do horário base anterior) fica como está.
 */
function preencherDias<T extends FormularioVaga>(atual: T, proximo: T): T {
  const dias = diasPelaCarga(proximo.carga_horaria, proximo.horario_entrada, proximo.horario_saida);
  if (dias == null) return proximo;
  const resultado: Record<string, string> = { ...proximo };
  DIAS_SEMANA.forEach((dia, indice) => {
    const entrada = `${dia}_entrada` as keyof FormularioVaga;
    const saida = `${dia}_saida` as keyof FormularioVaga;
    const vazio = !atual[entrada] && !atual[saida];
    const automatico = atual[entrada] === atual.horario_entrada && atual[saida] === atual.horario_saida;
    if (!vazio && !automatico) return;
    resultado[entrada] = indice < dias ? proximo.horario_entrada : "";
    resultado[saida] = indice < dias ? proximo.horario_saida : "";
  });
  return resultado as T;
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
  const carga = modelo.formulario.carga_horaria ? `${modelo.formulario.carga_horaria}h` : "";
  return [modelo.formulario.cargo || "Sem cargo", tipo, carga].filter(Boolean).join(" · ");
}

function rotulosDistintos(lista: Modelo[]) {
  const bases = lista.map(rotuloModelo);
  const vezes = new Map<string, number>();
  for (const base of bases) vezes.set(base, (vezes.get(base) ?? 0) + 1);
  return lista.map((modelo, index) => {
    const base = bases[index] ?? "";
    if ((vezes.get(base) ?? 0) < 2) return base;
    const sexo = modelo.formulario.sexo === "M" ? "Masculino" : modelo.formulario.sexo === "F" ? "Feminino" : "";
    const idade = modelo.formulario.idade
      ? `${modelo.formulario.idade}${modelo.formulario.idade_ate ? ` a ${modelo.formulario.idade_ate}` : ""}`
      : "";
    const extra = [modelo.empresaNome, sexo, idade].filter(Boolean).join(" · ");
    return extra ? `${base} · ${extra}` : base;
  });
}

function AbaVaga({ empresaInicial, modeloInicial }: { empresaInicial: string; modeloInicial: string }) {
  const empresas = useQuery({ queryKey: ["empresas-tela"], queryFn: () => api<Empresa[]>("/api/v1/grupos-empresas/empresas") });
  const [form, setForm] = useState({ ...vagaVazia, empresa_id: empresaInicial });
  const [aviso, setAviso] = useState("");
  const queryClient = useQueryClient();
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api<CargoOpcao[]>("/api/v1/cargos") });
  const listaCargos = cargos.data?.data ?? [];
  const [cargoNovo, setCargoNovo] = useState<typeof novoCargoVazio | null>(null);
  const [textoCargo, setTextoCargo] = useState("");
  const [buscaModelo, setBuscaModelo] = useState("");
  const [modeloAberto, setModeloAberto] = useState(false);
  const aplicouModelo = useRef(false);
  const modelos = useQuery({
    queryKey: ["modelos-vaga", form.empresa_id],
    enabled: Boolean(form.empresa_id),
    queryFn: () => api<Modelo[]>(`/api/v1/grupos-empresas/vagas?repetidas=${form.empresa_id}`),
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
    setForm((atual) => ({ ...atual, ...modelo.formulario, ...doCargo, empresa_id: atual.empresa_id || empresaInicial, quantidade: atual.quantidade }));
  }, [detalhe.data, cargos.isFetched, empresaInicial]);
  const assinaturaHorario = [
    form.tipo, form.horario_entrada, form.horario_saida,
    form.segunda_entrada, form.segunda_saida, form.terca_entrada, form.terca_saida,
    form.quarta_entrada, form.quarta_saida, form.quinta_entrada, form.quinta_saida,
    form.sexta_entrada, form.sexta_saida, form.sab_entrada, form.sab_saida,
    form.domingo_entrada, form.domingo_saida,
  ].join("|");
  useEffect(() => {
    const calculada = cargaDoHorario(form);
    if (!calculada) return;
    setForm((atual) => atual.carga_horaria === calculada ? atual : { ...atual, carga_horaria: calculada });
  }, [assinaturaHorario]);
  const save = useMutation({
    mutationFn: () => {
      const { cargo: _cargo, cargo_id, descricao: _descricao, requisitos: _requisitos, ...resto } = form;
      const body = { ...limpar(resto), ...(cargoNovo ? { novo_cargo: cargoNovo } : cargo_id ? { cargo_id } : {}) };
      return api<{ codigo: string; quantidade: number; cargo: { nome: string; reaproveitado: boolean } }>("/api/v1/grupos-empresas/vagas", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      if (cargoNovo) void queryClient.invalidateQueries({ queryKey: ["cargos"] });
    },
  });
  /** Cargo do modelo aplicado: da lista, ou "Novo cargo" já com o nome do modelo. */
  function cargoDoFormulario(modelo: Modelo) {
    const cargo = cargoDoModelo(modelo.formulario, listaCargos);
    setCargoNovo(cargo ? null : { ...novoCargoVazio, nome: modelo.formulario.cargo });
    return { cargo_id: cargo?.id ?? "", cargo: cargo?.nome ?? modelo.formulario.cargo };
  }
  function escolherCargo(id: string) {
    if (id === NOVO_CARGO) {
      const nome = textoCargo.trim() && textoCargo !== "+ Novo cargo" ? textoCargo.trim() : "";
      setCargoNovo((atual) => atual ?? { ...novoCargoVazio, nome });
      setForm((atual) => ({ ...atual, cargo_id: "" }));
      return;
    }
    // Digitar no campo limpa a escolha; no modo "Novo cargo" os textos já digitados ficam.
    if (!id && cargoNovo) return;
    setCargoNovo(null);
    setForm((atual) => ({ ...atual, cargo_id: id, cargo: listaCargos.find((cargo) => cargo.id === id)?.nome ?? "" }));
  }
  const cargas = form.tipo === "estagio" ? ["20", "30"] : ["40", "44"];
  const lista = modelos.data?.data ?? [];
  const termoModelo = normalizarBusca(buscaModelo);
  const rotulos = rotulosDistintos(lista);
  const modelosVisiveis = lista
    .map((modelo, index) => ({ modelo, rotulo: rotulos[index] ?? rotuloModelo(modelo) }))
    .filter((item) => normalizarBusca(item.rotulo).includes(termoModelo))
    .slice(0, 20);
  function aplicarModelo(modelo: Modelo, rotulo: string) {
    setBuscaModelo(rotulo);
    setModeloAberto(false);
    const doCargo = cargoDoFormulario(modelo);
    setForm((atual) => ({ ...atual, ...modelo.formulario, ...doCargo, empresa_id: atual.empresa_id, quantidade: atual.quantidade }));
  }
  return (
    <form className="grid w-full gap-3" onSubmit={(event) => { event.preventDefault(); const falta = !form.empresa_id ? "Escolha a empresa da vaga." : !form.cargo_id && !cargoNovo ? "Escolha um cargo da lista ou \"+ Novo cargo\"." : ""; setAviso(falta); if (!falta) save.mutate(); }}>
      <Erro error={save.error} />
      <Aviso texto={aviso} />
      <Erro error={detalhe.error} />
      <Erro error={cargos.error} />
      {save.isSuccess ? <p className="text-sm font-semibold text-emerald-700">{save.data.data.quantidade} vaga(s) abertas com o código {save.data.data.codigo}.{save.data.data.cargo.reaproveitado ? ` O cargo ${save.data.data.cargo.nome} já existia: a vaga usa a descrição e os requisitos dele.` : ""}</p> : null}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
        <Field label="Empresa">
          <BuscaOpcao
            value={form.empresa_id}
            onChange={(empresaId) => setForm({ ...form, empresa_id: empresaId })}
            opcoes={(empresas.data?.data ?? []).map((empresa) => ({ id: empresa.id, label: empresa.nome_fantasia || empresa.razao_social }))}
            placeholder="Pesquisar empresa"
          />
        </Field>
        </div>
        {form.empresa_id ? (
          <div className="sm:col-span-2">
          <Field label="Modelo">
            <div className="relative">
              <Input
                value={buscaModelo}
                placeholder={modelos.isLoading ? "Carregando modelos…" : lista.length ? "Pesquisar modelo do grupo" : "Nenhum modelo deste grupo"}
                autoComplete="off"
                onChange={(event) => { setBuscaModelo(event.target.value); setModeloAberto(true); }}
                onFocus={() => setModeloAberto(true)}
                onBlur={() => window.setTimeout(() => setModeloAberto(false), 150)}
              />
              {modeloAberto ? (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {modelosVisiveis.length ? modelosVisiveis.map(({ modelo, rotulo }) => (
                    <li key={modelo.vagaId}>
                      <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={(event) => { event.preventDefault(); aplicarModelo(modelo, rotulo); }}>
                        {rotulo}
                      </button>
                    </li>
                  )) : <li className="px-3 py-2 text-sm text-slate-500">{lista.length ? "Nenhum modelo encontrado" : "Nenhum modelo deste grupo"}</li>}
                </ul>
              ) : null}
            </div>
          </Field>
          </div>
        ) : null}
        <Field label="Tipo">
          <Select value={form.tipo} onChange={(event) => {
            const tipo = event.target.value;
            setForm((atual) => preencherDias(atual, { ...atual, tipo, carga_horaria: tipo === "estagio" ? "30" : "40" }));
          }}>
            <option value="estagio">Estágio</option>
            <option value="clt">CLT</option>
          </Select>
        </Field>
        <Field label="Carga horária">
          <Select value={form.carga_horaria} onChange={(event) => { const carga_horaria = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, carga_horaria })); }}>
            {cargas.map((carga) => <option key={carga} value={carga}>{carga} horas</option>)}
          </Select>
        </Field>
        <Field label="Cargo">
          <BuscaOpcao
            value={cargoNovo ? NOVO_CARGO : form.cargo_id}
            onChange={escolherCargo}
            opcoes={listaCargos.map((cargo) => ({ id: cargo.id, label: cargo.nome }))}
            fixas={[{ id: NOVO_CARGO, label: "+ Novo cargo" }]}
            onTexto={setTextoCargo}
            placeholder={cargos.isLoading ? "Carregando cargos…" : "Pesquisar cargo"}
          />
        </Field>
        <Field label="Salário"><Input required placeholder="1800,00" value={form.salario} onChange={(event) => setForm({ ...form, salario: event.target.value })} /></Field>
        <Field label="Entrada"><Input type="time" required value={form.horario_entrada} onChange={(event) => { const horario_entrada = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, horario_entrada })); }} /></Field>
        <Field label="Saída"><Input type="time" required value={form.horario_saida} onChange={(event) => { const horario_saida = event.target.value; setForm((atual) => preencherDias(atual, { ...atual, horario_saida })); }} /></Field>
        <Field label="Sexo">
          <Select value={form.sexo} onChange={(event) => setForm({ ...form, sexo: event.target.value })}>
            <option value="I">Indiferente</option>
            <option value="F">Feminino</option>
            <option value="M">Masculino</option>
          </Select>
        </Field>
        <Field label="Idade"><Input type="number" required min={14} max={80} value={form.idade} onChange={(event) => setForm({ ...form, idade: event.target.value })} /></Field>
        <Field label="Idade até"><Input type="number" required min={14} max={80} value={form.idade_ate} onChange={(event) => setForm({ ...form, idade_ate: event.target.value })} /></Field>
        <Field label="Quantidade"><Input type="number" required min={1} max={20} value={form.quantidade} onChange={(event) => setForm({ ...form, quantidade: event.target.value })} /></Field>
        <div className="grid gap-2 sm:col-span-2 lg:col-span-4">
          <p className="text-sm font-medium text-slate-700">Dias do horário</p>
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {diasHorario.map((dia) => (
              <div key={dia.nome} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
                <span className="text-sm text-slate-600">{dia.nome}</span>
                <Input type="time" className="min-w-0" aria-label={`${dia.nome} entrada`} value={form[dia.entrada]} onChange={(event) => setForm({ ...form, [dia.entrada]: event.target.value })} />
                <Input type="time" className="min-w-0" aria-label={`${dia.nome} saída`} value={form[dia.saida]} onChange={(event) => setForm({ ...form, [dia.saida]: event.target.value })} />
              </div>
            ))}
          </div>
        </div>
        {cargoNovo ? (
          <div className="grid gap-3 rounded-xl border border-dashed border-slate-300 p-3 sm:col-span-2 lg:col-span-4">
            <p className="text-sm font-medium text-slate-700">Novo cargo: a descrição e os requisitos valem para todas as vagas deste cargo.</p>
            <Field label="Nome do cargo"><Input required minLength={2} value={cargoNovo.nome} onChange={(event) => setCargoNovo({ ...cargoNovo, nome: event.target.value })} /></Field>
            <Field label="Descrição"><Textarea required minLength={3} className="min-h-20" value={cargoNovo.descricao} onChange={(event) => setCargoNovo({ ...cargoNovo, descricao: event.target.value })} /></Field>
            <Field label="Requisitos"><Textarea required minLength={3} className="min-h-20" value={cargoNovo.requisitos} onChange={(event) => setCargoNovo({ ...cargoNovo, requisitos: event.target.value })} /></Field>
          </div>
        ) : null}
        <div className="sm:col-span-2 lg:col-span-4"><Field label="Atividades"><Textarea required minLength={3} className="min-h-20" value={form.atividades} onChange={(event) => setForm({ ...form, atividades: event.target.value })} /></Field></div>
      </Card>
      <div><Button disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar vaga"}</Button></div>
    </form>
  );
}
