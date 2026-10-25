import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  id_empresa: z.string().min(1, "Selecione a empresa."),
  cargo: z.string().min(2),
  tipo_vaga: z.coerce.number().int().positive(),
  salario: z.string().optional(),
  quantidade_posicoes: z.coerce.number().int().positive("Informe ao menos 1 posição."),
  carga_horaria: z.string().optional(),
  obs: z.string().optional(),
});
type Form = z.infer<typeof schema>;
type Company = { id_empresa: string; razao_social: string; nome_fantasia: string | null };
type Mode = { id: number; descricao: string };

export function VagaFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const empresaId = params.get("empresa") ?? "";
  const companies = useQuery({ queryKey: ["empresas-opcoes"], queryFn: () => api<Company[]>("/api/v1/empresas?pageSize=100") });
  const escolhida = useQuery({ queryKey: ["empresa", empresaId], enabled: Boolean(empresaId), queryFn: () => api<Company>(`/api/v1/empresas/${empresaId}`) });
  const modes = useQuery({ queryKey: ["modalidades"], queryFn: () => api<Mode[]>("/api/v1/modalidades") });
  const current = useQuery({ queryKey: ["vaga", id], enabled: Boolean(id), queryFn: () => api<Form & { salario: number | null; razao_social?: string | null; nome_fantasia?: string | null }>(`/api/v1/vagas/${id}`) });
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { id_empresa: params.get("empresa") ?? "", quantidade_posicoes: 1, tipo_vaga: 2 } });
  useEffect(() => {
    if (!current.data) return;
    const data = current.data.data;
    form.reset({ ...data, salario: data.salario == null ? "" : String(data.salario).replace(".", ",") });
  }, [current.data, form]);
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
      <div className="flex items-center justify-between"><h1 className="text-2xl font-extrabold">{id ? "Editar vaga" : "Nova vaga"}</h1><Button disabled={save.isPending}>Salvar</Button></div>
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
        <Field label="Quantidade de posições" error={form.formState.errors.quantidade_posicoes?.message}><Input type="number" min={1} {...form.register("quantidade_posicoes")} /></Field>
        <Field label="Carga horária"><Input {...form.register("carga_horaria")} /></Field>
        <div className="md:col-span-2"><Field label="Observações"><Textarea {...form.register("obs")} /></Field></div>
      </Card>
    </form>
  );
}
