import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
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
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">{id ? "Editar vaga" : "Nova vaga"}</h1>
          {modelo.data?.data.nome ? <p className="text-sm text-slate-500">Modelo: {modelo.data.data.nome}</p> : null}
        </div>
        <Button disabled={save.isPending}>Salvar</Button>
      </div>
      {modelo.isLoading ? <p className="text-sm text-slate-500">Carregando modelo…</p> : null}
      {modelo.isError ? <p className="text-sm text-rose-600">Não foi possível carregar o modelo.</p> : null}
      {save.error instanceof ApiError ? <p className="text-sm text-rose-600">{save.error.message}</p> : null}
      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="Empresa" error={form.formState.errors.id_empresa?.message}>
          <Select disabled={Boolean(id)} {...form.register("id_empresa")}>
            <option value="">Selecione</option>
            {opcoes.map((item) => <option key={item.id_empresa} value={item.id_empresa}>{item.nome_fantasia || item.razao_social}</option>)}
          </Select>
        </Field>
        <Field label="Cargo" error={form.formState.errors.cargo?.message}><Input {...form.register("cargo")} /></Field>
        <Field label="Situação">
          <Select {...form.register("situacao")}>{STATUS_VAGA.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</Select>
        </Field>
        <Field label="Modalidade">
          <Select {...form.register("tipo_vaga")}>{modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}</Select>
        </Field>
        <Field label="Salário ou bolsa"><Input placeholder="2.000,00" {...form.register("salario")} /></Field>
        <Field label="Quantidade de vagas" error={form.formState.errors.quantidade_posicoes?.message}><Input type="number" min={1} {...form.register("quantidade_posicoes")} /></Field>
        <Field label="Distância (km)"><Input {...form.register("km")} /></Field>
        <Field label="Carga horária"><Input {...form.register("carga_horaria")} /></Field>
        <Field label="Sexo">
          <Select {...form.register("sexo")}>
            <option value="M">Masculina</option>
            <option value="F">Feminina</option>
            <option value="I">Aceita os dois</option>
          </Select>
        </Field>
        <Field label="Entrada"><Input placeholder="08:00" {...form.register("horabase")} /></Field>
        <Field label="Saída"><Input placeholder="17:00" {...form.register("hora_saida_base")} /></Field>
        <div className="md:col-span-2 grid gap-3">
          <p className="text-sm font-semibold">Horários</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {dias.map(([nome, entrada, saida], indice) => (
              <div key={nome} className="grid grid-cols-[5.5rem_6.5rem_1fr_1fr] items-end gap-2">
                <p className="pb-2 text-sm text-slate-500">{nome}</p>
                <Field label="Tipo">
                  <Select value={modos[indice]} onChange={(event) => trocarModo(indice, event.target.value as ModoDia)}>
                    <option value="fixo">Fixo</option>
                    <option value="escala">Escala</option>
                    <option value="folga">Folga</option>
                  </Select>
                </Field>
                <Field label="Entrada"><Input placeholder="08:00" readOnly={modos[indice] === "folga"} {...form.register(entrada)} /></Field>
                <Field label="Saída"><Input placeholder="17:00" readOnly={modos[indice] === "folga"} {...form.register(saida)} /></Field>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 grid gap-1">
          <Field label="Texto do horário"><Textarea {...form.register("texto_carga")} /></Field>
          <div><Button type="button" variant="secondary" onClick={() => form.setValue("texto_carga", textoPelosDias(modos), { shouldDirty: true })}>Gerar texto pelos dias</Button></div>
        </div>
        <div className="md:col-span-2"><Field label="Atividades da vaga"><Textarea {...form.register("atribuicaoes")} /></Field></div>
        <div className="md:col-span-2"><Field label="Benefícios"><Textarea className="min-h-24" placeholder={"Um por linha. Ex.: Auxílio Transporte — Mensal"} {...form.register("beneficios")} /></Field></div>
        <div className="md:col-span-2"><Field label="Atividades no contrato"><Textarea {...form.register("atribu_contrato")} /></Field></div>
        <div className="md:col-span-2"><Field label="Requisitos desejáveis"><Textarea {...form.register("requisitos_desejaveis")} /></Field></div>
        <div className="md:col-span-2"><Field label="Destaques"><Textarea {...form.register("destaque")} /></Field></div>
        <div className="md:col-span-2"><Field label="Observações"><Textarea {...form.register("obs")} /></Field></div>
      </Card>
    </form>
  );
}
