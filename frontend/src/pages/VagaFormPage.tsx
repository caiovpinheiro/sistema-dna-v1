import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { textoPlano } from "@/lib/format";

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
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { id_empresa: params.get("empresa") ?? "", quantidade_posicoes: 1, tipo_vaga: 2 } });
  useEffect(() => {
    if (!current.data) return;
    const data = current.data.data;
    form.reset({ ...data, salario: data.salario == null ? "" : String(data.salario).replace(".", ","), km: data.km ?? "", atribuicaoes: textoPlano(data.atribuicaoes), atribu_contrato: textoPlano(data.atribu_contrato), requisitos_desejaveis: textoPlano(data.requisitos_desejaveis), destaque: textoPlano(data.destaque) });
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
    });
  }, [modelo.data, id, form, empresaId]);
  const save = useMutation({
    mutationFn: (values: Form) => {
      const payload = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ""));
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
        <Field label="Modalidade">
          <Select {...form.register("tipo_vaga")}>{modes.data?.data.map((item) => <option key={item.id} value={item.id}>{item.descricao}</option>)}</Select>
        </Field>
        <Field label="Salário ou bolsa"><Input placeholder="2.000,00" {...form.register("salario")} /></Field>
        <Field label="Quantidade de vagas" error={form.formState.errors.quantidade_posicoes?.message}><Input type="number" min={1} {...form.register("quantidade_posicoes")} /></Field>
        <Field label="Distância (km)"><Input {...form.register("km")} /></Field>
        <Field label="Carga horária"><Input {...form.register("carga_horaria")} /></Field>
        <div className="md:col-span-2"><Field label="Atividades da vaga"><Textarea {...form.register("atribuicaoes")} /></Field></div>
        <div className="md:col-span-2"><Field label="Atividades no contrato"><Textarea {...form.register("atribu_contrato")} /></Field></div>
        <div className="md:col-span-2"><Field label="Requisitos desejáveis"><Textarea {...form.register("requisitos_desejaveis")} /></Field></div>
        <div className="md:col-span-2"><Field label="Destaques"><Textarea {...form.register("destaque")} /></Field></div>
        <div className="md:col-span-2"><Field label="Observações"><Textarea {...form.register("obs")} /></Field></div>
      </Card>
    </form>
  );
}
