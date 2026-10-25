import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Modelo = { id: number; vinculo: number; descricao: string; assunto: string | null; texto: string | null; remetente: string | null };

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
  "@Variaveis-Candidato": "Nome do candidato: Maria Souza.",
  "@Variaveis-vaga": "Vaga: Estágio",
  "@Variaveis-Empresa": "Razão Social: Empresa Exemplo Ltda. Nome Fantasia: Empresa Exemplo. CNPJ: 00.000.000/0001-00",
  "@tabela-cobranca": "Tabela de cobrança do mês",
};

function variaveisDe(texto: string) {
  return [...new Set(texto.match(/(?<![A-Za-z0-9._%+-])@[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9-]*/g) ?? [])];
}

function tokenDe(valor: string) {
  const limpo = valor.trim().replace(/^@/, "").replace(/[^A-Za-zÀ-ÿ0-9-]/g, "");
  return limpo ? `@${limpo}` : "";
}

function aplicar(texto: string, exemplos: Record<string, string>) {
  const mapa = { ...EXEMPLOS, ...exemplos };
  return Object.keys(mapa).sort((a, b) => b.length - a.length).reduce((saida, chave) => saida.split(chave).join(mapa[chave] || chave), texto);
}

export function EmailsPage() {
  const client = useQueryClient();
  const lista = useQuery({ queryKey: ["emails-modelo"], queryFn: () => api<Modelo[]>("/api/v1/emails") });
  const modelos = lista.data?.data ?? [];
  const [id, setId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [exemplos, setExemplos] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const mensagem = useRef<HTMLTextAreaElement>(null);
  const atual = modelos.find((item) => item.vinculo === id) ?? modelos[0];

  useEffect(() => {
    if (!atual) return;
    setId(atual.vinculo);
    setNome(atual.descricao);
    setAssunto(atual.assunto ?? "");
    setTexto(atual.texto ?? "");
    setAviso("");
    setErro("");
  }, [atual?.vinculo]);

  const salvar = useMutation({
    mutationFn: () => api(`/api/v1/emails/${atual?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ assunto, texto, descricao: nome, vinculo: atual?.vinculo }),
    }),
    onSuccess: async () => {
      setErro("");
      setAviso("Modelo salvo. Os próximos envios usam este texto.");
      await client.invalidateQueries({ queryKey: ["emails-modelo"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível salvar o modelo."),
  });
  const excluir = useMutation({
    mutationFn: () => api(`/api/v1/emails/vinculos/${atual?.vinculo}`, { method: "DELETE" }),
    onSuccess: async () => {
      setId(null);
      setAviso("");
      await client.invalidateQueries({ queryKey: ["emails-modelo"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível excluir o modelo."),
  });

  const variaveis = useMemo(() => variaveisDe(`${assunto}\n${texto}`), [assunto, texto]);
  const previewAssunto = useMemo(() => aplicar(assunto, exemplos), [assunto, exemplos]);
  const previewHtml = useMemo(() => aplicar(texto, exemplos), [texto, exemplos]);

  function inserir(token: string) {
    const campo = mensagem.current;
    if (!campo) {
      setTexto((atualTexto) => `${atualTexto}${token}`);
      return;
    }
    const inicio = campo.selectionStart ?? texto.length;
    const fim = campo.selectionEnd ?? texto.length;
    const proximo = `${texto.slice(0, inicio)}${token}${texto.slice(fim)}`;
    setTexto(proximo);
    requestAnimationFrame(() => {
      campo.focus();
      campo.selectionStart = campo.selectionEnd = inicio + token.length;
    });
  }

  function renomear(antigo: string, valor: string) {
    const token = tokenDe(valor);
    if (!token || token === antigo) return;
    setAssunto((atualAssunto) => atualAssunto.split(antigo).join(token));
    setTexto((atualTexto) => atualTexto.split(antigo).join(token));
    setExemplos((atualExemplos) => {
      const copia = { ...atualExemplos, [token]: atualExemplos[antigo] ?? EXEMPLOS[token] ?? "" };
      delete copia[antigo];
      return copia;
    });
  }

  function novaVariavel() {
    let indice = variaveis.length + 1;
    let token = `@Nova-Variavel-${indice}`;
    while (variaveis.includes(token)) {
      indice += 1;
      token = `@Nova-Variavel-${indice}`;
    }
    inserir(token);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">E-mails</h1>
        <p className="text-sm text-slate-500">Escolha o modelo, ajuste o nome e coloque as variáveis direto na mensagem.</p>
      </div>
      {lista.isLoading ? <p className="text-sm text-slate-500">Carregando modelos…</p> : null}
      {lista.isError ? <p className="text-sm text-rose-600">Não foi possível carregar os modelos.</p> : null}
      <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="grid max-h-[78vh] content-start gap-1 overflow-auto p-2">
          {modelos.map((item) => (
            <button key={item.vinculo} type="button" onClick={() => setId(item.vinculo)} className={`rounded-xl px-3 py-2.5 text-left text-sm font-semibold leading-5 ${item.vinculo === atual?.vinculo ? "bg-navy-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}>
              {item.descricao}
            </button>
          ))}
        </Card>
        {atual ? (
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <Card className="grid gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Como o e-mail sai</p>
                <h2 className="text-lg font-extrabold">{nome || atual.descricao}</h2>
              </div>
              <div className="grid gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <p><span className="mr-2 text-slate-400">De</span>{atual.remetente || "documentos@dnawork.ai"}</p>
                <p><span className="mr-2 text-slate-400">Para</span>maria.souza@exemplo.com</p>
                <p><span className="mr-2 text-slate-400">Assunto</span>{previewAssunto}</p>
              </div>
              <iframe title="Prévia do e-mail" sandbox="" srcDoc={previewHtml} className="h-[520px] w-full rounded-2xl border border-slate-200 bg-white" />
            </Card>
            <Card className="grid gap-4">
              <Field label="Nome do modelo"><Input value={nome} onChange={(event) => setNome(event.target.value)} /></Field>
              <Field label="Assunto"><Input value={assunto} onChange={(event) => setAssunto(event.target.value)} /></Field>
              <div className="grid gap-2 rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Variáveis</p>
                  <Button type="button" variant="secondary" onClick={novaVariavel}>Inserir variável</Button>
                </div>
                {variaveis.length === 0 ? <p className="text-sm text-slate-500">Nenhuma variável na mensagem. Use Inserir variável.</p> : null}
                {variaveis.map((token) => (
                  <div key={token} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input aria-label={`Variável ${token}`} defaultValue={token} onBlur={(event) => renomear(token, event.target.value)} />
                    <Input aria-label={`Exemplo de ${token}`} placeholder="Exemplo na prévia" value={exemplos[token] ?? EXEMPLOS[token] ?? ""} onChange={(event) => setExemplos((atualExemplos) => ({ ...atualExemplos, [token]: event.target.value }))} />
                    <Button type="button" variant="secondary" onClick={() => inserir(token)}>Colocar</Button>
                  </div>
                ))}
              </div>
              <Field label="Mensagem">
                <Textarea ref={mensagem} className="min-h-[280px] font-mono text-xs leading-5" value={texto} onChange={(event) => setTexto(event.target.value)} />
              </Field>
              {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
              {aviso ? <p className="text-sm text-emerald-700">{aviso}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={salvar.isPending || !nome.trim() || !assunto.trim() || !texto.trim()} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando…" : "Salvar modelo"}</Button>
                <Button type="button" variant="danger" disabled={excluir.isPending} onClick={() => { if (window.confirm(`Excluir o modelo ${nome}?`)) excluir.mutate(); }}>Excluir modelo</Button>
              </div>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
