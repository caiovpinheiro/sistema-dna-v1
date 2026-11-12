/**
 * Integração com o JEV (TypeSafe), a mesma avaliação do nó Jev do workflow "enviar vagas automaticas".
 *
 * Contrato (OpenAPI oficial, https://docs.typesafe.ai/api/system-one):
 *   POST {JEV_API_URL}/v1/systemone   Authorization: Bearer <JEV_API_KEY>
 *   { model, state, questions: { <nome>: { type: "score", instructions, criteria: [nível 0, nível 1, …] } } }
 *   → { model, answers: { <nome>: { type: "score", score, confidence, legend: {"0": …}, probabilities: {"0": …} } }, usage }
 *
 * O score é a média dos níveis ponderada pelas probabilidades (escala 0 a N-1, não é percentual).
 * A API não devolve nível nem justificativa: o nível mostrado é o de maior probabilidade na resposta do próprio JEV.
 */

export type PerguntaScore = {
  id: string;
  type: "score";
  instructions: string;
  /** Um nível por item, do mais baixo ao mais alto. O primeiro é o nível 0. */
  scoreLevels: string[];
};

/** Mesma pergunta e mesma régua do nó Jev no n8n. */
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
  /** Nome do nível de maior probabilidade ("Moderada"). */
  nivel: string | null;
  /** Descrição desse nível na régua enviada. É a régua, não um motivo escrito pelo JEV. */
  descricaoNivel: string | null;
  /** Probabilidade do nível mostrado (0 a 1). */
  probabilidadeNivel: number | null;
  /** Probabilidade de cada nível, como o JEV devolveu. */
  probabilidades: Record<string, number> | null;
  /** Descrição de cada nível ("0": "Muito baixa: …"), da legend do JEV ou, sem ela, da régua enviada. */
  legenda: Record<string, string>;
  modelo: string | null;
  /** A API não devolve texto próprio: ficam vazios e a tela diz isso. */
  justificativa: null;
  evidencias: string[];
  lacunas: string[];
};

export class RespostaJevInvalida extends Error {}

/** Erro da chamada ao JEV com mensagem segura para a tela (sem estado, sem chave). */
export class ErroJev extends Error {
  constructor(message: string, readonly status: number | null, readonly temporario: boolean) {
    super(message);
  }
}

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

/** Corpo do POST /v1/systemone. */
export function corpoSystemOne(requisicao: RequisicaoJev) {
  return {
    model: requisicao.modelo,
    state: requisicao.estado,
    questions: Object.fromEntries(requisicao.perguntas.map((pergunta) => [
      pergunta.id,
      { type: pergunta.type, instructions: pergunta.instructions, criteria: pergunta.scoreLevels },
    ])),
  };
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const convertido = typeof valor === "number" ? valor : Number(String(valor).trim().replace(",", "."));
  return Number.isFinite(convertido) ? convertido : null;
}

function lerProbabilidades(valor: unknown, niveis: number): Record<string, number> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const saida: Record<string, number> = {};
  for (let nivel = 0; nivel < niveis; nivel += 1) {
    const p = numero((valor as Record<string, unknown>)[String(nivel)]);
    if (p === null || p < 0 || p > 1) return null;
    saida[String(nivel)] = p;
  }
  const soma = Object.values(saida).reduce((total, p) => total + p, 0);
  return Math.abs(soma - 1) <= 0.02 ? saida : null;
}

/**
 * Lê a resposta do /v1/systemone. Score fora da escala, confiança fora de 0–1, pergunta ausente ou de outro tipo
 * invalidam a resposta: nada é corrigido nem completado.
 */
export function interpretarRespostaJev(bruto: unknown, pergunta: PerguntaScore = PERGUNTA_COMPATIBILIDADE): AvaliacaoJev {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new RespostaJevInvalida("Resposta do JEV vazia ou fora do formato.");
  const corpo = bruto as { model?: unknown; answers?: Record<string, unknown> };
  const resposta = corpo.answers && typeof corpo.answers === "object" ? corpo.answers[pergunta.id] as Record<string, unknown> | undefined : undefined;
  if (!resposta || typeof resposta !== "object") throw new RespostaJevInvalida("O JEV não respondeu a pergunta de compatibilidade.");
  if (resposta.type !== undefined && resposta.type !== "score") throw new RespostaJevInvalida("O JEV respondeu com outro tipo de resposta.");
  const escala = escalaDa(pergunta);
  const score = numero(resposta.score);
  if (score === null) throw new RespostaJevInvalida("O JEV não devolveu score numérico.");
  if (score < escala.min - 1e-9 || score > escala.max + 1e-9) throw new RespostaJevInvalida(`Score ${score} fora da escala ${escala.min}–${escala.max}.`);
  const confianca = numero(resposta.confidence);
  if (confianca !== null && (confianca < 0 || confianca > 1)) throw new RespostaJevInvalida("Confiança do JEV fora de 0–1.");

  const probabilidades = lerProbabilidades(resposta.probabilities, pergunta.scoreLevels.length);
  const legendaBruta = resposta.legend && typeof resposta.legend === "object" ? resposta.legend as Record<string, unknown> : {};
  const legenda = Object.fromEntries(pergunta.scoreLevels.map((nivel, indice) => {
    const texto = legendaBruta[String(indice)];
    return [String(indice), typeof texto === "string" && texto.trim() ? texto.trim() : nivel];
  }));
  let nivel: string | null = null;
  let descricaoNivel: string | null = null;
  let probabilidadeNivel: number | null = null;
  if (probabilidades) {
    const [indice, p] = Object.entries(probabilidades).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];
    const [nome, ...resto] = legenda[indice].split(":");
    nivel = nome.trim() || null;
    descricaoNivel = resto.join(":").trim() || null;
    probabilidadeNivel = p;
  }
  return {
    score,
    escala,
    confianca,
    nivel,
    descricaoNivel,
    probabilidadeNivel,
    probabilidades,
    legenda,
    modelo: typeof corpo.model === "string" && corpo.model.trim() ? corpo.model.trim() : null,
    justificativa: null,
    evidencias: [],
    lacunas: [],
  };
}

/** Transporte até a API do JEV. Devolve o corpo bruto da resposta, lido depois por interpretarRespostaJev. */
export type TransporteJev = (requisicao: RequisicaoJev, signal: AbortSignal) => Promise<unknown>;

export type EstadoJev = { pronto: true; transporte: TransporteJev } | { pronto: false; motivo: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const espera = (ms: number, signal: AbortSignal) => new Promise<void>((resolver, rejeitar) => {
  if (signal.aborted) return rejeitar(signal.reason);
  const timer = setTimeout(resolver, ms);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    rejeitar(signal.reason);
  }, { once: true });
});

function erroDoStatus(status: number): ErroJev {
  if (status === 401 || status === 403) return new ErroJev("O JEV recusou a chave configurada.", status, false);
  if (status === 429) return new ErroJev("Limite de uso do JEV atingido. Tente em instantes.", status, true);
  if (status === 400 || status === 422) return new ErroJev(`O JEV recusou a requisição (${status}).`, status, false);
  return new ErroJev(`O JEV respondeu com erro (${status}).`, status, status >= 500);
}

/**
 * Chamada real ao POST /v1/systemone. Repete até duas vezes em 429, 529 e 503, como o nó do n8n faz com limite e
 * sobrecarga; o timeout de cada vaga (no serviço de matching) cancela também as esperas.
 */
export function criarTransporteJev(
  config: { JEV_API_URL: string; JEV_API_KEY: string },
  fetcher: FetchLike = fetch,
  esperasMs: number[] = [1_000, 2_000],
): EstadoJev {
  if (!config.JEV_API_URL || !config.JEV_API_KEY) {
    return { pronto: false, motivo: "JEV não configurado: defina JEV_API_URL e JEV_API_KEY." };
  }
  const url = `${config.JEV_API_URL.replace(/\/+$/, "").replace(/\/v1(\/systemone)?$/, "")}/v1/systemone`;
  const transporte: TransporteJev = async (requisicao, signal) => {
    for (let tentativa = 0; ; tentativa += 1) {
      let resposta: Response;
      try {
        resposta = await fetcher(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.JEV_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(corpoSystemOne(requisicao)),
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new ErroJev("Não foi possível falar com o JEV.", null, true);
      }
      if (resposta.ok) {
        try {
          return await resposta.json();
        } catch {
          throw new RespostaJevInvalida("O JEV respondeu sem JSON válido.");
        }
      }
      const repetir = [429, 503, 529].includes(resposta.status) && tentativa < esperasMs.length;
      if (!repetir) throw erroDoStatus(resposta.status);
      await espera(esperasMs[tentativa], signal);
    }
  };
  return { pronto: true, transporte };
}
