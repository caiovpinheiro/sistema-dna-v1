import type { VagaParaJev } from "./jev.js";

/**
 * Explicação montada pelo DNA Work, separada do JEV: compara, linha a linha, as atividades e os requisitos da vaga
 * com os termos do currículo revisado. Não é o motivo do score e não pesa no score.
 */
export const ORIGEM_EXPLICACAO = "dna_work_comparacao_textual" as const;
export const AVISO_EXPLICACAO = "Comparação de termos feita pelo DNA Work entre a vaga e o currículo. Não é o motivo do score do JEV.";

export type Explicacao = {
  origem: typeof ORIGEM_EXPLICACAO;
  aviso: string;
  /** Linhas da vaga com termos que também aparecem no currículo. */
  favoraveis: Array<{ trecho: string; termos: string[] }>;
  /** Linhas da vaga sem nenhum termo encontrado no currículo. */
  naoComprovados: string[];
  notas: string[];
};

const PALAVRAS_VAZIAS = new Set([
  "para", "pelo", "pela", "pelos", "pelas", "como", "com", "sem", "sobre", "entre", "quando", "sempre", "mais", "menos", "muito",
  "muita", "estar", "esta", "este", "isso", "essa", "esse", "seus", "suas", "dele", "dela", "onde", "todos", "todas", "cada",
  "outro", "outra", "outros", "outras", "realizar", "garantir", "manter", "fazer", "ser", "ter", "dia", "dias", "boa", "bom",
  "necessario", "necessaria", "desejavel", "diferencial", "experiencia", "conhecimento", "conhecimentos", "atividades",
  "vaga", "empresa", "area", "geral", "apoio", "apoiar", "rotina", "rotinas", "nenhum", "nenhuma", "evitando", "conforme",
]);

const PREFIXO = 5;

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Palavras significativas com o radical (cinco letras), para "atendimento" casar com "atendente". */
export function termos(texto: string): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const original of texto.split(/[^\p{L}\p{N}]+/u)) {
    const palavra = semAcento(original);
    if (palavra.length < PREFIXO || PALAVRAS_VAZIAS.has(palavra) || /^\d+$/.test(palavra)) continue;
    const radical = palavra.slice(0, PREFIXO);
    if (!mapa.has(radical)) mapa.set(radical, original.toLowerCase());
  }
  return mapa;
}

/** Linhas de atividades/requisitos: separa por quebra, marcador ou ponto e vírgula. */
export function linhasDe(texto: string | null, limite = 12): string[] {
  return String(texto ?? "")
    .split(/\n|;|•|(?:^|\s)-\s/)
    .map((item) => item.replace(/^[\s\-–•*·]+/, "").replace(/[\s.]+$/, "").trim())
    .filter((item) => item.length >= 8)
    .slice(0, limite);
}

export function explicarCompatibilidade(curriculo: string, vaga: VagaParaJev): Explicacao {
  const doCurriculo = termos(curriculo);
  const favoraveis: Explicacao["favoraveis"] = [];
  const naoComprovados: string[] = [];
  const vistas = new Set<string>();
  for (const trecho of [...linhasDe(vaga.atividades), ...linhasDe(vaga.requisitos)]) {
    const chave = semAcento(trecho);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const encontrados = [...termos(trecho)].filter(([radical]) => doCurriculo.has(radical)).map(([, palavra]) => palavra);
    if (encontrados.length) favoraveis.push({ trecho, termos: encontrados.slice(0, 6) });
    else naoComprovados.push(trecho);
  }
  const notas: string[] = [];
  if (vaga.escolaridade && !/escolaridade|forma[cç][aã]o|ensino|gradua|t[eé]cnico|superior|m[eé]dio|fundamental/i.test(curriculo)) {
    notas.push(`Escolaridade exigida (${vaga.escolaridade}) não aparece no currículo.`);
  }
  if (!favoraveis.length && !naoComprovados.length) notas.push("A vaga não tem atividades ou requisitos detalhados para comparar.");
  return { origem: ORIGEM_EXPLICACAO, aviso: AVISO_EXPLICACAO, favoraveis, naoComprovados, notas };
}
