import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

type Pessoa = { id: number; nome: string | null; empresa: string | null; cargo: string | null; situacao: string };

type Formulario = {
  estagiario_nome: string;
  estagiario_nascimento: string;
  estagiario_cpf: string;
  estagiario_rg: string;
  estagiario_endereco: string;
  estagiario_cep: string;
  estagiario_cidade: string;
  estagiario_estado: string;
  estagiario_curso: string;
  estagiario_periodo: string;
  estagiario_turno: string;
  estagiario_contato: string;
  tipo_estagio: "obrigatorio" | "nao_obrigatorio";
  responsavel_nome: string;
  responsavel_nascimento: string;
  responsavel_cpf: string;
  responsavel_rg: string;
  responsavel_endereco: string;
  responsavel_cep: string;
  responsavel_cidade: string;
  responsavel_estado: string;
  responsavel_contato: string;
  concedente_razao: string;
  concedente_endereco: string;
  concedente_cnpj: string;
  concedente_email: string;
  concedente_representante: string;
  escola_nome: string;
  escola_endereco: string;
  escola_cidade: string;
  escola_estado: string;
  escola_cep: string;
  escola_cnpj: string;
  escola_email: string;
  escola_representante: string;
  data_tce: string;
  data_rescisao: string;
  atividades: string;
  motivo: string;
  avaliacao: string;
};

function vazio(): Formulario {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return {
    estagiario_nome: "", estagiario_nascimento: "", estagiario_cpf: "", estagiario_rg: "", estagiario_endereco: "",
    estagiario_cep: "", estagiario_cidade: "", estagiario_estado: "", estagiario_curso: "", estagiario_periodo: "",
    estagiario_turno: "", estagiario_contato: "", tipo_estagio: "nao_obrigatorio",
    responsavel_nome: "", responsavel_nascimento: "", responsavel_cpf: "", responsavel_rg: "", responsavel_endereco: "",
    responsavel_cep: "", responsavel_cidade: "", responsavel_estado: "", responsavel_contato: "",
    concedente_razao: "", concedente_endereco: "", concedente_cnpj: "", concedente_email: "", concedente_representante: "",
    escola_nome: "", escola_endereco: "", escola_cidade: "", escola_estado: "", escola_cep: "", escola_cnpj: "",
    escola_email: "", escola_representante: "", data_tce: hoje, data_rescisao: hoje, atividades: "", motivo: "", avaliacao: "",
  };
}

const campos: Array<{ key: keyof Formulario; label: string; date?: boolean }> = [
  { key: "estagiario_nome", label: "Nome" },
  { key: "estagiario_nascimento", label: "Nascimento", date: true },
  { key: "estagiario_cpf", label: "CPF" },
  { key: "estagiario_rg", label: "RG" },
  { key: "estagiario_endereco", label: "Endereço" },
  { key: "estagiario_cep", label: "CEP" },
  { key: "estagiario_cidade", label: "Cidade" },
  { key: "estagiario_estado", label: "Estado" },
  { key: "estagiario_curso", label: "Curso" },
  { key: "estagiario_periodo", label: "Período/Ano" },
  { key: "estagiario_turno", label: "Turno" },
  { key: "estagiario_contato", label: "Contato" },
];

const responsavel: Array<{ key: keyof Formulario; label: string; date?: boolean }> = [
  { key: "responsavel_nome", label: "Nome" },
  { key: "responsavel_nascimento", label: "Nascimento", date: true },
  { key: "responsavel_cpf", label: "CPF" },
  { key: "responsavel_rg", label: "RG" },
  { key: "responsavel_endereco", label: "Endereço" },
  { key: "responsavel_cep", label: "CEP" },
  { key: "responsavel_cidade", label: "Cidade" },
  { key: "responsavel_estado", label: "Estado" },
  { key: "responsavel_contato", label: "Contato" },
];

export function GerarRescisaoMedio() {
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [form, setForm] = useState<Formulario>(vazio);
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);
  const pessoas = useQuery({
    queryKey: ["rescisao-medio", busca],
    enabled: busca.trim().length >= 2,
    queryFn: () => api<Pessoa[]>(`/api/v1/termos/rescisao-medio?q=${encodeURIComponent(busca.trim())}`),
  });

  function set<K extends keyof Formulario>(chave: K, valor: Formulario[K]) {
    setForm((atual) => ({ ...atual, [chave]: valor }));
  }

  async function escolher(pessoa: Pessoa) {
    setAberta(false);
    setBusca([pessoa.nome, pessoa.empresa].filter(Boolean).join(" · "));
    setErro("");
    try {
      const result = await api<Formulario>(`/api/v1/termos/rescisao-medio/${pessoa.id}`);
      setForm({ ...vazio(), ...result.data, tipo_estagio: result.data.tipo_estagio === "obrigatorio" ? "obrigatorio" : "nao_obrigatorio" });
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o estagiário.");
    }
  }

  function validar() {
    if (form.estagiario_nome.trim().length < 3) return "Informe o nome do estagiário.";
    if (form.concedente_razao.trim().length < 3) return "Informe a razão social da concedente.";
    if (!form.data_tce || !form.data_rescisao) return "Informe as datas do estágio e da rescisão.";
    if (form.atividades.trim().length < 3) return "Informe o resumo das atividades.";
    if (form.motivo.trim().length < 3) return "Informe o motivo da rescisão.";
    if (form.avaliacao.trim().length < 2) return "Informe a avaliação de desempenho.";
    return "";
  }

  async function gerar(event: FormEvent) {
    event.preventDefault();
    const mensagem = validar();
    if (mensagem) {
      setErro(mensagem);
      return;
    }
    setErro("");
    setGerando(true);
    try {
      const response = await fetch("/api/v1/termos/documentos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelo: "rescisao_medio", ...form }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "Não foi possível gerar a rescisão.");
      }
      const blob = await response.blob();
      const dispo = response.headers.get("Content-Disposition") ?? "";
      const codificado = /filename\*=UTF-8''([^;]+)/.exec(dispo)?.[1];
      const arquivo = codificado ? decodeURIComponent(codificado) : "rescisao-estagio-ensino-medio.pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = arquivo;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível gerar a rescisão.");
    } finally {
      setGerando(false);
    }
  }

  const lista = pessoas.data?.data ?? [];

  return (
    <form className="grid gap-4" onSubmit={gerar}>
      {erro ? <p className="text-sm text-rose-600" role="alert">{erro}</p> : null}
      <Card className="grid gap-3">
        <h2 className="font-bold">Estagiário efetivado</h2>
        <p className="text-sm text-slate-500">Somente estágio do ensino médio. A busca traz quem já foi efetivado e preenche o termo.</p>
        <Field label="Buscar pessoa">
          <Input aria-label="Buscar estagiário" placeholder="Nome, empresa ou cargo" value={busca} onChange={(event) => { setBusca(event.target.value); setAberta(true); }} />
        </Field>
        {aberta && busca.trim().length >= 2 && lista.length ? (
          <div className="max-h-40 overflow-auto rounded-lg border border-slate-200">
            {lista.map((pessoa) => (
              <button key={pessoa.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => void escolher(pessoa)}>
                <span className="font-semibold">{pessoa.nome}</span>
                <span className="ml-2 text-slate-500">{pessoa.empresa} · {pessoa.cargo} · {pessoa.situacao}</span>
              </button>
            ))}
          </div>
        ) : null}
        {busca.trim().length >= 2 && pessoas.isSuccess && lista.length === 0 ? <p className="text-sm text-slate-500">Nenhum estagiário do ensino médio encontrado.</p> : null}
      </Card>

      <Card className="grid gap-3 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Estagiário</h2>
        {campos.map((campo) => (
          <Field key={campo.key} label={campo.label}>
            <Input aria-label={campo.label} type={campo.date ? "date" : "text"} value={String(form[campo.key] ?? "")} onChange={(event) => set(campo.key, event.target.value)} />
          </Field>
        ))}
        <Field label="Tipo de estágio">
          <select aria-label="Tipo de estágio" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={form.tipo_estagio} onChange={(event) => set("tipo_estagio", event.target.value === "obrigatorio" ? "obrigatorio" : "nao_obrigatorio")}>
            <option value="nao_obrigatorio">Não obrigatório</option>
            <option value="obrigatorio">Obrigatório</option>
          </select>
        </Field>
      </Card>

      <Card className="grid gap-3 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Responsável legal</h2>
        {responsavel.map((campo) => (
          <Field key={campo.key} label={campo.label}>
            <Input aria-label={`Responsável ${campo.label}`} type={campo.date ? "date" : "text"} value={String(form[campo.key] ?? "")} onChange={(event) => set(campo.key, event.target.value)} />
          </Field>
        ))}
      </Card>

      <Card className="grid gap-3 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Concedente</h2>
        <Field label="Razão social"><Input aria-label="Razão social da concedente" value={form.concedente_razao} onChange={(event) => set("concedente_razao", event.target.value)} /></Field>
        <Field label="CNPJ"><Input aria-label="CNPJ da concedente" value={form.concedente_cnpj} onChange={(event) => set("concedente_cnpj", event.target.value)} /></Field>
        <Field label="Endereço"><Input aria-label="Endereço da concedente" value={form.concedente_endereco} onChange={(event) => set("concedente_endereco", event.target.value)} /></Field>
        <Field label="E-mail"><Input aria-label="E-mail da concedente" value={form.concedente_email} onChange={(event) => set("concedente_email", event.target.value)} /></Field>
        <Field label="Representante"><Input aria-label="Representante da concedente" value={form.concedente_representante} onChange={(event) => set("concedente_representante", event.target.value)} /></Field>
      </Card>

      <Card className="grid gap-3 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Instituição de ensino</h2>
        <Field label="Nome"><Input aria-label="Nome da instituição" value={form.escola_nome} onChange={(event) => set("escola_nome", event.target.value)} /></Field>
        <Field label="CNPJ / INEP"><Input aria-label="CNPJ da instituição" value={form.escola_cnpj} onChange={(event) => set("escola_cnpj", event.target.value)} /></Field>
        <Field label="Endereço"><Input aria-label="Endereço da instituição" value={form.escola_endereco} onChange={(event) => set("escola_endereco", event.target.value)} /></Field>
        <Field label="Cidade"><Input aria-label="Cidade da instituição" value={form.escola_cidade} onChange={(event) => set("escola_cidade", event.target.value)} /></Field>
        <Field label="Estado"><Input aria-label="Estado da instituição" value={form.escola_estado} onChange={(event) => set("escola_estado", event.target.value)} /></Field>
        <Field label="CEP"><Input aria-label="CEP da instituição" value={form.escola_cep} onChange={(event) => set("escola_cep", event.target.value)} /></Field>
        <Field label="E-mail"><Input aria-label="E-mail da instituição" value={form.escola_email} onChange={(event) => set("escola_email", event.target.value)} /></Field>
        <Field label="Representante"><Input aria-label="Representante da instituição" value={form.escola_representante} onChange={(event) => set("escola_representante", event.target.value)} /></Field>
      </Card>

      <Card className="grid gap-3">
        <h2 className="font-bold">Rescisão</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Data do TCE"><Input aria-label="Data do TCE" type="date" value={form.data_tce} onChange={(event) => set("data_tce", event.target.value)} /></Field>
          <Field label="Data da rescisão"><Input aria-label="Data da rescisão" type="date" value={form.data_rescisao} onChange={(event) => set("data_rescisao", event.target.value)} /></Field>
          <Field label="Motivo"><Input aria-label="Motivo da rescisão" value={form.motivo} onChange={(event) => set("motivo", event.target.value)} /></Field>
          <Field label="Avaliação de desempenho"><Input aria-label="Avaliação de desempenho" value={form.avaliacao} onChange={(event) => set("avaliacao", event.target.value)} /></Field>
        </div>
        <Field label="Resumo das atividades">
          <Textarea aria-label="Resumo das atividades" value={form.atividades} onChange={(event) => set("atividades", event.target.value)} />
        </Field>
        <div>
          <Button type="submit" disabled={gerando}>{gerando ? "Gerando…" : "Gerar rescisão"}</Button>
        </div>
      </Card>
    </form>
  );
}
