import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Save, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Card, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatCnpj, textoPlano } from "@/lib/format";

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
type EmpresaOpcao = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null; cidade: string | null; uf: string | null };

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
  // Empresa escolhida na lista: mostrada com o CNPJ, para não confundir unidades com o mesmo nome (ex.: Lumi).
  const [empresaEscolhida, setEmpresaEscolhida] = useState<EmpresaOpcao | null>(null);
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
  const erros = form.formState.errors;
  const botaoSalvar = <Button type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? "Salvando…" : id ? "Salvar alterações" : "Cadastrar candidato"}</Button>;
  return (
    <form className="mx-auto grid w-full max-w-5xl gap-5" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <CabecalhoPagina
        titulo={id ? "Editar candidato" : "Novo candidato"}
        descricao={id ? "Altere o que precisar; só os campos mudados são gravados." : "Nome e CPF são obrigatórios; o resto pode ser completado depois."}
      />
      {id && current.isLoading ? <Skeleton className="h-64" /> : null}
      <Secao titulo="Identificação" texto="Quem é a pessoa e quem cadastrou: a DNA Work ou uma empresa cliente.">
        <Col span={2}>
          <Field label="Cadastrado por" error={erros.id_empresa?.message}>
            <Select aria-label="Candidato DNA ou de outra empresa" value={vinculo} onChange={(event) => {
              const proximo = event.target.value === "empresa" ? "empresa" : "dna";
              form.setValue("vinculo", proximo);
              if (proximo === "dna") form.setValue("id_empresa", "");
            }}>
              <option value="dna">Candidato DNA</option>
              <option value="empresa">Outra empresa</option>
            </Select>
          </Field>
        </Col>
        {vinculo === "empresa" ? (
          <Col span={4}>
            <Field label="Empresa">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  aria-label="Pesquisar empresa"
                  placeholder="Pesquisar pelo nome da empresa"
                  value={buscaEmpresa}
                  className="pl-9"
                  onChange={(event) => {
                    setBuscaEmpresa(event.target.value);
                    setEmpresaEscolhida(null);
                    form.setValue("id_empresa", "");
                  }}
                />
              </div>
              {form.watch("id_empresa") ? (
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <Check size={15} className="shrink-0" />
                  <span className="font-semibold">{textoPlano(empresaEscolhida?.nome_fantasia || empresaEscolhida?.razao_social || buscaEmpresa)}</span>
                  {empresaEscolhida?.cnpj ? <span className="tabular-nums">CNPJ {formatCnpj(empresaEscolhida.cnpj)}</span> : null}
                  <button type="button" className="ml-auto text-xs font-semibold underline" onClick={() => { form.setValue("id_empresa", ""); setEmpresaEscolhida(null); setBuscaEmpresa(""); }}>Trocar</button>
                </span>
              ) : empresas.data?.data.length ? (
                <div className="mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {empresas.data.data.map((item) => {
                    const nome = textoPlano(item.nome_fantasia || item.razao_social);
                    const cnpj = item.cnpj ? formatCnpj(item.cnpj) : "sem CNPJ";
                    const local = [item.cidade, item.uf].filter(Boolean).join(" / ");
                    return (
                      <button
                        key={item.id_empresa}
                        type="button"
                        title={`${nome}\nCNPJ ${cnpj}${item.razao_social ? `\n${textoPlano(item.razao_social)}` : ""}${local ? `\n${local}` : ""}`}
                        className="grid w-full gap-0.5 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50"
                        onClick={() => {
                          form.setValue("id_empresa", item.id_empresa, { shouldValidate: true });
                          setEmpresaEscolhida(item);
                          setBuscaEmpresa(nome);
                        }}
                      >
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-sm font-semibold text-navy-900">{nome}</span>
                          <span className="text-xs font-semibold tabular-nums text-slate-600">CNPJ {cnpj}</span>
                        </span>
                        <span className="text-xs text-slate-500">{[item.razao_social && textoPlano(item.razao_social) !== nome ? textoPlano(item.razao_social) : null, local || null].filter(Boolean).join(", ") || "\u00a0"}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </Field>
          </Col>
        ) : <div className="hidden sm:col-span-4 sm:block" />}
        <Col span={4}><Field label="Nome completo" error={erros.nome?.message}><Input {...form.register("nome")} /></Field></Col>
        <Col span={2}><Field label="CPF" error={erros.cpf?.message}><Input placeholder="000.000.000-00" {...form.register("cpf")} /></Field></Col>
        <Col span={4}><Field label="E-mail" error={erros.email?.message}><Input type="email" {...form.register("email")} /></Field></Col>
        <Col span={2}><Field label="Nascimento"><Input type="date" {...form.register("datanascimento")} /></Field></Col>
        <Col span={3}><Field label="Celular"><Input placeholder="(11) 90000-0000" {...form.register("celular")} /></Field></Col>
        <Col span={3}><Field label="Telefone fixo"><Input placeholder="(11) 0000-0000" {...form.register("telefonefixo")} /></Field></Col>
      </Secao>
      <Secao titulo="Endereço" texto="Usado nas vagas sugeridas (pela cidade) e nos documentos.">
        <Col span={2}><Field label="CEP"><Input placeholder="00000-000" {...form.register("cep")} /></Field></Col>
        <Col span={3}><Field label="Logradouro"><Input {...form.register("logradouro")} /></Field></Col>
        <Col span={1}><Field label="Número"><Input {...form.register("numero")} /></Field></Col>
        <Col span={2}><Field label="Bairro"><Input {...form.register("bairro")} /></Field></Col>
        <Col span={3}><Field label="Cidade"><Input {...form.register("cidade")} /></Field></Col>
        <Col span={1}><Field label="UF"><Input maxLength={2} placeholder="SP" className="uppercase" {...form.register("estado")} /></Field></Col>
      </Secao>
      <Secao titulo="Estudos e trabalho" texto="Escola e curso para o estágio; CTPS para CLT.">
        <Col span={3}><Field label="Instituição de ensino"><Input {...form.register("nome_escola")} /></Field></Col>
        <Col span={3}><Field label="Curso"><Input {...form.register("curso")} /></Field></Col>
        <Col span={2}><Field label="Semestre"><Input {...form.register("semestre")} /></Field></Col>
        <Col span={2}><Field label="CTPS"><Input {...form.register("ctps")} /></Field></Col>
      </Secao>
      <Secao titulo="Dados bancários" texto="Para o pagamento da bolsa ou do salário.">
        <Col span={3}><Field label="Banco"><Input {...form.register("banco")} /></Field></Col>
        <Col span={1}><Field label="Agência"><Input {...form.register("agencia")} /></Field></Col>
        <Col span={2}><Field label="Conta"><Input {...form.register("numero_conta")} /></Field></Col>
        <Col span={6}><Field label="Chave Pix"><Input {...form.register("chave_pix")} /></Field></Col>
      </Secao>
      <Secao titulo="Observações" texto="Anotações internas sobre o candidato.">
        <Col span={6}><Field label="Observações"><Textarea {...form.register("obs")} /></Field></Col>
      </Secao>
      {/* Rodapé fixo: o botão e o erro ficam sempre à vista enquanto o formulário rola. */}
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        {error ? <Alerta>{error}</Alerta> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link to={id ? `/candidatos/${id}` : "/candidatos"}><Button type="button" variant="ghost">Cancelar</Button></Link>
          {botaoSalvar}
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
