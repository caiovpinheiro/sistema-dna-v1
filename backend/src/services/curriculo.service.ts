import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import type { CurriculoPreparado } from "../lib/curriculo/arquivo.js";
import { cepDoCurriculo, type CepDoCurriculo } from "../lib/curriculo/cep.js";
import { LUNA_JSON_SCHEMA, normalizarCurriculo, perfilParaEdicao, type CurriculoExtraido, type PerfilProfissional } from "../lib/curriculo/perfil.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AnaliseCurriculo = {
  extraido: CurriculoExtraido;
  perfil: PerfilProfissional;
  /** CEP para a busca, tirado do endereço do currículo. Não vai para o JEV. */
  localizacao: CepDoCurriculo;
  modelo: string;
};

/** Mesmas regras do resumo do workflow "resumo cv + match", agora pedindo JSON estruturado. */
export const INSTRUCOES_LUNA = [
  "Você extrai dados de currículos para um atendente de recrutamento. Responda somente com o JSON pedido.",
  "Extraia apenas informações claramente presentes no currículo. Não invente datas, durações, empresas, cargos, cursos ou habilidades.",
  "Campo sem informação fica null; lista sem itens fica vazia. Não escreva \"Não informado\".",
  "Datas das experiências: AAAA-MM quando houver mês; AAAA quando só houver o ano; null quando não houver data.",
  "Se a experiência estiver marcada como atual, \"até o momento\" ou equivalente, use atual=true e fim=null.",
  "Não calcule tempo total; o sistema calcula a partir das datas.",
  "Não extraia idade, data de nascimento, sexo, estado civil, documentos, telefone ou e-mail.",
  "O endereço residencial (CEP, rua sem número, bairro, cidade, UF) serve só para localizar a pessoa; copie como está escrito e não deduza CEP.",
  "O resumo tem no máximo 3 frases objetivas e só descreve fatos do currículo.",
  "Não faça julgamentos como bom candidato, candidato fraco, recomendado ou não recomendado.",
].join("\n");

function textoDaResposta(resposta: unknown): { texto: string; recusa: boolean } {
  const corpo = resposta as { output?: Array<{ type?: string; role?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>; output_text?: string };
  let recusa = false;
  const textos: string[] = [];
  for (const item of Array.isArray(corpo?.output) ? corpo.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const parte of item.content) {
      if (parte?.type === "output_text" && typeof parte.text === "string") textos.push(parte.text);
      if (parte?.type === "refusal") recusa = true;
    }
  }
  const texto = textos.join("").trim() || (typeof corpo?.output_text === "string" ? corpo.output_text.trim() : "");
  return { texto, recusa };
}

/** Lê o JSON mesmo quando vem cercado por ```json. */
export function lerJsonDaLuna(texto: string): unknown {
  const limpo = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const inicio = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (inicio >= 0 && fim > inicio) return JSON.parse(limpo.slice(inicio, fim + 1));
    throw new Error("JSON inválido");
  }
}

function conteudoDe(curriculo: CurriculoPreparado, comSchemaNoTexto: boolean) {
  const pedido = comSchemaNoTexto
    ? `Extraia os dados deste currículo. Responda só com um JSON válido neste schema:\n${JSON.stringify(LUNA_JSON_SCHEMA)}`
    : "Extraia os dados deste currículo.";
  if (curriculo.tipo === "pdf") {
    return [
      { type: "input_file", filename: curriculo.nome, file_data: `data:application/pdf;base64,${curriculo.base64}` },
      { type: "input_text", text: pedido },
    ];
  }
  if (curriculo.tipo === "imagem") {
    return [
      { type: "input_image", image_url: `data:${curriculo.mime};base64,${curriculo.base64}` },
      { type: "input_text", text: pedido },
    ];
  }
  return [{ type: "input_text", text: `${pedido}\n\nCURRÍCULO:\n${curriculo.texto}` }];
}

/**
 * Análise de currículo pela OpenAI (modelo Luna). Só extrai e resume: não decide contratação.
 * O conteúdo do currículo nunca vai para log nem para mensagem de erro.
 */
export class CurriculoService {
  constructor(
    private readonly config: Pick<AppConfig, "OPENAI_API_KEY" | "OPENAI_API_URL" | "LUNA_MODEL" | "LUNA_TIMEOUT_MS">,
    private readonly fetcher: FetchLike = fetch,
    private readonly agora: () => Date = () => new Date(),
    private readonly localizar: (endereco: CurriculoExtraido["endereco"]) => Promise<CepDoCurriculo> = (endereco) => cepDoCurriculo(endereco),
  ) {}

  get configurada() {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  get modelo() {
    return this.config.LUNA_MODEL;
  }

  private base() {
    return this.config.OPENAI_API_URL.replace(/\/+$/, "");
  }

  private exigirChave() {
    if (!this.config.OPENAI_API_KEY) {
      throw new AppError(503, "LUNA_NAO_CONFIGURADA", "A análise de currículo não está configurada (OPENAI_API_KEY). Preencha o resumo manualmente.");
    }
  }

  /** Confere na OpenAI se o modelo configurado existe para esta chave. */
  async verificarModelo(): Promise<{ disponivel: boolean | null; motivo?: string }> {
    if (!this.configurada) return { disponivel: null, motivo: "OPENAI_API_KEY não definida." };
    try {
      const resposta = await this.fetcher(`${this.base()}/models/${encodeURIComponent(this.modelo)}`, {
        headers: { Authorization: `Bearer ${this.config.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (resposta.ok) return { disponivel: true };
      if (resposta.status === 404) return { disponivel: false, motivo: `Modelo ${this.modelo} não encontrado para esta chave.` };
      if (resposta.status === 401 || resposta.status === 403) return { disponivel: null, motivo: "Chave da OpenAI recusada." };
      return { disponivel: null, motivo: `OpenAI respondeu ${resposta.status}.` };
    } catch {
      return { disponivel: null, motivo: "Não foi possível consultar a OpenAI." };
    }
  }

  private async chamar(curriculo: CurriculoPreparado, estruturado: boolean): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.modelo,
      instructions: INSTRUCOES_LUNA,
      input: [{ role: "user", content: conteudoDe(curriculo, !estruturado) }],
      max_output_tokens: 2500,
      store: false,
    };
    if (estruturado) body.text = { format: { type: "json_schema", name: "curriculo", strict: true, schema: LUNA_JSON_SCHEMA } };
    try {
      return await this.fetcher(`${this.base()}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.LUNA_TIMEOUT_MS),
      });
    } catch (error) {
      const nome = (error as { name?: string })?.name;
      if (nome === "TimeoutError" || nome === "AbortError") {
        throw new AppError(504, "LUNA_TIMEOUT", "A análise do currículo demorou demais. Tente de novo ou preencha o resumo manualmente.");
      }
      throw new AppError(502, "LUNA_FALHOU", "Não foi possível falar com a OpenAI agora.");
    }
  }

  private erroHttp(status: number): AppError {
    if (status === 401 || status === 403) return new AppError(502, "LUNA_CREDENCIAL", "A OpenAI recusou a chave configurada.");
    if (status === 404) return new AppError(502, "LUNA_MODELO_INDISPONIVEL", `O modelo ${this.modelo} não está disponível para esta chave.`);
    if (status === 429) return new AppError(503, "LUNA_LIMITE", "Limite de uso da OpenAI atingido. Tente em instantes.");
    return new AppError(502, "LUNA_FALHOU", `A OpenAI respondeu com erro (${status}).`);
  }

  async analisar(curriculo: CurriculoPreparado): Promise<AnaliseCurriculo> {
    this.exigirChave();
    let resposta = await this.chamar(curriculo, true);
    // Modelo sem suporte a structured output: repete pedindo o JSON no texto, com a mesma validação na volta.
    if (resposta.status === 400) resposta = await this.chamar(curriculo, false);
    if (!resposta.ok) throw this.erroHttp(resposta.status);

    const corpo = await resposta.json().catch(() => null) as { status?: string } | null;
    const { texto, recusa } = textoDaResposta(corpo);
    if (recusa) throw new AppError(422, "LUNA_RECUSOU", "A IA não analisou este arquivo. Preencha o resumo manualmente.");
    if (!texto) {
      throw new AppError(502, "LUNA_SEM_RESPOSTA", corpo?.status === "incomplete"
        ? "A análise foi interrompida antes de terminar. Tente um arquivo menor."
        : "A IA não devolveu dados do currículo.");
    }
    let extraido: CurriculoExtraido;
    try {
      extraido = normalizarCurriculo(lerJsonDaLuna(texto), this.agora());
    } catch {
      throw new AppError(502, "LUNA_FORMATO", "A resposta da IA veio fora do formato esperado. Tente de novo.");
    }
    // Falha ao achar o CEP não derruba a análise: o operador digita o CEP como antes.
    const localizacao = await this.localizar(extraido.endereco).catch(() => ({ cep: null, origem: null, endereco: null, motivo: null }));
    return { extraido, perfil: perfilParaEdicao(extraido), localizacao, modelo: this.modelo };
  }
}
