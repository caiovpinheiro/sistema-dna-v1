import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import type { CurriculoPreparado } from "../lib/curriculo/arquivo.js";
import { PROMPT_DOSSIE_CLT, PROMPT_DOSSIE_ESTAGIO } from "../lib/dossie/prompts.js";
import { crmRequest, CrmApiError } from "../origem/crm-dna.js";
import { horarioDoEspelho, localDaEmpresa } from "./triagem.service.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type CrmFn = <T>(path: string, init?: RequestInit) => Promise<T>;

export type TipoDossie = "CLT" | "Estágio";

export type VagaDossie = { id: string; cargo: string; empresa: string; tipo: TipoDossie; local: string };

export type NegocioCrm = {
  id: string;
  titulo: string;
  status: string | null;
  etapa: string | null;
  funil: string | null;
  contato: string | null;
  telefone: string | null;
  atualizadoEm: string | null;
};

/** Linha de public.candidatos_dados: a mesma consulta do workflow "gerador-dossies" do n8n. */
export type CandidatoDados = {
  id: number;
  created_at: string | null;
  dealId: string;
  telefone: number | null;
  resumo_cv: string | null;
  nome: string | null;
  cep: number | null;
  sexo: string | null;
  escolaridade: string | null;
  turno: string | null;
  idade: string | number | null;
  tipo_de_vaga: string | null;
  "teste comportamental": string | null;
  info_conducoes: string | null;
  descricao_vaga: string | null;
  id_vaga_escolhida: string | number | null;
  id_empresa: string | number | null;
  resumo_entrevista: string | null;
};

/** Campos que o operador pode corrigir na tela. Vazio = mantém o que veio do banco. */
export type DadosManuais = { nome?: string; idade?: string; escolaridade?: string; turno?: string; bairroCidade?: string };

export type PedidoDossie = {
  vagaId: string;
  dealId?: string;
  telefone?: string;
  manual?: DadosManuais;
  curriculo?: CurriculoPreparado;
};

export type Dossie = {
  dossie: string;
  tipo: TipoDossie;
  modelo: string;
  vaga: VagaDossie;
  /** De onde veio o currículo usado: arquivo/texto enviado agora, resumo_cv do banco ou nenhum. */
  curriculo: "enviado" | "banco" | "nenhum";
};

/**
 * Mesma consulta do workflow "gerador-dossies" do n8n, mas trazendo todas as linhas do candidato: as do negócio
 * e as do mesmo telefone (o candidato pode ter linhas em negócios antigos). A ordem é a do n8n, com o negócio
 * atual na frente; depois as linhas são juntadas campo a campo (vale o primeiro valor preenchido).
 */
const SQL_CANDIDATO = `SELECT id::int AS id, created_at, "dealId", telefone::float8 AS telefone, resumo_cv, nome,
  cep::float8 AS cep, sexo, escolaridade, turno, idade, tipo_de_vaga,
  "teste comportamental", info_conducoes, descricao_vaga, id_vaga_escolhida,
  id_empresa, resumo_entrevista
FROM public.candidatos_dados
WHERE "dealId" = $1
   OR (cardinality($2::text[]) > 0 AND regexp_replace(split_part(telefone::text, '.', 1), '\\D', '', 'g') = ANY($2::text[]))
ORDER BY ("dealId" = $1) DESC, (resumo_cv IS NOT NULL) DESC, id DESC
LIMIT 20`;

/** Campos do painel do negócio no CRM que completam o que faltar em candidatos_dados. */
const CAMPOS_CRM: Array<[string, keyof CandidatoDados]> = [
  ["nome_completo", "nome"],
  ["idade", "idade"],
  ["escolaridade", "escolaridade"],
  ["turno", "turno"],
  ["sexo", "sexo"],
  ["tipo_de_vaga", "tipo_de_vaga"],
  ["teste_comportamental", "teste comportamental"],
  ["teste_de_perfil_disc", "teste comportamental"],
  ["resumo_da_entrevista", "resumo_entrevista"],
  ["id_vaga_escolhida", "id_vaga_escolhida"],
];

function vazio(valor: unknown) {
  return valor == null || (typeof valor === "string" && !valor.trim());
}

/** Junta as linhas campo a campo: a primeira (negócio atual, com currículo, mais recente) manda; as outras só preenchem o vazio. */
export function juntarLinhas(linhas: CandidatoDados[]): CandidatoDados | null {
  if (!linhas.length) return null;
  const junta = { ...linhas[0] } as Record<string, unknown>;
  for (const linha of linhas.slice(1)) {
    for (const [chave, valor] of Object.entries(linha)) if (vazio(junta[chave]) && !vazio(valor)) junta[chave] = valor;
  }
  return junta as CandidatoDados;
}

/** Variações do telefone para achar a linha: com e sem o 55 do Brasil. */
export function variacoesDoTelefone(telefone: string | null | undefined): string[] {
  const numero = digitos(String(telefone ?? ""));
  if (numero.length < 10) return [];
  const local = numero.startsWith("55") && numero.length >= 12 ? numero.slice(2) : numero;
  return [...new Set([numero, local, `55${local}`])];
}

/** Valores do painel de campos do negócio (dealPanelFields), por nome do campo. */
export function camposDoPainel(negocio: Record<string, unknown>): Record<string, string> {
  const campos: Record<string, string> = {};
  const painel = Array.isArray(negocio.dealPanelFields) ? negocio.dealPanelFields as Array<Record<string, unknown>> : [];
  for (const campo of painel) {
    const nome = texto(campo.name);
    const valor = texto(Array.isArray(campo.value) ? campo.value.join(", ") : campo.value);
    if (nome && valor) campos[nome] = valor;
  }
  return campos;
}

/** Completa a linha do banco com o que o CRM tem e o banco não. Sem linha no banco, monta uma só com o CRM. */
export function completarComCrm(linha: CandidatoDados | null, campos: Record<string, string>, dealId: string): CandidatoDados | null {
  const preenchidos = CAMPOS_CRM.filter(([nome]) => campos[nome]);
  if (!preenchidos.length) return linha;
  const base = (linha ? { ...linha } : { dealId }) as Record<string, unknown>;
  // A vaga escolhida muda no CRM ao longo do atendimento: o valor de lá vale mais que o gravado no banco.
  for (const [nome, chave] of preenchidos) if (vazio(base[chave]) || chave === "id_vaga_escolhida") base[chave] = campos[nome];
  return base as CandidatoDados;
}

/** Dados que o dossiê nunca usa e não precisam sair do sistema (o prompt já proíbe telefone e CEP no texto). */
const FORA_DO_PROMPT = new Set(["id", "created_at", "dealId", "telefone", "cep", "descricao_vaga", "id_vaga_escolhida", "id_empresa", "tipo_de_vaga"]);

type LinhaVaga = {
  id: string;
  cargo: string | null;
  tipo_vaga: number | null;
  atividades: string | null;
  descricao: string | null;
  requisitos: string | null;
  horario: string | null;
  cargo_descricao: string | null;
  cargo_requisitos: string | null;
  nome_fantasia: string | null;
  local: string | null;
  empresa_id: string | null;
};

function texto(valor: unknown): string | null {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function digitos(valor: string) {
  return valor.replace(/\D/g, "");
}

function tipoDaVaga(codigo: number | null | undefined): TipoDossie {
  return Number(codigo) === 1 ? "Estágio" : "CLT";
}

/** Data de hoje em São Paulo, como o $now.toFormat('yyyy-MM-dd') do n8n. */
export function dataDeReferencia(agora: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

/** Texto da vaga escolhida que vai em descricao_vaga: atividades, descrição, requisitos e horário. */
export function descricaoDaVaga(linha: LinhaVaga): string {
  const partes: Array<[string, string | null]> = [
    ["Atividades", texto(linha.atividades)],
    ["Descrição", texto(linha.descricao) ?? texto(linha.cargo_descricao)],
    ["Requisitos", texto(linha.requisitos) ?? texto(linha.cargo_requisitos)],
    ["Horário da vaga", horarioDoEspelho(linha.horario)],
  ];
  return partes.filter(([, valor]) => valor).map(([rotulo, valor]) => `${rotulo}: ${valor}`).join("\n");
}

/**
 * JSON do candidato para o prompt, no mesmo formato que o n8n mandava ($json da linha de candidatos_dados),
 * com a vaga trocada pela que o operador escolheu e as correções manuais por cima.
 */
export function montarDadosDoCandidato(input: {
  linha: CandidatoDados | null;
  vaga: LinhaVaga;
  manual?: DadosManuais;
  resumoCv?: string | null;
}): Record<string, unknown> {
  const dados: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(input.linha ?? {})) {
    if (FORA_DO_PROMPT.has(chave)) continue;
    if (valor == null || (typeof valor === "string" && !valor.trim())) continue;
    dados[chave] = valor;
  }
  const manual = input.manual ?? {};
  if (texto(manual.nome)) dados.nome = texto(manual.nome);
  if (texto(manual.idade)) dados.idade = texto(manual.idade);
  if (texto(manual.escolaridade)) dados.escolaridade = texto(manual.escolaridade);
  if (texto(manual.turno)) dados.turno = texto(manual.turno);
  if (texto(manual.bairroCidade)) dados.bairro_cidade = texto(manual.bairroCidade);
  if (input.resumoCv !== undefined) {
    if (texto(input.resumoCv)) dados.resumo_cv = texto(input.resumoCv);
    else delete dados.resumo_cv;
  }
  const tipo = tipoDaVaga(input.vaga.tipo_vaga);
  dados.tipo_de_vaga = tipo;
  dados.cargo_vaga = texto(input.vaga.cargo) ?? "Vaga";
  dados.empresa_vaga = texto(input.vaga.nome_fantasia);
  const descricao = descricaoDaVaga(input.vaga);
  if (descricao) dados.descricao_vaga = descricao;
  dados.id_vaga_escolhida = input.vaga.id;
  if (texto(input.vaga.empresa_id)) dados.id_empresa = texto(input.vaga.empresa_id);
  for (const chave of Object.keys(dados)) if (dados[chave] == null) delete dados[chave];
  return dados;
}

/** Mesma regra do nó "Code in JavaScript" do n8n: ERRO_DADOS_INCONSISTENTES vira erro com o motivo. */
export function interpretarDossie(textoIa: string): { ok: true; dossie: string } | { ok: false; motivo: string } {
  const limpo = textoIa.trim();
  if (!limpo) return { ok: false, motivo: "A IA não retornou nenhum texto." };
  const erro = limpo.match(/ERRO_DADOS_INCONSISTENTES\s*:?\s*([\s\S]*)/i);
  if (erro) return { ok: false, motivo: erro[1].trim() || "Dados inconsistentes." };
  return { ok: true, dossie: limpo };
}

function textoDaResposta(resposta: unknown): { texto: string; recusa: boolean } {
  const corpo = resposta as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; output_text?: string };
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

function negocioDe(item: Record<string, unknown>): NegocioCrm | null {
  const id = texto(item.id);
  if (!id) return null;
  const contato = (item.contact ?? {}) as Record<string, unknown>;
  const etapa = (item.stage ?? {}) as Record<string, unknown>;
  const funil = (etapa.pipeline ?? {}) as Record<string, unknown>;
  return {
    id,
    titulo: texto(item.title) ?? "Negócio",
    status: texto(item.status),
    etapa: texto(etapa.name),
    funil: texto(funil.name),
    contato: texto(contato.name),
    telefone: texto(contato.phone),
    atualizadoEm: texto(item.updatedAt),
  };
}

function erroDoCrm(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof CrmApiError && /não configurados/.test(error.message)) {
    return new AppError(503, "CRM_NAO_CONFIGURADO", "A busca no CRM não está configurada (CRM_BASE_URL e CRM_API_KEY).");
  }
  if (error instanceof CrmApiError && error.status === 404) return new AppError(404, "NEGOCIO_NAO_ENCONTRADO", "Negócio não encontrado no CRM.");
  return new AppError(502, "CRM_FALHOU", "Não foi possível consultar o CRM agora.");
}

/**
 * Gerador de dossiês da triagem: a mesma tarefa do workflow "gerador-dossies" do n8n, mas com a vaga escolhida
 * pelo operador e o currículo enviado na tela. Só lê o banco e o CRM; grava no CRM apenas quando o operador
 * pede para salvar a nota.
 */
export class DossieService {
  constructor(
    private readonly db: Pool,
    private readonly config: Pick<AppConfig, "OPENAI_API_KEY" | "OPENAI_API_URL" | "LUNA_MODEL" | "LUNA_TIMEOUT_MS">,
    private readonly crm: CrmFn = crmRequest,
    private readonly fetcher: FetchLike = fetch,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  get configurada() {
    return Boolean(this.config.OPENAI_API_KEY);
  }

  get modelo() {
    return this.config.LUNA_MODEL;
  }

  private async linhasDeVaga(id?: string): Promise<LinhaVaga[]> {
    const filtro = id ? "WHERE v.id::text = $1" : "";
    const completa = `
      SELECT v.id::text AS id, v.cargo, v.tipo_vaga, v.atividades, v.descricao, v.requisitos, v.horario,
             c.descricao AS cargo_descricao, c.requisitos AS cargo_requisitos, e.nome_fantasia, e.local, v.empresa_id::text AS empresa_id
      FROM public.vaga v
      LEFT JOIN public.empresa e ON e.id = v.empresa_id
      LEFT JOIN public.cargo c ON c.id = v.cargo_id
      ${filtro}
      ORDER BY v.cargo, e.nome_fantasia`;
    const basica = `
      SELECT v.id::text AS id, v.cargo, v.tipo_vaga, v.atividades, NULL::text AS descricao, NULL::text AS requisitos, v.horario,
             NULL::text AS cargo_descricao, NULL::text AS cargo_requisitos, e.nome_fantasia, e.local, v.empresa_id::text AS empresa_id
      FROM public.vaga v
      LEFT JOIN public.empresa e ON e.id = v.empresa_id
      ${filtro}
      ORDER BY v.cargo, e.nome_fantasia`;
    const params = id ? [id] : [];
    try {
      return (await this.db.query<LinhaVaga>(completa, params)).rows;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42703" && code !== "42P01") throw error;
      return (await this.db.query<LinhaVaga>(basica, params)).rows;
    }
  }

  /** Vagas abertas do sistema (public.vaga só guarda as abertas; o sync tira as fechadas). */
  async listarVagas(): Promise<VagaDossie[]> {
    return (await this.linhasDeVaga()).map((linha) => ({
      id: linha.id,
      cargo: texto(linha.cargo) ?? "Vaga",
      empresa: texto(linha.nome_fantasia) ?? "",
      tipo: tipoDaVaga(linha.tipo_vaga),
      local: localDaEmpresa(linha.local),
    }));
  }

  /** Linhas de candidatos_dados do negócio e do telefone, juntas. Banco sem a tabela responde null, sem derrubar a tela. */
  async dadosDoCandidato(dealId: string, telefone?: string | null): Promise<CandidatoDados | null> {
    try {
      const { rows } = await this.db.query<CandidatoDados>(SQL_CANDIDATO, [dealId, variacoesDoTelefone(telefone)]);
      return juntarLinhas(rows);
    } catch (error) {
      if ((error as { code?: string }).code === "42P01") return null;
      throw error;
    }
  }

  /** Campos do painel do negócio no CRM. Falha do CRM aqui não impede o dossiê: só fica sem esse complemento. */
  private async camposDoNegocio(dealId: string): Promise<Record<string, string>> {
    try {
      return camposDoPainel(await this.crm<Record<string, unknown>>(`/api/deals/${encodeURIComponent(dealId)}`));
    } catch {
      return {};
    }
  }

  /** Dados do candidato para o dossiê: candidatos_dados (negócio + telefone) completado com o painel do CRM. */
  async candidatoCompleto(dealId: string, telefone?: string | null): Promise<CandidatoDados | null> {
    const [linha, campos] = await Promise.all([this.dadosDoCandidato(dealId, telefone), this.camposDoNegocio(dealId)]);
    return completarComCrm(linha, campos, dealId);
  }

  /** Acha, entre as vagas abertas, a do id_vaga_escolhida (id da vaga ou o vaga_id do grupo). */
  async vagaDoId(idVaga: unknown): Promise<string | null> {
    const id = texto(idVaga);
    if (!id) return null;
    const { rows } = await this.db.query<{ id: string }>(
      "SELECT v.id::text AS id FROM public.vaga v WHERE v.id::text = $1 OR v.vaga_id::text = $1 ORDER BY (v.id::text = $1) DESC LIMIT 1",
      [id],
    );
    return rows[0]?.id ?? null;
  }

  private async negociosPorTelefone(telefone: string): Promise<NegocioCrm[]> {
    const numero = digitos(telefone);
    if (numero.length < 8) throw new AppError(422, "TELEFONE_INVALIDO", "Informe o telefone com DDD.");
    try {
      const lista = await this.crm<{ items?: Array<Record<string, unknown>> }>(`/api/deals?search=${encodeURIComponent(numero)}&perPage=10`);
      const negocios = (lista.items ?? []).map(negocioDe).filter((item): item is NegocioCrm => Boolean(item));
      // Abertos primeiro; dentro de cada grupo, o mais recente.
      return negocios.sort((a, b) =>
        Number(b.status === "OPEN") - Number(a.status === "OPEN") || String(b.atualizadoEm ?? "").localeCompare(String(a.atualizadoEm ?? "")));
    } catch (error) {
      throw erroDoCrm(error);
    }
  }

  private async negocioPorId(dealId: string): Promise<NegocioCrm | null> {
    try {
      return negocioDe(await this.crm<Record<string, unknown>>(`/api/deals/${encodeURIComponent(dealId)}`));
    } catch (error) {
      const erro = erroDoCrm(error);
      if (erro.statusCode === 404) return null;
      throw erro;
    }
  }

  /**
   * Acha o negócio no CRM (pelo telefone ou pelo id) e devolve a linha de candidatos_dados dele.
   * Com mais de um negócio para o telefone, usa o pedido em dealId ou o primeiro (aberto e mais recente).
   */
  async buscarCandidato(input: { telefone?: string; dealId?: string }) {
    let negocios: NegocioCrm[] = [];
    if (input.telefone) negocios = await this.negociosPorTelefone(input.telefone);
    let negocio = input.dealId ? negocios.find((item) => item.id === input.dealId) ?? null : negocios[0] ?? null;
    if (input.dealId && !negocio) {
      negocio = await this.negocioPorId(input.dealId);
      if (negocio && !negocios.length) negocios = [negocio];
    }
    const candidato = negocio ? await this.candidatoCompleto(negocio.id, negocio.telefone ?? input.telefone) : null;
    // Vaga do campo id_vaga_escolhida do negócio: a tela já deixa selecionada.
    const vagaEscolhidaId = candidato ? await this.vagaDoId(candidato.id_vaga_escolhida) : null;
    return { negocios, negocio, candidato, vagaEscolhidaId, idVagaCrm: texto(candidato?.id_vaga_escolhida) };
  }

  private exigirChave() {
    if (!this.config.OPENAI_API_KEY) {
      throw new AppError(503, "IA_NAO_CONFIGURADA", "A geração de dossiê não está configurada (OPENAI_API_KEY).");
    }
  }

  private conteudo(prompt: string, curriculo: CurriculoPreparado | undefined) {
    if (curriculo?.tipo === "pdf") {
      return [
        { type: "input_file", filename: curriculo.nome, file_data: `data:application/pdf;base64,${curriculo.base64}` },
        { type: "input_text", text: prompt },
      ];
    }
    if (curriculo?.tipo === "imagem") {
      return [
        { type: "input_image", image_url: `data:${curriculo.mime};base64,${curriculo.base64}` },
        { type: "input_text", text: prompt },
      ];
    }
    return [{ type: "input_text", text: prompt }];
  }

  private async chamarIa(prompt: string, curriculo: CurriculoPreparado | undefined): Promise<string> {
    let resposta: Response;
    try {
      resposta = await this.fetcher(`${this.config.OPENAI_API_URL.replace(/\/+$/, "")}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelo,
          input: [{ role: "user", content: this.conteudo(prompt, curriculo) }],
          max_output_tokens: 3000,
          store: false,
        }),
        signal: AbortSignal.timeout(this.config.LUNA_TIMEOUT_MS),
      });
    } catch (error) {
      const nome = (error as { name?: string })?.name;
      if (nome === "TimeoutError" || nome === "AbortError") throw new AppError(504, "IA_TIMEOUT", "A geração do dossiê demorou demais. Tente de novo.");
      throw new AppError(502, "IA_FALHOU", "Não foi possível falar com a OpenAI agora.");
    }
    if (!resposta.ok) {
      if (resposta.status === 401 || resposta.status === 403) throw new AppError(502, "IA_CREDENCIAL", "A OpenAI recusou a chave configurada.");
      if (resposta.status === 404) throw new AppError(502, "IA_MODELO_INDISPONIVEL", `O modelo ${this.modelo} não está disponível para esta chave.`);
      if (resposta.status === 429) throw new AppError(503, "IA_LIMITE", "Limite de uso da OpenAI atingido. Tente em instantes.");
      throw new AppError(502, "IA_FALHOU", `A OpenAI respondeu com erro (${resposta.status}).`);
    }
    const corpo = await resposta.json().catch(() => null) as { status?: string } | null;
    const { texto: saida, recusa } = textoDaResposta(corpo);
    if (recusa) throw new AppError(422, "IA_RECUSOU", "A IA não gerou o dossiê para estes dados.");
    if (!saida && corpo?.status === "incomplete") throw new AppError(502, "IA_INCOMPLETA", "A geração foi interrompida antes de terminar. Tente de novo.");
    return saida;
  }

  async gerar(input: PedidoDossie): Promise<Dossie> {
    this.exigirChave();
    const [linhaVaga] = await this.linhasDeVaga(input.vagaId);
    if (!linhaVaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "A vaga escolhida não está mais aberta.");
    const linha = input.dealId ? await this.candidatoCompleto(input.dealId, input.telefone) : null;

    const enviado = input.curriculo;
    // Texto colado/DOCX entra como resumo_cv; PDF e imagem vão anexados e substituem o resumo_cv do banco.
    const resumoCv = enviado?.tipo === "texto" ? enviado.texto : enviado ? null : undefined;
    const dados = montarDadosDoCandidato({ linha, vaga: linhaVaga, manual: input.manual, resumoCv });
    if (!texto(dados.nome)) throw new AppError(422, "SEM_NOME", "Informe o nome do candidato ou busque o negócio no CRM.");
    const origemCurriculo: Dossie["curriculo"] = enviado ? "enviado" : texto(dados.resumo_cv) ? "banco" : "nenhum";
    if (origemCurriculo === "nenhum") throw new AppError(422, "SEM_CURRICULO", "Envie o currículo do candidato para gerar o dossiê.");

    const tipo = tipoDaVaga(linhaVaga.tipo_vaga);
    const anexo = enviado && enviado.tipo !== "texto"
      ? "\n\nCURRÍCULO ANEXADO:\nO arquivo anexado a esta mensagem é o currículo atual do candidato. Use-o no lugar de resumo_cv."
      : "";
    const prompt = `${tipo === "Estágio" ? PROMPT_DOSSIE_ESTAGIO : PROMPT_DOSSIE_CLT}\n\nDATA DE REFERÊNCIA:\n${dataDeReferencia(this.agora())}\n\nDADOS DO CANDIDATO:\n${JSON.stringify(dados)}${anexo}`;

    const resultado = interpretarDossie(await this.chamarIa(prompt, enviado));
    if (!resultado.ok) throw new AppError(422, "DADOS_INCONSISTENTES", `A IA não gerou o dossiê: ${resultado.motivo}`, { motivo: resultado.motivo });
    return {
      dossie: resultado.dossie,
      tipo,
      modelo: this.modelo,
      curriculo: origemCurriculo,
      vaga: { id: linhaVaga.id, cargo: texto(linhaVaga.cargo) ?? "Vaga", empresa: texto(linhaVaga.nome_fantasia) ?? "", tipo, local: localDaEmpresa(linhaVaga.local) },
    };
  }

  /** Grava o dossiê como nota no negócio, como o nó "Create a note on a deal" do n8n. Só quando o operador pede. */
  async salvarNota(dealId: string, conteudo: string) {
    try {
      await this.crm(`/api/deals/${encodeURIComponent(dealId)}/notes`, { method: "POST", body: JSON.stringify({ content: conteudo }) });
    } catch (error) {
      throw erroDoCrm(error);
    }
    return { salvo: true };
  }
}
