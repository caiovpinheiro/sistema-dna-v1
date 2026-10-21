import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  nome: z.string().min(3, "Informe o nome."),
  cpf: z.string().min(11, "Informe o CPF."),
  email: z.string().email("E-mail inválido."),
  celular: z.string().optional(),
  telefonefixo: z.string().optional(),
  datanascimento: z.string().optional(),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  curso: z.string().optional(),
  semestre: z.string().optional(),
  nome_escola: z.string().optional(),
  ctps: z.string().optional(),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  numero_conta: z.string().optional(),
  chave_pix: z.string().optional(),
  obs: z.string().optional(),
});
type Form = z.infer<typeof schema>;

function compact<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

export function CandidatoFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const current = useQuery({
    queryKey: ["candidato", id],
    enabled: Boolean(id),
    queryFn: () => api<Form & { id_candidato: string }>(`/api/v1/candidatos/${id}`),
  });
  const form = useForm<Form>({ resolver: zodResolver(schema) });
  useEffect(() => { if (current.data) form.reset(current.data.data); }, [current.data, form]);
  const save = useMutation({
    mutationFn: (values: Form) => id
      ? api(`/api/v1/candidatos/${id}`, { method: "PATCH", body: JSON.stringify(compact(values)) })
      : api<{ id_candidato: string }>("/api/v1/candidatos", { method: "POST", body: JSON.stringify(compact(values)) }),
    onSuccess: (result) => navigate(`/candidatos/${id ?? (result.data as { id_candidato: string }).id_candidato}`),
  });
  const error = save.error instanceof ApiError ? save.error.message : "";
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <div className="flex items-center justify-between"><h1 className="text-2xl font-extrabold">{id ? "Editar candidato" : "Novo candidato"}</h1><Button type="submit" disabled={save.isPending}>Salvar</Button></div>
      {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
      <Card className="grid gap-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-bold">Identificação</h2>
        <Field label="Nome" error={form.formState.errors.nome?.message}><Input {...form.register("nome")} /></Field>
        <Field label="CPF" error={form.formState.errors.cpf?.message}><Input {...form.register("cpf")} /></Field>
        <Field label="E-mail" error={form.formState.errors.email?.message}><Input type="email" {...form.register("email")} /></Field>
        <Field label="Nascimento"><Input type="date" {...form.register("datanascimento")} /></Field>
        <Field label="Celular"><Input {...form.register("celular")} /></Field>
        <Field label="Telefone fixo"><Input {...form.register("telefonefixo")} /></Field>
      </Card>
      <Card className="grid gap-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-bold">Endereço</h2>
        <Field label="CEP"><Input {...form.register("cep")} /></Field>
        <Field label="Logradouro"><Input {...form.register("logradouro")} /></Field>
        <Field label="Número"><Input {...form.register("numero")} /></Field>
        <Field label="Bairro"><Input {...form.register("bairro")} /></Field>
        <Field label="Cidade"><Input {...form.register("cidade")} /></Field>
        <Field label="UF"><Input maxLength={2} {...form.register("estado")} /></Field>
      </Card>
      <Card className="grid gap-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-bold">Estágio e CLT</h2>
        <Field label="Instituição"><Input {...form.register("nome_escola")} /></Field>
        <Field label="Curso"><Input {...form.register("curso")} /></Field>
        <Field label="Semestre"><Input {...form.register("semestre")} /></Field>
        <Field label="CTPS"><Input {...form.register("ctps")} /></Field>
        <Field label="Banco"><Input {...form.register("banco")} /></Field>
        <Field label="Agência"><Input {...form.register("agencia")} /></Field>
        <Field label="Conta"><Input {...form.register("numero_conta")} /></Field>
        <Field label="Chave Pix"><Input {...form.register("chave_pix")} /></Field>
        <div className="md:col-span-2"><Field label="Observações"><Textarea {...form.register("obs")} /></Field></div>
      </Card>
    </form>
  );
}
