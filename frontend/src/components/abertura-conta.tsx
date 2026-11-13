import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

type Sugestao = {
  nome: string;
  cpf: string;
  endereco: string;
  telefone: string;
  bolsa: number | null;
  cnpj: string;
  empresa: string;
  contratacao: "ativa" | "recente" | "nenhuma";
};

type Formulario = { data: string; nome: string; cpf: string; endereco: string; telefone: string; bolsa: string; cnpj: string; empresa: string };

function hojeIso() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** "1.234,56", "850" ou "850.5" → número; vazio ou inválido → null. */
export function lerValor(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null;
}

const AVISO_CONTRATACAO: Record<Sugestao["contratacao"], string> = {
  ativa: "Bolsa e empresa vieram da contratação ativa. Confira antes de gerar.",
  recente: "Sem contratação ativa: bolsa e empresa vieram da contratação mais recente. Confira antes de gerar.",
  nenhuma: "O candidato não tem contratação: preencha a bolsa e a empresa.",
};

/** Botão da ficha do candidato que gera a carta "Abertura de conta" (crédito da bolsa auxílio) em PDF. */
export function AberturaConta({ idCandidato }: { idCandidato: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setAberto(true)}><FileText size={16} /> Abertura de conta</Button>
      {aberto ? <JanelaAberturaConta idCandidato={idCandidato} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function JanelaAberturaConta({ idCandidato, onFechar }: { idCandidato: string; onFechar: () => void }) {
  const sugestao = useQuery({
    queryKey: ["abertura-conta", idCandidato],
    queryFn: () => api<Sugestao>(`/api/v1/candidatos/${idCandidato}/abertura-conta`),
    staleTime: 0,
  });
  const [form, setForm] = useState<Formulario | null>(null);
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    if (form) return;
    if (sugestao.isError) {
      setForm({ data: hojeIso(), nome: "", cpf: "", endereco: "", telefone: "", bolsa: "", cnpj: "", empresa: "" });
      return;
    }
    const dados = sugestao.data?.data;
    if (!dados) return;
    setForm({
      data: hojeIso(),
      nome: dados.nome,
      cpf: dados.cpf,
      endereco: dados.endereco,
      telefone: dados.telefone,
      bolsa: dados.bolsa == null ? "" : dados.bolsa.toFixed(2).replace(".", ","),
      cnpj: dados.cnpj,
      empresa: dados.empresa,
    });
  }, [sugestao.data, sugestao.isError, form]);

  useEffect(() => {
    function tecla(event: KeyboardEvent) {
      if (event.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onFechar]);

  function mudar(campo: keyof Formulario, valor: string) {
    setForm((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  async function gerar(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const bolsa = lerValor(form.bolsa);
    if (form.nome.trim().length < 3) return setErro("Informe o nome.");
    if (bolsa == null) return setErro("Informe o valor da bolsa auxílio.");
    if (form.empresa.trim().length < 2) return setErro("Informe a empresa.");
    setErro("");
    setGerando(true);
    try {
      const response = await fetch(`/api/v1/candidatos/${idCandidato}/abertura-conta`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, bolsa }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "Não foi possível gerar o documento.");
      }
      const blob = await response.blob();
      const dispo = response.headers.get("Content-Disposition") ?? "";
      const codificado = /filename\*=UTF-8''([^;]+)/.exec(dispo)?.[1];
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = codificado ? decodeURIComponent(codificado) : "abertura-de-conta.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível gerar o documento.");
    } finally {
      setGerando(false);
    }
  }

  const campo = (chave: keyof Formulario, rotulo: string, extra: { type?: string; placeholder?: string; inputMode?: "decimal" } = {}) => (
    <Field label={rotulo}>
      <Input aria-label={rotulo} value={form?.[chave] ?? ""} onChange={(event) => mudar(chave, event.target.value)} {...extra} />
    </Field>
  );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="abertura-conta-titulo"
      onClick={(event) => { if (event.target === event.currentTarget) onFechar(); }}
    >
      <form onSubmit={gerar} className="grid max-h-[90vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="abertura-conta-titulo" className="text-lg font-bold text-navy-900">Abertura de conta</h2>
            <p className="text-sm text-slate-500">Carta de solicitação de abertura de conta para crédito da bolsa auxílio. Sai em PDF para a empresa carimbar e assinar.</p>
          </div>
          <Button type="button" variant="ghost" aria-label="Fechar" onClick={onFechar}><X size={18} /></Button>
        </header>
        {sugestao.isLoading ? <p className="text-sm text-slate-500">Carregando os dados do candidato…</p> : null}
        {sugestao.isError ? <p role="alert" className="text-sm text-rose-600">Não foi possível carregar os dados do candidato. Preencha os campos abaixo.</p> : null}
        {sugestao.data ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{AVISO_CONTRATACAO[sugestao.data.data.contratacao]}</p> : null}
        {form ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">{campo("nome", "Nome")}</div>
              {campo("cpf", "CPF")}
              {campo("telefone", "Telefone")}
              <div className="sm:col-span-2">{campo("endereco", "Endereço")}</div>
              {campo("bolsa", "Bolsa auxílio (R$)", { inputMode: "decimal", placeholder: "850,00" })}
              {campo("data", "Data da carta", { type: "date" })}
              {campo("cnpj", "CNPJ da empresa")}
              {campo("empresa", "Empresa")}
            </div>
            {erro ? <p role="alert" className="text-sm text-rose-600">{erro}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
              <Button type="submit" disabled={gerando}>{gerando ? "Gerando…" : "Gerar PDF"}</Button>
            </div>
          </>
        ) : null}
      </form>
    </div>
  );
}
