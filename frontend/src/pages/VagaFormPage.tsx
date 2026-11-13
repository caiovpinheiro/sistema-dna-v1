import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save, Wand2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { STATUS_VAGA, textoPlano } from "@/lib/format";
import { diasPorEscala, textoDoHorario, type ModoDia } from "@/lib/horario-escala";

const schema = z.object({
  id_empresa: z.string().min(1, "Selecione a empresa."),
  cargo: z.string().min(2),
  tipo_vaga: z.coerce.number().int().positive(),
  salario: z.string().optional(),
  quantidade_posicoes: z.coerce.number().int().positive("Informe ao menos 1 posição."),
  carga_horaria: z.string().optional(),
  km: z.string().optional(),
  atribuicaoes: z.string().optional(),
  atribu_contrato: z.string().optional(),
  requisitos_desejaveis: z.string().optional(),
  destaque: z.string().optional(),
  obs: z.string().optional(),
  horabase: z.string().optional(),
  hora_saida_base: z.string().optional(),
  segunda_entrada: z.string().optional(),
  segunda_saida: z.string().optional(),
  terca_entrada: z.string().optional(),
  terca_saida: z.string().optional(),
  quarta_entrada: z.string().optional(),
  quarta_saida: z.string().optional(),
  quinta_entrada: z.string().optional(),
  quinta_saida: z.string().optional(),
  sexta_entrada: z.string().optional(),
  sexta_saida: z.string().optional(),
  sab_entrada: z.string().optional(),
  sab_saida: z.string().optional(),
  domindo_entrada: z.string().optional(),
  domindo_saida: z.string().optional(),
  texto_carga: z.string().optional(),
  sexo: z.enum(["M", "F", "I"]),
  beneficios: z.string().optional(),
  situacao: z.enum(["aberta", "pausada", "contratada", "fechada"]),
});
type Form = z.infer<typeof schema>;
type Company = { id_empresa: string; razao_social: string; nome_fantasia: string | null };
type Mode = { id: number; descricao: string };
type Modelo = {
  id_modelo: number;
  nome: string | null;
  cargo: string | null;
  tipo_vaga: number | string | null;
  salario: string | null;
  km: string | null;
  atribuicaoes: string | null;
  atribu_contrato: string | null;
  requisitos_desejaveis: string | null;
  destaque: string | null;
};

const dias = [
  ["Segunda", "segunda_entrada", "segunda_saida"],
  ["Terça", "terca_entrada", "terca_saida"],
  ["Quarta", "quarta_entrada", "quarta_saida"],
  ["Quinta", "quinta_entrada", "quinta_saida"],
  ["Sexta", "sexta_entrada", "sexta_saida"],
  ["Sábado", "sab_entrada", "sab_saida"],
  ["Domingo", "domindo_entrada", "domindo_saida"],
] as const;

const SEM_HORA = new Set(["", "0", "00:00"]);

/** Bloco numerado do formulário (mesmo visual do gerador de TCE). */
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

const LARGURAS = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" } as const;

/** Célula da grade de 6 colunas: curto (km, quantidade) ocupa 1 ou 2, longo (empresa, cargo) 3 ou 4. */
function Celula({ span, children }: { span: keyof typeof LARGURAS; children: ReactNode }) {
  return <div className={cn("min-w-0", LARGURAS[span])}>{children}</div>;
}

export function VagaFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const empresaId = params.get("empresa") ?? "";
  const modeloId = params.get("modelo") ?? "";
  const companies = useQuery({ queryKey: ["empresas-opcoes"], queryFn: () => api<Company[]>("/api/v1/empresas?pageSize=100") });
  const escolhida = useQuery({ queryKey: ["empresa", empresaId], enabled: Boolean(empresaId), queryFn: () => api<Company>(`/api/v1/empresas/${empresaId}`) });
  const modes = useQuery({ queryKey: ["modalidades"], queryFn: () => api<Mode[]>("/api/v1/modalidades") });
  const modelo = useQuery({ queryKey: ["modelo", modeloId], enabled: Boolean(modeloId) && !id, queryFn: () => api<Modelo>(`/api/v1/modelos/${modeloId}`) });
  const current = useQuery({ queryKey: ["vaga", id], enabled: Boolean(id), queryFn: () => api<Form & { salario: number | null; razao_social?: string | null; nome_fantasia?: string | null }>(`/api/v1/vagas/${id}`) });
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { id_empresa: params.get("empresa") ?? "", quantidade_posicoes: 1, tipo_vaga: 2, sexo: "I", beneficios: "", situacao: "aberta" } });
  // Fixo, Escala ou Folga por dia, na ordem de "dias". Escala vem do texto do horário; dia sem hora é folga.
  const [modos, setModos] = useState<ModoDia[]>(() => dias.map(() => "fixo"));
  function textoPelosDias(atuais: ModoDia[]) {
    const valores = form.getValues();
    return textoDoHorario(dias.map(([, entrada, saida], indice) => ({ modo: atuais[indice], entrada: valores[entrada] ?? "", saida: valores[saida] ?? "" })));
  }
  function trocarModo(indice: number, modo: ModoDia) {
    const [, entrada, saida] = dias[indice];
    if (modo === "folga") {
      form.setValue(entrada, "0");
      form.setValue(saida, "0");
    } else if (SEM_HORA.has(form.getValues(entrada) ?? "")) {
      form.setValue(entrada, form.getValues("horabase") ?? "");
      form.setValue(saida, form.getValues("hora_saida_base") ?? "");
    }
    const atuais = modos.map((item, posicao) => (posicao === indice ? modo : item));
    setModos(atuais);
    form.setValue("texto_carga", textoPelosDias(atuais), { shouldDirty: true });
  }
  useEffect(() => {
    if (!current.data) return;
    const data = current.data.data;
    const hora = (valor: string | null | undefined) => valor ?? "";
    form.reset({
      ...data,
      salario: data.salario == null ? "" : String(data.salario).replace(".", ","),
      km: data.km ?? "",
      atribuicaoes: textoPlano(data.atribuicaoes),
      atribu_contrato: textoPlano(data.atribu_contrato),
      requisitos_desejaveis: textoPlano(data.requisitos_desejaveis),
      destaque: textoPlano(data.destaque),
      horabase: hora(data.horabase),
      hora_saida_base: hora(data.hora_saida_base),
      segunda_entrada: hora(data.segunda_entrada),
      segunda_saida: hora(data.segunda_saida),
      terca_entrada: hora(data.terca_entrada),
      terca_saida: hora(data.terca_saida),
      quarta_entrada: hora(data.quarta_entrada),
      quarta_saida: hora(data.quarta_saida),
      quinta_entrada: hora(data.quinta_entrada),
      quinta_saida: hora(data.quinta_saida),
      sexta_entrada: hora(data.sexta_entrada),
      sexta_saida: hora(data.sexta_saida),
      sab_entrada: hora(data.sab_entrada),
      sab_saida: hora(data.sab_saida),
      domindo_entrada: hora(data.domindo_entrada),
      domindo_saida: hora(data.domindo_saida),
      texto_carga: hora(data.texto_carga),
      sexo: data.sexo === "M" || data.sexo === "F" ? data.sexo : "I",
      beneficios: data.beneficios ?? "",
    });
    const escala = diasPorEscala(data.texto_carga);
    setModos(dias.map(([, entrada], indice) => (SEM_HORA.has(hora(data[entrada])) ? "folga" : escala.has(indice) ? "escala" : "fixo")));
  }, [current.data, form]);
  useEffect(() => {
    const item = modelo.data?.data;
    if (!item || id) return;
    form.reset({
      id_empresa: empresaId,
      cargo: item.cargo ?? "",
      tipo_vaga: Number(item.tipo_vaga) || 2,
      salario: item.salario ? String(item.salario).replace(".", ",") : "",
      quantidade_posicoes: 1,
      carga_horaria: "",
      km: item.km ?? "",
      atribuicaoes: textoPlano(item.atribuicaoes),
      atribu_contrato: textoPlano(item.atribu_contrato),
      requisitos_desejaveis: textoPlano(item.requisitos_desejaveis),
      destaque: textoPlano(item.destaque),
      obs: "",
      sexo: "I",
      beneficios: "",
      situacao: "aberta",
    });
  }, [modelo.data, id, form, empresaId]);
  const save = useMutation({
    mutationFn: (values: Form) => {
      const horas = new Set(["horabase", "hora_saida_base", "segunda_entrada", "segunda_saida", "terca_entrada", "terca_saida", "quarta_entrada", "quarta_saida", "quinta_entrada", "quinta_saida", "sexta_entrada", "sexta_saida", "sab_entrada", "sab_saida", "domindo_entrada", "domindo_saida", "texto_carga", "beneficios"]);
      const payload = Object.fromEntries(Object.entries(values).filter(([chave, value]) => horas.has(chave) || (value !== undefined && value !== null && value !== "")));
      return id
        ? api(`/api/v1/vagas/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<{ id_vaga: string }>("/api/v1/vagas", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (result) => navigate(`/vagas/${id ?? (result.data as { id_vaga: string }).id_vaga}`),
  });
  const atuais = companies.data?.data ?? [];
  const fixa = escolhida.data?.data;
  const daVaga = current.data?.data;
  const extras = [fixa, daVaga?.id_empresa ? { id_empresa: daVaga.id_empresa, razao_social: daVaga.razao_social ?? "", nome_fantasia: daVaga.nome_fantasia ?? null } : null]
    .filter((item): item is Company => Boolean(item?.id_empresa));
  const opcoes = [...extras, ...atuais].filter((item, index, lista) => lista.findIndex((outro) => outro.id_empresa === item.id_empresa) === index);
  const textoSalvar = save.isPending ? "Salvando…" : id ? "Salvar alterações" : "Salvar vaga";
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <CabecalhoPagina
        titulo={id ? "Editar vaga" : "Nova vaga"}
        descricao={modelo.data?.data.nome ? `Modelo: ${modelo.data.data.nome}` : id ? "As mudanças valem para esta vaga. A situação também vai para o sistema antigo; o resto fica só no sistema novo." : undefined}
        acoes={(
          <>
            {id ? <Link to={`/vagas/${id}`}><Button type="button" variant="secondary"><ArrowLeft size={16} /> Voltar para a vaga</Button></Link> : null}
            <Button disabled={save.isPending}><Save size={16} /> {textoSalvar}</Button>
          </>
        )}
      />
      {modelo.isLoading ? <Alerta tom="info">Carregando modelo…</Alerta> : null}
      {modelo.isError ? <Alerta>Não foi possível carregar o modelo.</Alerta> : null}
      {save.error instanceof ApiError ? <Alerta>{save.error.message}</Alerta> : null}
      <Bloco numero={1} titulo="Dados da vaga" texto="Empresa, cargo, situação, modalidade e quantas posições a vaga tem.">
        <div className="grid gap-3 sm:grid-cols-6">
          <Celula span={3}>
            <Field label="Empresa" error={form.formState.errors.id_empresa?.message}>
              <Select disabled={Boolean(id)} className="disabled:opacity-70" {...form.register("id_empresa")}>
                <option value="">Selecione</option>
                {opcoes.map((item) => <option key={item.id_empresa} value={item.id_empresa}>{item.nome_fantasia || item.razao_social}</option>)}
              </Select>
            </Field>
          </Celula>
          <Celula span={3}><Field label="Cargo" error={form.formState.errors.cargo?.message}><Input {...form.register("cargo")} /></Field></Celula>
          <Celula span={2}>
            <Field label="Situação">
              <Select {...form.register("situacao")}>{STATUS_VAGA.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</Select>
            </Field>
          </Celula>
          <Celula span={2}>
            <Field label="Modalidade">
              <Select {...form.register("tipo_vaga")}>{modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}</Select>
            </Field>
          </Celula>
          <Celula span={2}><Field label="Salário ou bolsa"><Input placeholder="2.000,00" {...form.register("salario")} /></Field></Celula>
          <Celula span={2}><Field label="Quantidade de vagas" error={form.formState.errors.quantidade_posicoes?.message}><Input type="number" min={1} {...form.register("quantidade_posicoes")} /></Field></Celula>
          <Celula span={2}><Field label="Carga horária"><Input placeholder="Ex.: 44" {...form.register("carga_horaria")} /></Field></Celula>
          <Celula span={1}><Field label="Distância (km)"><Input {...form.register("km")} /></Field></Celula>
          <Celula span={1}>
            <Field label="Sexo">
              <Select {...form.register("sexo")}>
                <option value="M">Masculina</option>
                <option value="F">Feminina</option>
                <option value="I">Aceita os dois</option>
              </Select>
            </Field>
          </Celula>
        </div>
      </Bloco>
      <Bloco numero={2} titulo="Horário" texto="Entrada e saída padrão e o horário de cada dia. Fixo: toda semana; Escala: conforme a escala da empresa; Folga: não trabalha.">
        <div className="grid gap-3 sm:grid-cols-6">
          <Celula span={1}><Field label="Entrada"><Input placeholder="08:00" {...form.register("horabase")} /></Field></Celula>
          <Celula span={1}><Field label="Saída"><Input placeholder="17:00" {...form.register("hora_saida_base")} /></Field></Celula>
        </div>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {[0, 1].map((coluna) => (
            <div key={coluna} className={cn("hidden grid-cols-[5.5rem_6.5rem_1fr_1fr] gap-2 text-xs font-semibold text-slate-500", coluna === 0 ? "sm:grid" : "md:grid")} aria-hidden>
              <span>Dia</span><span>Tipo</span><span>Entrada</span><span>Saída</span>
            </div>
          ))}
          {dias.map(([nome, entrada, saida], indice) => (
            <div key={nome} className="grid grid-cols-[5.5rem_6.5rem_1fr_1fr] items-center gap-2">
              <p className="text-sm font-medium text-slate-700">{nome}</p>
              <Select aria-label={`${nome}: tipo`} value={modos[indice]} onChange={(event) => trocarModo(indice, event.target.value as ModoDia)}>
                <option value="fixo">Fixo</option>
                <option value="escala">Escala</option>
                <option value="folga">Folga</option>
              </Select>
              <Input aria-label={`${nome}: entrada`} placeholder="08:00" readOnly={modos[indice] === "folga"} className={modos[indice] === "folga" ? "opacity-50" : undefined} {...form.register(entrada)} />
              <Input aria-label={`${nome}: saída`} placeholder="17:00" readOnly={modos[indice] === "folga"} className={modos[indice] === "folga" ? "opacity-50" : undefined} {...form.register(saida)} />
            </div>
          ))}
        </div>
        <div className="grid gap-2">
          <Field label="Texto do horário"><Textarea className="min-h-20" {...form.register("texto_carga")} /></Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => form.setValue("texto_carga", textoPelosDias(modos), { shouldDirty: true })}><Wand2 size={16} /> Gerar texto pelos dias</Button>
            <span className="text-xs text-slate-500">Monta o texto a partir dos dias acima. Revise antes de salvar.</span>
          </div>
        </div>
      </Bloco>
      <Bloco numero={3} titulo="Descrição da vaga" texto="O que a pessoa faz, o que a vaga oferece e o que vai no contrato.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Atividades da vaga"><Textarea {...form.register("atribuicaoes")} /></Field>
          <Field label="Benefícios"><Textarea className="min-h-28" placeholder={"Um por linha. Ex.: Auxílio Transporte — Mensal"} {...form.register("beneficios")} /></Field>
          <Field label="Atividades no contrato"><Textarea {...form.register("atribu_contrato")} /></Field>
          <Field label="Requisitos desejáveis"><Textarea {...form.register("requisitos_desejaveis")} /></Field>
          <Field label="Destaques"><Textarea {...form.register("destaque")} /></Field>
          <Field label="Observações"><Textarea {...form.register("obs")} /></Field>
        </div>
      </Bloco>
      <div className="flex flex-wrap justify-end gap-2">
        {id ? <Link to={`/vagas/${id}`}><Button type="button" variant="secondary">Cancelar</Button></Link> : null}
        <Button disabled={save.isPending}><Save size={16} /> {textoSalvar}</Button>
      </div>
    </form>
  );
}
