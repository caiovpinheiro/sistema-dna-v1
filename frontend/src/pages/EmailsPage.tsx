import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Mail, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Modelo = { id: number; vinculo: number; descricao: string; assunto: string | null; texto: string | null; remetente: string | null };

const CAMPOS = [
  { token: "@Nome-Candidato", nome: "Nome do candidato", exemplo: "Maria Souza" },
  { token: "@Primeiro-Nome-Candidato", nome: "Primeiro nome do candidato", exemplo: "Maria" },
  { token: "@Nome-Fantasia-Empresa", nome: "Nome da empresa", exemplo: "Empresa Exemplo" },
  { token: "@Razao-Social-Empresa", nome: "Razão social da empresa", exemplo: "Empresa Exemplo Ltda" },
  { token: "@CNPJ-Empresa", nome: "CNPJ da empresa", exemplo: "00.000.000/0001-00" },
  { token: "@Responsavel-RH-Empresa", nome: "Responsável da empresa", exemplo: "João Lima" },
  { token: "@Nome-Fantasia-Escola", nome: "Nome da escola", exemplo: "Escola Estadual Exemplo" },
  { token: "@Semestre-Candidato", nome: "Semestre do candidato", exemplo: "3º" },
  { token: "@Ano-Escolar", nome: "Ano escolar", exemplo: "2026" },
  { token: "@Turno-Candidato", nome: "Turno do candidato", exemplo: "Manhã" },
  { token: "@Cargo-Vaga", nome: "Cargo da vaga", exemplo: "Estágio" },
  { token: "@Codigo-Vaga", nome: "Código da vaga", exemplo: "1042" },
  { token: "@Bolsa-Auxilio-Vaga", nome: "Bolsa da vaga", exemplo: "R$ 800,00" },
  { token: "@Beneficios-Vaga", nome: "Benefícios da vaga", exemplo: "Vale-transporte" },
  { token: "@Carga-Horaria-Vaga", nome: "Carga horária da vaga", exemplo: "6 horas" },
  { token: "@Atividades-Vaga", nome: "Atividades da vaga", exemplo: "Apoio administrativo" },
  { token: "@Dados-Vaga", nome: "Dados da vaga", exemplo: "Estágio, 6 horas, bolsa R$ 800" },
  { token: "@Documento-Nome", nome: "Nome do documento", exemplo: "TCE - Maria Souza" },
  { token: "@Nome-Assinatura-Digital", nome: "Nome de quem assina", exemplo: "Maria Souza" },
  { token: "@Link-Assinatura-Digital", nome: "Link de assinatura", exemplo: "https://app.zapsign.com.br/verificar/exemplo" },
  { token: "@Link-Login-Sistema", nome: "Link de acesso", exemplo: "https://empresas.dnawork.ai" },
  { token: "@Link-Video-Chamada", nome: "Link da videochamada", exemplo: "https://meet.example.com/sala" },
  { token: "@Link-Confirma-Entrevista", nome: "Link para confirmar a entrevista", exemplo: "https://empresas.dnawork.ai/confirmar" },
  { token: "@Confirma-dados-link", nome: "Link para confirmar os dados", exemplo: "https://empresas.dnawork.ai/dados" },
  { token: "@Avaliacoes-link", nome: "Link da avaliação", exemplo: "https://empresas.dnawork.ai/avaliacao" },
  { token: "@Data-Entrevista", nome: "Data da entrevista", exemplo: "24/10/2026" },
  { token: "@Hora-Entrevista", nome: "Hora da entrevista", exemplo: "14:00" },
  { token: "@Valor", nome: "Valor", exemplo: "1.250,00" },
  { token: "@Vencimento", nome: "Vencimento", exemplo: "10/11/2026" },
  { token: "@link-pg", nome: "Link de pagamento", exemplo: "https://www.asaas.com/i/exemplo" },
  { token: "@tabela-cobranca", nome: "Tabela da cobrança", exemplo: "Tabela de cobrança do mês" },
  { token: "@tabela-encaminhados", nome: "Tabela de encaminhados", exemplo: "Lista de candidatos encaminhados" },
  { token: "@Usuario-Empresa", nome: "Usuário da empresa", exemplo: "contato@empresa.com" },
  { token: "@Usuario-Senha-Empresa", nome: "Senha de acesso da empresa", exemplo: "senha temporária" },
  { token: "@Nome-Quem-Preenche", nome: "Nome de quem preenche", exemplo: "Ana Costa" },
  { token: "@Variaveis-Candidato", nome: "Dados do candidato", exemplo: "Nome do candidato: Maria Souza." },
  { token: "@Variaveis-vaga", nome: "Resumo da vaga", exemplo: "Vaga: Estágio" },
  { token: "@Variaveis-Empresa", nome: "Dados da empresa", exemplo: "Empresa Exemplo Ltda" },
  { token: "@Dados-VagaSegue", nome: "Continuação dos dados da vaga", exemplo: "Horário comercial" },
  { token: "@Link", nome: "Link", exemplo: "https://empresas.dnawork.ai" },
  { token: "@Hora", nome: "Hora", exemplo: "14:00" },
  { token: "@Endereco-Agente", nome: "Endereço da DNA Work", exemplo: "Rua Exemplo" },
  { token: "@Numero-Endereco-Agente", nome: "Número do endereço da DNA Work", exemplo: "100" },
  { token: "@Bairro-Agente", nome: "Bairro da DNA Work", exemplo: "Centro" },
  { token: "@Complemento-Endereco-Agente", nome: "Complemento da DNA Work", exemplo: "Sala 2" },
  { token: "@Bairro-Empresa", nome: "Bairro da empresa", exemplo: "Centro" },
  { token: "@Entrevista-Endereco-Empresa", nome: "Endereço da entrevista", exemplo: "Rua da Empresa" },
  { token: "@Entrevista-Numero-Empresa", nome: "Número da entrevista", exemplo: "50" },
  { token: "@Entrevista-Bairro-Empresa", nome: "Bairro da entrevista", exemplo: "Centro" },
  { token: "@Entrevista-Complemento-Empresa", nome: "Complemento da entrevista", exemplo: "Sala 1" },
  { token: "@Nome-Assinatura-Digita", nome: "Nome de quem assina no texto antigo", exemplo: "Maria Souza" },
] as const;

function marcador(nome: string) {
  return `{{${nome}}}`;
}

function paraOperacao(texto: string) {
  return [...CAMPOS].sort((a, b) => b.token.length - a.token.length).reduce((saida, campo) => saida.split(campo.token).join(marcador(campo.nome)), texto);
}

function paraSistema(texto: string) {
  return [...CAMPOS].sort((a, b) => b.nome.length - a.nome.length).reduce((saida, campo) => saida.split(marcador(campo.nome)).join(campo.token), texto);
}

function variaveisDe(texto: string) {
  return [...new Set(texto.match(/\{\{[^}]+\}\}/g) ?? [])].map((item) => item.slice(2, -2));
}

function aplicar(texto: string, exemplos: Record<string, string>) {
  return variaveisDe(texto).sort((a, b) => b.length - a.length).reduce((saida, nome) => {
    const padrao = CAMPOS.find((campo) => campo.nome === nome)?.exemplo ?? nome;
    return saida.split(marcador(nome)).join(exemplos[nome] || padrao);
  }, texto);
}

function htmlParaTexto(html: string) {
  const comQuebras = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n");
  const semTags = comQuebras.replace(/<[^>]+>/g, "");
  const texto = semTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
  return texto.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function documentoDaPrevia(html: string, escuro: boolean) {
  const fundo = escuro ? "#15181e" : "#ffffff";
  const cor = escuro ? "#f4f6f8" : "#102033";
  const link = escuro ? "#67e8f9" : "#0e7490";
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font:14px/1.55 Manrope,ui-sans-serif,sans-serif;background:${fundo};color:${cor}}a{color:${link}}</style></head><body>${html}</body></html>`;
}

function textoParaHtml(texto: string) {
  const escapado = texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const blocos = escapado.split(/\n{2,}/).map((bloco) => bloco.trim()).filter(Boolean);
  if (!blocos.length) return "<p></p>";
  return blocos.map((bloco) => `<p>${bloco.replace(/\n/g, "<br>")}</p>`).join("");
}

function abrirModelo(valor: string) {
  return htmlParaTexto(paraOperacao(valor));
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
  const [campoNovo, setCampoNovo] = useState<string>(CAMPOS[0].nome);
  const [escuro, setEscuro] = useState(() => localStorage.getItem("dnawork-tema") !== "claro");
  const mensagem = useRef<HTMLTextAreaElement>(null);
  const atual = modelos.find((item) => item.vinculo === id) ?? modelos[0];

  useEffect(() => {
    const sincronizar = () => setEscuro(localStorage.getItem("dnawork-tema") !== "claro");
    window.addEventListener("dnawork-tema", sincronizar);
    return () => window.removeEventListener("dnawork-tema", sincronizar);
  }, []);

  useEffect(() => {
    if (!atual) return;
    setId(atual.vinculo);
    setNome(atual.descricao);
    setAssunto(abrirModelo(atual.assunto ?? ""));
    setTexto(abrirModelo(atual.texto ?? ""));
    setAviso("");
    setErro("");
  }, [atual?.vinculo]);

  const salvar = useMutation({
    mutationFn: () => api(`/api/v1/emails/${atual?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ assunto: paraSistema(assunto), texto: paraSistema(textoParaHtml(texto)), descricao: nome, vinculo: atual?.vinculo }),
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
  const previewHtml = useMemo(() => textoParaHtml(aplicar(texto, exemplos)), [texto, exemplos]);

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

  function inserirCampo(nomeCampo: string) {
    inserir(marcador(nomeCampo));
  }

  function trocarCampo(atualNome: string, novoNome: string) {
    if (!novoNome || novoNome === atualNome) return;
    const antigo = marcador(atualNome);
    const novo = marcador(novoNome);
    setAssunto((valor) => valor.split(antigo).join(novo));
    setTexto((valor) => valor.split(antigo).join(novo));
    setExemplos((valor) => {
      const copia = { ...valor, [novoNome]: valor[atualNome] ?? "" };
      delete copia[atualNome];
      return copia;
    });
  }

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="E-mails"
        descricao="Modelos dos e-mails que o sistema envia sozinho. Escolha o modelo, ajuste o texto com os campos variáveis e confira a prévia antes de salvar."
      />
      {lista.isLoading ? (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : null}
      {lista.isError ? <Alerta>Não foi possível carregar os modelos. Atualize a página; se continuar, avise o suporte.</Alerta> : null}
      {!lista.isLoading && !lista.isError && modelos.length === 0 ? (
        <Empty title="Nenhum modelo de e-mail" text="Os modelos usados pelo TCE, pela cobrança e pela régua aparecem aqui quando estiverem cadastrados." />
      ) : null}
      {modelos.length ? (
        <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="grid max-h-[78vh] content-start gap-1 overflow-auto p-2 lg:sticky lg:top-0">
            <p className="px-2 pb-1 pt-1 text-xs font-semibold text-slate-500">{modelos.length} {modelos.length === 1 ? "modelo" : "modelos"}</p>
            {modelos.map((item) => {
              const ativo = item.vinculo === atual?.vinculo;
              return (
                <button key={item.vinculo} type="button" aria-pressed={ativo} onClick={() => setId(item.vinculo)} className={cn("flex items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold leading-5 transition", ativo ? "bg-cyan-700 text-white" : "text-slate-700 hover:bg-slate-50")}>
                  <Mail size={15} className={cn("mt-0.5 shrink-0", ativo ? "" : "text-slate-400")} />
                  <span className="min-w-0">{item.descricao}</span>
                </button>
              );
            })}
          </Card>
          {atual ? (
            <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
              <Card className="grid min-w-0 gap-4">
                <div>
                  <h2 className="text-[15px] font-bold text-navy-900">Editar modelo</h2>
                  <p className="text-sm text-slate-500">O nome é a chave usada no envio: só troque se souber onde ele é usado.</p>
                </div>
                <Field label="Nome do modelo"><Input value={nome} onChange={(event) => setNome(event.target.value)} /></Field>
                <Field label="Assunto"><Input value={assunto} onChange={(event) => setAssunto(event.target.value)} /></Field>
                <Field label="Mensagem">
                  <Textarea ref={mensagem} className="min-h-[360px] w-full text-sm leading-6" value={texto} onChange={(event) => setTexto(event.target.value)} />
                </Field>
                <div className="grid gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <h3 className="text-sm font-bold text-navy-900">Campos da mensagem</h3>
                    <p className="text-xs leading-5 text-slate-500">Escolha um campo, como o nome do candidato ou da empresa, e coloque na mensagem onde o cursor estiver. No envio ele é trocado pelo dado real.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select aria-label="Campo para inserir" className="min-w-56 flex-1" value={campoNovo} onChange={(event) => setCampoNovo(event.target.value)}>
                      {CAMPOS.map((campo) => <option key={campo.token} value={campo.nome}>{campo.nome}</option>)}
                    </Select>
                    <Button type="button" variant="secondary" onClick={() => inserirCampo(campoNovo)}><Plus size={16} /> Colocar na mensagem</Button>
                  </div>
                  {variaveis.length ? (
                    <div className="grid gap-2">
                      <p className="text-xs font-semibold text-slate-500">Campos usados neste modelo e o exemplo mostrado na prévia</p>
                      {variaveis.map((nomeCampo) => (
                        <div key={nomeCampo} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                          <Select aria-label={`Campo ${nomeCampo}`} value={CAMPOS.some((campo) => campo.nome === nomeCampo) ? nomeCampo : ""} onChange={(event) => trocarCampo(nomeCampo, event.target.value)}>
                            {CAMPOS.some((campo) => campo.nome === nomeCampo) ? null : <option value="">{nomeCampo}</option>}
                            {CAMPOS.map((campo) => <option key={campo.token} value={campo.nome}>{campo.nome}</option>)}
                          </Select>
                          <Input aria-label={`Exemplo de ${nomeCampo}`} placeholder="Exemplo na prévia" value={exemplos[nomeCampo] ?? CAMPOS.find((campo) => campo.nome === nomeCampo)?.exemplo ?? ""} onChange={(event) => setExemplos((atualExemplos) => ({ ...atualExemplos, [nomeCampo]: event.target.value }))} />
                          <button type="button" className="acao acao-cyan justify-self-start sm:col-span-2" onClick={() => inserirCampo(nomeCampo)}>Colocar de novo na mensagem</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {erro ? <Alerta>{erro}</Alerta> : null}
                {aviso ? <Alerta tom="info">{aviso}</Alerta> : null}
                <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
                  <Button type="button" variant="secondary" className="text-rose-700" disabled={excluir.isPending} onClick={() => { if (window.confirm(`Excluir o modelo ${nome}?`)) excluir.mutate(); }}><Trash2 size={16} /> Excluir modelo</Button>
                  <Button type="button" disabled={salvar.isPending || !nome.trim() || !assunto.trim() || !texto.trim()} onClick={() => salvar.mutate()}><Save size={16} /> {salvar.isPending ? "Salvando…" : "Salvar alterações"}</Button>
                </div>
              </Card>
              <Card className="grid min-w-0 gap-3 xl:sticky xl:top-0">
                <div>
                  <h2 className="flex items-center gap-2 text-[15px] font-bold text-navy-900"><Eye size={16} className="text-cyan-700" /> Como o e-mail sai</h2>
                  <p className="text-sm text-slate-500">Prévia com os exemplos acima. Nada é enviado por esta tela.</p>
                </div>
                <dl className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm break-words">
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-500">De</dt><dd className="min-w-0 text-slate-700">{atual.remetente || "documentos@dnawork.ai"}</dd></div>
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-500">Para</dt><dd className="min-w-0 text-slate-700">maria.souza@exemplo.com</dd></div>
                  <div className="flex gap-2"><dt className="w-16 shrink-0 text-slate-500">Assunto</dt><dd className="min-w-0 font-semibold text-navy-900">{previewAssunto}</dd></div>
                </dl>
                <iframe key={`${escuro ? "escuro" : "claro"}:${previewHtml}`} title="Prévia do e-mail" sandbox="" srcDoc={documentoDaPrevia(previewHtml, escuro)} className="h-[640px] w-full rounded-lg border border-slate-200 bg-white" />
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
