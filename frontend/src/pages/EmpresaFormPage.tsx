import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  razao_social: z.string().min(3),
  nome_fantasia: z.string().optional(),
  cnpj: z.string().min(14),
  email: z.string().trim().refine((value) => !value || z.string().email().safeParse(value).success, "E-mail inválido."),
  telefone: z.string().optional(),
  celular: z.string().optional(),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  responsavel: z.string().optional(),
  matriz: z.string().optional(),
  obs: z.string().optional(),
});
type Form = z.infer<typeof schema>;

function compact<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function diferencas<T extends Record<string, unknown>>(values: T, base: T | null) {
  if (!base) return compact(values);
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => String(value ?? "") !== String(base[key] ?? "")));
}

function mensagemErro(error: unknown) {
  if (!(error instanceof ApiError)) return "";
  const details = error.details;
  if (Array.isArray(details)) {
    const item = details.find((entry) => entry && typeof entry === "object" && "message" in entry) as { message?: string } | undefined;
    if (item?.message) return item.message;
  }
  return error.message;
}

export function EmpresaFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const current = useQuery({ queryKey: ["empresa", id], enabled: Boolean(id), queryFn: () => api<Form>(`/api/v1/empresas/${id}`) });
  const form = useForm<Form>({ resolver: zodResolver(schema) });
  const base = useRef<Form | null>(null);
  useEffect(() => {
    if (!current.data || base.current) return;
    const data = Object.fromEntries(
      Object.entries(current.data.data).map(([key, value]) => [key, value ?? ""]),
    ) as Form;
    if (id && data.matriz === id) data.matriz = "";
    base.current = data;
    form.reset(data);
  }, [current.data, form, id]);
  const save = useMutation({
    mutationFn: (values: Form) => {
      const payload = id ? diferencas(values, base.current) : compact(values);
      if (id && Object.keys(payload).length === 0) throw new ApiError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo foi alterado.");
      return id
        ? api(`/api/v1/empresas/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<{ id_empresa: string }>("/api/v1/empresas", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (result) => navigate(`/empresas/${id ?? (result.data as { id_empresa: string }).id_empresa}`),
  });
  const erro = mensagemErro(save.error) || (form.formState.submitCount > 0 && !form.formState.isValid ? "Revise os campos marcados antes de salvar." : "");
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-extrabold">{id ? "Editar empresa" : "Nova empresa"}</h1><Button type="submit" disabled={save.isPending}>Salvar</Button></div>
      {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="Razão social" error={form.formState.errors.razao_social?.message}><Input {...form.register("razao_social")} /></Field>
        <Field label="Nome fantasia"><Input {...form.register("nome_fantasia")} /></Field>
        <Field label="CNPJ" error={form.formState.errors.cnpj?.message}><Input {...form.register("cnpj")} /></Field>
        <Field label="E-mail" error={form.formState.errors.email?.message}><Input type="email" {...form.register("email")} /></Field>
        <Field label="Telefone"><Input {...form.register("telefone")} /></Field>
        <Field label="Celular"><Input {...form.register("celular")} /></Field>
        <Field label="Responsável"><Input {...form.register("responsavel")} /></Field>
        <Field label="Matriz (ID existente)"><Input {...form.register("matriz")} /></Field>
        <Field label="CEP"><Input {...form.register("cep")} /></Field>
        <Field label="Logradouro"><Input {...form.register("logradouro")} /></Field>
        <Field label="Número"><Input {...form.register("numero")} /></Field>
        <Field label="Bairro"><Input {...form.register("bairro")} /></Field>
        <Field label="Cidade"><Input {...form.register("cidade")} /></Field>
        <Field label="UF"><Input maxLength={2} {...form.register("uf")} /></Field>
        <div className="md:col-span-2"><Field label="Observações"><Textarea {...form.register("obs")} /></Field></div>
      </Card>
      <div className="flex justify-end"><Button type="submit" disabled={save.isPending}>Salvar</Button></div>
    </form>
  );
}
