import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Modelo = { id: number; descricao: string; assunto: string | null; texto: string | null; remetente: string | null };

const EXEMPLOS: Record<string, string> = {
  "@Nome-Assinatura-Digital": "Maria Souza",
  "@Documento-Nome": "TCE - Maria Souza",
  "@Link-Assinatura-Digital": "https://app.zapsign.com.br/verificar/exemplo",
  "@Nome-Candidato": "Maria Souza",
  "@Semestre-Candidato": "3º",
  "@Ano-Escolar": "2026",
  "@Turno-Candidato": "Manhã",
  "@Nome-Fantasia-Empresa": "Empresa Exemplo",
  "@Razao-Social-Empresa": "Empresa Exemplo Ltda",
  "@CNPJ-Empresa": "00.000.000/0001-00",
  "@Cargo-Vaga": "Estágio",
  "@Valor": "1.250,00",
  "@Vencimento": "10/11/2026",
  "@Data": "24/10/2026",
  "@link-pg": "https://www.asaas.com/i/exemplo",
  "@Variaveis-Candidato": "<br>Nome do candidato: Maria Souza.",
  "@Variaveis-vaga": "<br>Vaga: Estágio",
  "@Variaveis-Empresa": "<br><br>Razão Social: Empresa Exemplo Ltda.<br>Nome Fantasia: Empresa Exemplo.<br>CNPJ: 00.000.000/0001-00",
  "@tabela-cobranca": `<table style="width:100%;border-collapse:collapse"><tr><td>Cobrança</td><td>Candidato</td><td>Cargo</td><td>Modalidade</td><td>Situação</td></tr><tr><td>Mensalidade</td><td>Maria Souza</td><td>Estágio</td><td>Estágio</td><td>ativo</td></tr><tr><td></td><td></td><td></td><td>Total</td><td>R$ 1.250,00</td></tr></table>`,
};

function aplicar(texto: string) {
  return Object.keys(EXEMPLOS).sort((a, b) => b.length - a.length).reduce((saida, chave) => saida.split(chave).join(EXEMPLOS[chave]), texto);
}

function variaveisDe(texto: string) {
  return [...new Set(texto.match(/(?<![A-Za-z0-9._%+-])@[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9-]*/g) ?? [])];
}

export function EmailsPage() {
  const client = useQueryClient();
  const lista = useQuery({ queryKey: ["emails-modelo"], queryFn: () => api<Modelo[]>("/api/v1/emails") });
  const modelos = lista.data?.data ?? [];
  const [id, setId] = useState<number | null>(null);
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const atual = modelos.find((item) => item.id === id) ?? modelos[0];

  useEffect(() => {
    if (!atual) return;
    setId(atual.id);
    setAssunto(atual.assunto ?? "");
    setTexto(atual.texto ?? "");
    setAviso("");
    setErro("");
  }, [atual?.id]);

  const salvar = useMutation({
    mutationFn: () => api(`/api/v1/emails/${atual?.id}`, { method: "PATCH", body: JSON.stringify({ assunto, texto }) }),
    onSuccess: async () => {
      setErro("");
      setAviso("Modelo salvo. Os próximos envios usam este texto.");
      await client.invalidateQueries({ queryKey: ["emails-modelo"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível salvar o modelo."),
  });

  const previewAssunto = useMemo(() => aplicar(assunto), [assunto]);
  const previewHtml = useMemo(() => aplicar(texto), [texto]);
  const variaveis = useMemo(() => variaveisDe(`${assunto}\n${texto}`), [assunto, texto]);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">E-mails</h1>
        <p className="text-sm text-slate-500">Os textos prontos do banco. Salvar vale para o próximo envio. A prévia troca as variáveis por um exemplo.</p>
      </div>
      {lista.isLoading ? <p className="text-sm text-slate-500">Carregando modelos…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os modelos.</p> : null}
      <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
        <Card className="grid max-h-[70vh] content-start gap-1 overflow-auto p-2">
          {modelos.map((item) => (
            <button key={`${item.descricao}-${item.id}`} type="button" onClick={() => setId(item.id)} className={`rounded-xl px-3 py-2 text-left text-sm font-semibold ${item.id === atual?.id ? "bg-navy-900 text-white" : "hover:bg-slate-50"}`}>
              {item.descricao}
            </button>
          ))}
        </Card>
        {atual ? (
          <div className="grid gap-5">
            <Card className="grid gap-4">
              <p className="text-sm text-slate-500">Remetente <strong className="text-slate-800">{atual.remetente || "documentos@dnawork.ai"}</strong></p>
              <Field label="Assunto"><Input value={assunto} onChange={(event) => setAssunto(event.target.value)} /></Field>
              <Field label="Mensagem">
                <Textarea className="min-h-64 font-mono text-xs" value={texto} onChange={(event) => setTexto(event.target.value)} />
              </Field>
              {variaveis.length ? <p className="text-xs text-slate-500">Variáveis: {variaveis.join(", ")}</p> : null}
              {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
              {aviso ? <p className="text-sm text-emerald-700">{aviso}</p> : null}
              <Button type="button" disabled={salvar.isPending || !assunto.trim() || !texto.trim()} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar modelo"}</Button>
            </Card>
            <Card className="grid gap-3">
              <h2 className="font-extrabold">Prévia do envio</h2>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p><span className="text-slate-400">De</span> {atual.remetente || "documentos@dnawork.ai"}</p>
                <p><span className="text-slate-400">Para</span> maria.souza@exemplo.com</p>
                <p><span className="text-slate-400">Assunto</span> {previewAssunto}</p>
              </div>
              <iframe title="Prévia do e-mail" sandbox="" srcDoc={previewHtml} className="h-[480px] w-full rounded-2xl border border-slate-200 bg-white" />
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
