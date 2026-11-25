import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { EscolherPagadora } from "@/components/escolher-pagadora";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Card, Field, Input, Skeleton, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

const schema = z.object({
  razao_social: z.string().trim().min(3, "A razão social precisa ter pelo menos 3 letras."),
  nome_fantasia: z.string().optional(),
  cnpj: z.string().trim().refine((value) => !value || value.replace(/\D/g, "").length === 14, "CNPJ deve ter 14 dígitos ou ficar em branco.").optional(),
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
  /** Id da empresa que paga por esta; vazio = a própria empresa é cobrada. */
  cobranca_por: z.string().optional(),
  obs: z.string().optional(),
}).refine((values) => Boolean((values.cnpj ?? "").replace(/\D/g, "")) || Boolean(values.cobranca_por), {
  message: "Empresa sem CNPJ precisa ser cobrada pelo CNPJ de outra empresa.",
  path: ["cobranca_por"],
});
type Form = z.infer<typeof schema>;

/** Nomes gravados pelo sistema antigo com entidades HTML ("Freire &amp; Pinho"). */
const CAMPOS_COM_ENTIDADES = ["razao_social", "nome_fantasia", "responsavel", "logradouro", "bairro", "cidade"] as const;
const ENTIDADES: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };

function semEntidades(valor: string) {
  let atual = valor;
  for (let i = 0; i < 3; i += 1) {
    const proximo = atual
      .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, nome: string) => ENTIDADES[nome.toLowerCase()])
      .replace(/&#(\d+);/g, (_, codigo: string) => String.fromCodePoint(Number(codigo)));
    if (proximo === atual) break;
    atual = proximo;
  }
  return atual;
}

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
  const current = useQuery({
    queryKey: ["empresa", id],
    enabled: Boolean(id),
    queryFn: () => api<Omit<Form, "cobranca_por"> & { cobranca_por?: { id: string } | null; matriz?: string | null }>(`/api/v1/empresas/${id}`),
  });
  const form = useForm<Form>({ resolver: zodResolver(schema) });
  const base = useRef<Form | null>(null);
  useEffect(() => {
    if (!current.data || base.current) return;
    const { cobranca_por: pagadora, matriz: _matriz, ...resto } = current.data.data;
    void _matriz;
    const data = Object.fromEntries(
      Object.entries(resto).map(([key, value]) => [key, value ?? ""]),
    ) as Form;
    // Quem paga vem como objeto; o formulário guarda só o id (vazio = a própria empresa).
    data.cobranca_por = pagadora?.id ?? "";
    // A base guarda o valor do banco; o formulário mostra o nome limpo. Assim, salvar já grava a versão sem "&amp;".
    base.current = data;
    const limpo = { ...data } as Record<string, unknown>;
    for (const campo of CAMPOS_COM_ENTIDADES) if (typeof limpo[campo] === "string") limpo[campo] = semEntidades(limpo[campo] as string);
    form.reset(limpo as Form);
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
  const erros = form.formState.errors;
  const voltar = id ? `/empresas/${id}` : "/empresas";
  return (
    <form className="mx-auto grid w-full max-w-5xl gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <CabecalhoPagina
        titulo={id ? "Editar empresa" : "Nova empresa"}
        descricao={id ? "Altere o que precisar; só os campos mudados são gravados." : "Só a razão social é obrigatória; o resto pode ser completado depois."}
      />
      {id && current.isLoading ? <Skeleton className="h-64" /> : null}
      <Secao titulo="Identificação" texto="Nome e documentos da empresa cliente.">
        <Col span={4}><Field label="Razão social" error={erros.razao_social?.message}><Input {...form.register("razao_social")} /></Field></Col>
        <Col span={2}><Field label="CNPJ (opcional)" error={erros.cnpj?.message}><Input placeholder="00.000.000/0000-00" {...form.register("cnpj")} /></Field></Col>
        <Col span={4}><Field label="Nome fantasia"><Input {...form.register("nome_fantasia")} /></Field></Col>
      </Secao>
      <Secao titulo="Cobrança" texto="Por qual CNPJ esta empresa é cobrada. Escolher outra empresa faz o boleto sair no CNPJ dela, junto com as unidades dela, e copia as condições de cobrança que faltarem. As vagas continuam com o endereço desta empresa.">
        <Col span={4}>
          <Field label="Cobrar pelo CNPJ de" error={erros.cobranca_por?.message}>
            <Controller
              control={form.control}
              name="cobranca_por"
              render={({ field }) => <EscolherPagadora value={field.value ?? ""} onChange={field.onChange} excluir={id} />}
            />
          </Field>
          <p className="mt-1 text-xs text-slate-500">Em branco, a própria empresa é cobrada (precisa ter CNPJ).</p>
        </Col>
      </Secao>
      <Secao titulo="Contato" texto="Quem fala pela empresa e como falar com ela.">
        <Col span={3}><Field label="Responsável"><Input {...form.register("responsavel")} /></Field></Col>
        <Col span={3}><Field label="E-mail" error={erros.email?.message}><Input type="email" {...form.register("email")} /></Field></Col>
        <Col span={3}><Field label="Telefone"><Input placeholder="(11) 0000-0000" {...form.register("telefone")} /></Field></Col>
        <Col span={3}><Field label="Celular"><Input placeholder="(11) 90000-0000" {...form.register("celular")} /></Field></Col>
      </Secao>
      <Secao titulo="Endereço" texto="Endereço da sede ou da unidade.">
        <Col span={2}><Field label="CEP"><Input placeholder="00000-000" {...form.register("cep")} /></Field></Col>
        <Col span={3}><Field label="Logradouro"><Input {...form.register("logradouro")} /></Field></Col>
        <Col span={1}><Field label="Número"><Input {...form.register("numero")} /></Field></Col>
        <Col span={2}><Field label="Bairro"><Input {...form.register("bairro")} /></Field></Col>
        <Col span={3}><Field label="Cidade"><Input {...form.register("cidade")} /></Field></Col>
        <Col span={1}><Field label="UF"><Input maxLength={2} placeholder="SP" className="uppercase" {...form.register("uf")} /></Field></Col>
      </Secao>
      <Secao titulo="Observações" texto="Anotações internas sobre a empresa.">
        <Col span={6}><Field label="Observações"><Textarea {...form.register("obs")} /></Field></Col>
      </Secao>
      {/* Rodapé fixo: o botão e o erro ficam sempre à vista enquanto o formulário rola. */}
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        {erro ? <Alerta>{erro}</Alerta> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={voltar}><Button type="button" variant="ghost">Cancelar</Button></Link>
          <Button type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? "Salvando…" : id ? "Salvar alterações" : "Cadastrar empresa"}</Button>
        </div>
      </div>
    </form>
  );
}

/** Bloco do formulário: título, uma frase e a grade de 6 colunas. */
function Secao({ titulo, texto, children }: { titulo: string; texto: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 md:p-5">
      <header>
        <h2 className="text-[15px] font-bold text-navy-900">{titulo}</h2>
        <p className="text-sm text-slate-500">{texto}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-6">{children}</div>
    </Card>
  );
}

const LARGURA = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" } as const;

function Col({ span, children }: { span: keyof typeof LARGURA; children: ReactNode }) {
  return <div className={LARGURA[span]}>{children}</div>;
}
