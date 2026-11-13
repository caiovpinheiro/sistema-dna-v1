import { useQuery } from "@tanstack/react-query";
import { FileDown, Search } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { textoPlano } from "@/lib/format";

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

type Span = 1 | 2 | 3 | 4 | 6;
type Campo = { key: keyof Formulario; label: string; date?: boolean; span: Span };

/** Larguras na grade de 6 colunas: UF e datas curtas, nome e endereço largos. */
const LARGURA: Record<Span, string> = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" };

const campos: Campo[] = [
  { key: "estagiario_nome", label: "Nome", span: 4 },
  { key: "estagiario_nascimento", label: "Nascimento", date: true, span: 2 },
  { key: "estagiario_cpf", label: "CPF", span: 3 },
  { key: "estagiario_rg", label: "RG", span: 3 },
  { key: "estagiario_endereco", label: "Endereço", span: 4 },
  { key: "estagiario_cep", label: "CEP", span: 2 },
  { key: "estagiario_cidade", label: "Cidade", span: 2 },
  { key: "estagiario_estado", label: "Estado", span: 1 },
  { key: "estagiario_contato", label: "Contato", span: 3 },
  { key: "estagiario_curso", label: "Curso", span: 2 },
  { key: "estagiario_periodo", label: "Período/Ano", span: 2 },
  { key: "estagiario_turno", label: "Turno", span: 2 },
];

const responsavel: Campo[] = [
  { key: "responsavel_nome", label: "Nome", span: 4 },
  { key: "responsavel_nascimento", label: "Nascimento", date: true, span: 2 },
  { key: "responsavel_cpf", label: "CPF", span: 3 },
  { key: "responsavel_rg", label: "RG", span: 3 },
  { key: "responsavel_endereco", label: "Endereço", span: 4 },
  { key: "responsavel_cep", label: "CEP", span: 2 },
  { key: "responsavel_cidade", label: "Cidade", span: 2 },
  { key: "responsavel_estado", label: "Estado", span: 1 },
  { key: "responsavel_contato", label: "Contato", span: 3 },
];

/** Bloco do formulário: título, uma frase do que preencher e a grade de 6 colunas. */
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

function Col({ span, children }: { span: Span; children: ReactNode }) {
  return <div className={LARGURA[span]}>{children}</div>;
}

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

  const texto = (chave: keyof Formulario, rotulo: string, span: Span, ariaLabel = rotulo) => (
    <Col span={span}>
      <Field label={rotulo}><Input aria-label={ariaLabel} value={String(form[chave] ?? "")} onChange={(event) => set(chave, event.target.value)} /></Field>
    </Col>
  );

  return (
    <form className="grid gap-5" onSubmit={gerar}>
      <Card className="grid gap-3 md:p-5">
        <header>
          <h2 className="text-[15px] font-bold text-navy-900">Estagiário efetivado</h2>
          <p className="text-sm text-slate-500">Somente estágio do ensino médio. Escolha a pessoa e o termo sai preenchido com os dados do banco; confira e complete abaixo.</p>
        </header>
        <div className="relative grid gap-1.5 rounded-lg bg-slate-50 p-3">
          <span className="text-sm font-semibold text-slate-700">Buscar pessoa</span>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input aria-label="Buscar estagiário" placeholder="Nome, empresa ou cargo" value={busca} onChange={(event) => { setBusca(event.target.value); setAberta(true); }} className="pl-9" />
          </div>
          {aberta && busca.trim().length >= 2 && lista.length ? (
            <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white">
              {lista.map((pessoa) => (
                <button key={pessoa.id} type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => void escolher(pessoa)}>
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-700">{pessoa.nome}</span>
                    <span className="block text-xs text-slate-500">{[pessoa.empresa ? textoPlano(pessoa.empresa) : null, pessoa.cargo].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Badge value={pessoa.situacao === "Ativo" ? "ativa" : "encerrada"}>{pessoa.situacao}</Badge>
                </button>
              ))}
            </div>
          ) : null}
          {busca.trim().length >= 2 && pessoas.isSuccess && lista.length === 0 ? <p className="text-sm text-slate-500">Nenhum estagiário do ensino médio encontrado com esse nome.</p> : null}
        </div>
      </Card>

      <Secao titulo="Estagiário" texto="Dados pessoais e escolares que aparecem no termo.">
        {campos.map((campo) => (
          <Col key={campo.key} span={campo.span}>
            <Field label={campo.label}>
              <Input aria-label={campo.label} type={campo.date ? "date" : "text"} value={String(form[campo.key] ?? "")} onChange={(event) => set(campo.key, event.target.value)} />
            </Field>
          </Col>
        ))}
        <Col span={3}>
          <Field label="Tipo de estágio">
            <Select aria-label="Tipo de estágio" value={form.tipo_estagio} onChange={(event) => set("tipo_estagio", event.target.value === "obrigatorio" ? "obrigatorio" : "nao_obrigatorio")}>
              <option value="nao_obrigatorio">Não obrigatório</option>
              <option value="obrigatorio">Obrigatório</option>
            </Select>
          </Field>
        </Col>
      </Secao>

      <Secao titulo="Responsável legal" texto="Quem assina pelo estagiário menor de idade. Deixe em branco se não houver.">
        {responsavel.map((campo) => (
          <Col key={campo.key} span={campo.span}>
            <Field label={campo.label}>
              <Input aria-label={`Responsável ${campo.label}`} type={campo.date ? "date" : "text"} value={String(form[campo.key] ?? "")} onChange={(event) => set(campo.key, event.target.value)} />
            </Field>
          </Col>
        ))}
      </Secao>

      <Secao titulo="Concedente" texto="A empresa onde o estágio aconteceu.">
        {texto("concedente_razao", "Razão social", 4, "Razão social da concedente")}
        {texto("concedente_cnpj", "CNPJ", 2, "CNPJ da concedente")}
        {texto("concedente_endereco", "Endereço", 6, "Endereço da concedente")}
        {texto("concedente_email", "E-mail", 3, "E-mail da concedente")}
        {texto("concedente_representante", "Representante", 3, "Representante da concedente")}
      </Secao>

      <Secao titulo="Instituição de ensino" texto="A escola do estagiário.">
        {texto("escola_nome", "Nome", 4, "Nome da instituição")}
        {texto("escola_cnpj", "CNPJ / INEP", 2, "CNPJ da instituição")}
        {texto("escola_endereco", "Endereço", 6, "Endereço da instituição")}
        {texto("escola_cidade", "Cidade", 3, "Cidade da instituição")}
        {texto("escola_estado", "Estado", 1, "Estado da instituição")}
        {texto("escola_cep", "CEP", 2, "CEP da instituição")}
        {texto("escola_email", "E-mail", 3, "E-mail da instituição")}
        {texto("escola_representante", "Representante", 3, "Representante da instituição")}
      </Secao>

      <Secao titulo="Rescisão" texto="Datas, motivo, avaliação e o resumo do que o estagiário fez.">
        <Col span={2}><Field label="Data do TCE"><Input aria-label="Data do TCE" type="date" value={form.data_tce} onChange={(event) => set("data_tce", event.target.value)} /></Field></Col>
        <Col span={2}><Field label="Data da rescisão"><Input aria-label="Data da rescisão" type="date" value={form.data_rescisao} onChange={(event) => set("data_rescisao", event.target.value)} /></Field></Col>
        <div className="hidden sm:col-span-2 sm:block" />
        {texto("motivo", "Motivo", 3, "Motivo da rescisão")}
        {texto("avaliacao", "Avaliação de desempenho", 3)}
        <Col span={6}>
          <Field label="Resumo das atividades">
            <Textarea aria-label="Resumo das atividades" value={form.atividades} onChange={(event) => set("atividades", event.target.value)} />
          </Field>
        </Col>
      </Secao>

      {/* Rodapé fixo: o botão e o erro de validação ficam sempre à vista enquanto o formulário rola. */}
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        {erro ? <Alerta>{erro}</Alerta> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-slate-500">O PDF é baixado no seu computador; nada é gravado.</p>
          <Button type="submit" disabled={gerando}><FileDown size={16} /> {gerando ? "Gerando…" : "Gerar rescisão"}</Button>
        </div>
      </div>
    </form>
  );
}
