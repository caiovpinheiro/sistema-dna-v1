import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  nome: z.string().min(3, "Informe o nome."),
  cpf: z.string().min(11, "Informe o CPF."),
  email: z.string().trim().refine((value) => !value || z.string().email().safeParse(value).success, "E-mail inválido."),
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
  vinculo: z.enum(["dna", "empresa"]),
  id_empresa: z.string().optional(),
}).superRefine((values, ctx) => {
  if (values.vinculo === "empresa" && !values.id_empresa) {
    ctx.addIssue({ code: "custom", path: ["id_empresa"], message: "Selecione a empresa." });
  }
});
type Form = z.infer<typeof schema>;
type EmpresaOpcao = { id_empresa: string; razao_social: string; nome_fantasia: string | null };

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

export function CandidatoFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const current = useQuery({
    queryKey: ["candidato", id],
    enabled: Boolean(id),
    queryFn: () => api<Form & { id_candidato: string }>(`/api/v1/candidatos/${id}`),
  });
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { vinculo: "dna", id_empresa: "" } });
  const vinculo = form.watch("vinculo");
  const [buscaEmpresa, setBuscaEmpresa] = useState("");
  const empresas = useQuery({
    queryKey: ["empresas-candidato", buscaEmpresa],
    enabled: vinculo === "empresa" && buscaEmpresa.trim().length >= 2,
    queryFn: () => api<EmpresaOpcao[]>(`/api/v1/empresas?pageSize=20&q=${encodeURIComponent(buscaEmpresa.trim())}`),
  });
  const base = useRef<Form | null>(null);
  useEffect(() => {
    if (!current.data || base.current) return;
    const bruto = current.data.data as Form & { id_empresa?: string | null; empresa_nome?: string | null };
    const data = {
      ...(Object.fromEntries(Object.entries(bruto).map(([key, value]) => [key, value ?? ""])) as Form),
      vinculo: bruto.id_empresa ? "empresa" as const : "dna" as const,
      id_empresa: bruto.id_empresa ?? "",
    };
    base.current = data;
    form.reset(data);
    if (bruto.empresa_nome) setBuscaEmpresa(String(bruto.empresa_nome));
  }, [current.data, form]);
  const save = useMutation({
    mutationFn: (values: Form) => {
      const { vinculo: origem, id_empresa: empresa, ...resto } = values;
      const payload = id ? diferencas(resto, base.current) : compact(resto);
      payload.id_empresa = origem === "empresa" ? empresa : null;
      if (id && Object.keys(payload).length === 0) throw new ApiError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo foi alterado.");
      return id
        ? api(`/api/v1/candidatos/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : api<{ id_candidato: string }>("/api/v1/candidatos", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: (result) => navigate(`/candidatos/${id ?? (result.data as { id_candidato: string }).id_candidato}`),
  });
  const error = mensagemErro(save.error) || (form.formState.submitCount > 0 && !form.formState.isValid ? "Revise os campos marcados antes de salvar." : "");
  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <div className="flex items-center justify-between"><h1 className="text-2xl font-extrabold">{id ? "Editar candidato" : "Novo candidato"}</h1><Button type="submit" disabled={save.isPending}>Salvar</Button></div>
      {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
      <Card className="grid gap-4 md:grid-cols-2">
        <h2 className="md:col-span-2 font-bold">Identificação</h2>
        <Field label="Cadastro" error={form.formState.errors.id_empresa?.message}>
          <Select aria-label="Candidato DNA ou de outra empresa" value={vinculo} onChange={(event) => {
            const proximo = event.target.value === "empresa" ? "empresa" : "dna";
            form.setValue("vinculo", proximo);
            if (proximo === "dna") form.setValue("id_empresa", "");
          }}>
            <option value="dna">Candidato DNA</option>
            <option value="empresa">Outra empresa</option>
          </Select>
        </Field>
        {vinculo === "empresa" ? (
          <Field label="Empresa">
            <Input
              aria-label="Pesquisar empresa"
              placeholder="Pesquisar empresa"
              value={buscaEmpresa}
              onChange={(event) => {
                setBuscaEmpresa(event.target.value);
                form.setValue("id_empresa", "");
              }}
            />
            {empresas.data?.data.length ? (
              <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200">
                {empresas.data.data.map((item) => (
                  <button
                    key={item.id_empresa}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      form.setValue("id_empresa", item.id_empresa, { shouldValidate: true });
                      setBuscaEmpresa(item.nome_fantasia || item.razao_social);
                    }}
                  >
                    {item.nome_fantasia || item.razao_social}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
        ) : <div />}
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
      <div className="flex justify-end"><Button type="submit" disabled={save.isPending}>Salvar</Button></div>
    </form>
  );
}
