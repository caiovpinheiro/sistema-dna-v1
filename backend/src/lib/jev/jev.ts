/**
 * Integração com o JEV (TypeSafe, https://docs.typesafe.ai/api).
 *
 * O que está confirmado (workflow "enviar vagas automaticas", nó n8n-nodes-jev, e uma execução real):
 * - modelo "jev-latest" (a execução respondeu "_model": "jev-1.14.0");
 * - pergunta do tipo "score" com id "compatibilidade_profissional" e cinco níveis, numerados a partir de 0;
 * - resposta simplificada: { compatibilidade_profissional: 2.32, compatibilidade_profissional_confidence: 0.7,
 *   compatibilidade_profissional_level: "Moderada: …", _model: "jev-1.14.0" }. Não há justificativa em texto.
 *
 * O que NÃO está confirmado: endpoint HTTP, autenticação e formato bruto da API. Por isso o transporte HTTP
 * fica pendente (ver criarTransporteJev) e nenhuma resposta é simulada.
 */

export type PerguntaScore = {
  id: string;
  type: "score";
  instructions: string;
  /** Um nível por item, do mais baixo ao mais alto. O primeiro é o nível 0. */
  scoreLevels: string[];
};

export const PERGUNTA_COMPATIBILIDADE: PerguntaScore = {
  id: "compatibilidade_profissional",
  type: "score",
  instructions: "Avalie a compatibilidade profissional entre o currículo do candidato e a vaga apresentada. Considere experiências profissionais, atividades já realizadas, habilidades técnicas, conhecimentos relevantes, formação e competências transferíveis. Utilize somente informações presentes no currículo. Não invente qualificações e não utilize idade, sexo ou outros atributos pessoais como indicadores de competência. Quando não houver informações suficientes, indique baixa evidência de compatibilidade, sem presumir incapacidade.",
  scoreLevels: [
    "Muito baixa: não há evidências suficientes de experiências ou habilidades relacionadas à vaga.",
    "Baixa: apresenta pouca experiência ou conhecimentos relacionados às atividades.",
    "Moderada: possui algumas experiências ou habilidades transferíveis relevantes.",
    "Alta: apresenta experiências e competências compatíveis com boa parte da vaga.",
    "Muito alta: demonstra forte aderência às principais atividades e requisitos profissionais da vaga.",
  ],
};

export type Escala = { min: number; max: number };

/** Escala real da pergunta: níveis numerados a partir de 0 (cinco níveis = 0 a 4). Não é percentual. */
export function escalaDa(pergunta: PerguntaScore): Escala {
  return { min: 0, max: pergunta.scoreLevels.length - 1 };
}

/** Vaga como o JEV recebe: só dados profissionais da vaga. */
export type VagaParaJev = {
  cargo: string;
  atividades: string | null;
  descricao: string | null;
  requisitos: string | null;
  escolaridade: string | null;
  cargaHoraria: string | null;
  horario: string | null;
  tipo: string;
};

export type RequisicaoJev = {
  modelo: string;
  estado: string;
  perguntas: PerguntaScore[];
};

export type AvaliacaoJev = {
  score: number;
  escala: Escala;
  confianca: number | null;
  /** Nome do nível ("Moderada"), como o JEV devolveu antes dos dois-pontos. */
  nivel: string | null;
  /** Descrição do nível na régua enviada ao JEV. É a régua, não um motivo escrito pelo JEV. */
  descricaoNivel: string | null;
  modelo: string | null;
  /** Só preenchidos se a API um dia devolver texto próprio. Hoje vêm vazios. */
  justificativa: string | null;
  evidencias: string[];
  lacunas: string[];
};

export class RespostaJevInvalida extends Error {}

function linha(rotulo: string, valor: string | null | undefined) {
  return `${rotulo}: ${String(valor ?? "").trim()}`;
}

/** Mesmo layout do stateText do workflow, com descrição, requisitos e horário da vaga, que já existem em public.vaga. */
export function montarEstadoJev(curriculo: string, vaga: VagaParaJev): string {
  return [
    "CURRÍCULO DO CANDIDATO:",
    curriculo.trim() || "Currículo não informado",
    "",
    "VAGA:",
    linha("Cargo", vaga.cargo),
    linha("Atividades", vaga.atividades),
    linha("Descrição", vaga.descricao),
    linha("Requisitos", vaga.requisitos),
    linha("Escolaridade exigida", vaga.escolaridade),
    linha("Carga horária", vaga.cargaHoraria),
    linha("Horário", vaga.horario),
    linha("Tipo", vaga.tipo),
  ].join("\n");
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const convertido = typeof valor === "number" ? valor : Number(String(valor).trim().replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}

/**
 * Lê a resposta no formato simplificado do nó JEV (o único confirmado). Score fora da escala, confiança fora de 0–1
 * ou campo ausente invalidam a resposta: nada é corrigido nem completado.
 */
export function interpretarRespostaJev(bruto: unknown, pergunta: PerguntaScore = PERGUNTA_COMPATIBILIDADE): AvaliacaoJev {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new RespostaJevInvalida("Resposta do JEV vazia ou fora do formato.");
  const dados = bruto as Record<string, unknown>;
  const escala = escalaDa(pergunta);
  const score = numero(dados[pergunta.id]);
  if (score === null) throw new RespostaJevInvalida("O JEV não devolveu score numérico.");
  if (score < escala.min - 1e-9 || score > escala.max + 1e-9) throw new RespostaJevInvalida(`Score ${score} fora da escala ${escala.min}–${escala.max}.`);
  const confianca = numero(dados[`${pergunta.id}_confidence`]);
  if (confianca !== null && (confianca < 0 || confianca > 1)) throw new RespostaJevInvalida("Confiança do JEV fora de 0–1.");
  const nivelBruto = typeof dados[`${pergunta.id}_level`] === "string" ? String(dados[`${pergunta.id}_level`]).trim() : "";
  const nivel = nivelBruto.split(":")[0]?.trim() || null;
  const descricaoNivel = nivel
    ? pergunta.scoreLevels.find((item) => item.split(":")[0].trim().toLowerCase() === nivel.toLowerCase())?.split(":").slice(1).join(":").trim() ?? null
    : null;
  const modelo = typeof dados._model === "string" && dados._model.trim() ? dados._model.trim() : null;
  // O formato confirmado não traz justificativa, evidências nem lacunas. Ficam vazios até a documentação dizer onde estão.
  return { score, escala, confianca, nivel, descricaoNivel, modelo, justificativa: null, evidencias: [], lacunas: [] };
}

/** Transporte até a API do JEV. Deve devolver a resposta no formato simplificado (ver interpretarRespostaJev). */
export type TransporteJev = (requisicao: RequisicaoJev, signal: AbortSignal) => Promise<unknown>;

export type EstadoJev = { pronto: true; transporte: TransporteJev } | { pronto: false; motivo: string };

/**
 * Sem URL e chave, o JEV fica "não configurado". Com URL e chave, continua pendente até a documentação
 * da API (endpoint, autenticação e formato bruto) ser confirmada: não há chamada inventada.
 */
export function criarTransporteJev(config: { JEV_API_URL: string; JEV_API_KEY: string }): EstadoJev {
  if (!config.JEV_API_URL || !config.JEV_API_KEY) {
    return { pronto: false, motivo: "JEV não configurado: defina JEV_API_URL e JEV_API_KEY." };
  }
  return { pronto: false, motivo: "JEV pendente: o contrato HTTP da API ainda não foi confirmado com a documentação." };
}
