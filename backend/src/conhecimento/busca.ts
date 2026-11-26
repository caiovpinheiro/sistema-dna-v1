/**
 * Busca da base de conhecimento: PostgreSQL Full Text Search em português, sem acento, com radicais, prefixo
 * (correspondência parcial) e sinônimos operacionais. Tudo que vai para o to_tsquery é reduzido a [a-z0-9]:
 * o texto do usuário nunca vira sintaxe de consulta.
 *
 * Ponto de extensão para busca semântica/híbrida no futuro: `planejarBusca` devolve os termos e a consulta;
 * um segundo ranqueador (ex.: embeddings) pode ser somado ao `ts_rank_cd` sem mudar as ferramentas.
 */

const MARCAS = /[̀-ͯ]/g;

/** Minúsculas e sem acento, preservando o tamanho caractere a caractere (para recortar trechos no texto original). */
export function normalizarMesmoTamanho(texto: string): string {
  let saida = "";
  for (const c of texto) {
    const n = c.normalize("NFD").replace(MARCAS, "").toLowerCase();
    saida += n.length === c.length ? n : c.toLowerCase().slice(0, c.length).padEnd(c.length, " ");
  }
  return saida;
}

export const normalizar = (texto: string) => texto.normalize("NFD").replace(MARCAS, "").toLowerCase();

/** Palavras sem peso para a busca (além das do dicionário do Postgres, que tem acento). */
const VAZIAS = new Set(("a o os as um uma uns umas de da do das dos e em no na nos nas por para pra pro com sem que se ao aos " +
  "como mais mas ou ja esta este essa esse isso isto ele ela eles elas eu voce voces nos me te lhe seu sua seus suas " +
  "foi ser estar tem ter ha causa porque pois quando onde qual quais muito pouco tambem so sobre entre ate apos " +
  "deve devo fazer faco quer querer queria nao sim the of").split(" "));

/**
 * Sinônimos operacionais (grupos). Se um termo da busca pertence a um grupo, todos os do grupo entram como alternativa.
 * Expressões de mais de uma palavra são reconhecidas no texto da busca e viram o conceito do grupo.
 * Lista curta e auditável; pode virar tabela administrável depois.
 */
export const SINONIMOS: ReadonlyArray<ReadonlyArray<string>> = [
  ["distancia", "longe", "deslocamento", "trajeto", "transporte", "locomocao", "conducao", "onibus", "mobilidade", "perto", "km", "quilometro", "quilometros"],
  ["objecao", "objecoes", "recusa", "recusou", "resistencia", "desistencia", "desistiu", "desistir", "receio", "contorno", "contornar", "nao quer", "nao aceita", "nao gostou"],
  ["salario", "remuneracao", "pagamento", "bolsa", "valor", "ganho"],
  ["beneficio", "beneficios", "vale", "refeicao", "alimentacao", "convenio"],
  ["horario", "turno", "escala", "jornada", "expediente", "carga horaria"],
  ["entrevista", "entrevistas", "agendamento", "agendar", "marcar", "reagendar", "remarcar"],
  ["faltou", "falta", "ausencia", "ausente", "nao compareceu", "nao apareceu", "no show"],
  ["estagio", "estagiario", "estagiaria", "tce", "termo de compromisso"],
  ["clt", "carteira assinada", "efetivo", "registro em carteira"],
  ["apresentacao", "apresentar", "oferta", "ofertar", "divulgar", "divulgacao"],
  ["candidato", "candidata", "candidatos", "profissional"],
  ["documento", "documentos", "documentacao"],
  ["mensagem", "mensagens", "whatsapp", "texto", "script", "roteiro"],
  ["contratacao", "contratar", "admissao", "admitir"],
  ["acompanhamento", "acompanhar", "retorno", "feedback", "follow up"],
];

const PALAVRA = /^[a-z0-9]{2,30}$/;

export type PlanoBusca = { conceitos: string[][]; tsquery: string | null; termosTrecho: string[] };

/** Quebra o texto em conceitos (cada conceito = alternativas OR). Máx. 12 conceitos. */
export function planejarBusca(texto: string): PlanoBusca {
  let t = ` ${normalizar(texto).replace(/[^a-z0-9]+/g, " ").trim()} `;
  const conceitos: string[][] = [];
  // 1) expressões de várias palavras
  for (const grupo of SINONIMOS) {
    for (const membro of grupo.filter((m) => m.includes(" "))) {
      if (t.includes(` ${membro} `)) {
        conceitos.push([...grupo]);
        t = t.replaceAll(` ${membro} `, " ");
      }
    }
  }
  // 2) palavras soltas
  for (const palavra of t.split(" ").filter(Boolean)) {
    if (VAZIAS.has(palavra) || !PALAVRA.test(palavra)) continue;
    const grupo = SINONIMOS.find((g) => g.includes(palavra));
    conceitos.push(grupo ? [...grupo] : [palavra]);
  }
  const unicos: string[][] = [];
  for (const c of conceitos) if (!unicos.some((u) => u.join("|") === c.join("|"))) unicos.push(c);
  const lista = unicos.slice(0, 12);
  const alternativa = (termo: string) => termo.split(" ").filter((w) => PALAVRA.test(w)).map((w) => `${w}:*`).join(" & ");
  const partes = lista.map((c) => `(${[...new Set(c.map(alternativa).filter(Boolean))].map((a) => (a.includes("&") ? `(${a})` : a)).join(" | ")})`).filter((p) => p !== "()");
  const termosTrecho = [...new Set(lista.flat().flatMap((m) => m.split(" ")).filter((w) => w.length >= 3 && !VAZIAS.has(w)))];
  return { conceitos: lista, tsquery: partes.length ? partes.join(" | ") : null, termosTrecho };
}

/** Texto plano a partir do Markdown (para trechos): sem marcação, links viram só o texto. */
export function textoPlano(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^[#>\-*+\s]+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Até `maximo` trechos (~220 caracteres) do texto em volta dos termos encontrados. */
export function trechos(md: string, termos: string[], maximo = 2): string[] {
  const texto = textoPlano(md);
  const norm = normalizarMesmoTamanho(texto);
  const achados: number[] = [];
  for (const termo of termos) {
    const raiz = termo.length > 6 ? termo.slice(0, Math.max(5, termo.length - 2)) : termo;
    const re = new RegExp(`(^|[^a-z0-9])${raiz.replace(/[^a-z0-9]/g, "")}`, "g");
    const m = re.exec(norm);
    if (m) achados.push(m.index + m[1].length);
  }
  const saida: string[] = [];
  let ultimo = -1000;
  for (const pos of [...new Set(achados)].sort((a, b) => a - b)) {
    if (saida.length >= maximo) break;
    if (pos - ultimo < 180) continue; // mesmo trecho
    ultimo = pos;
    const ini = Math.max(0, pos - 90);
    const fim = Math.min(texto.length, pos + 130);
    saida.push(`${ini > 0 ? "…" : ""}${texto.slice(ini, fim).trim()}${fim < texto.length ? "…" : ""}`);
  }
  if (!saida.length && texto) saida.push(texto.length > 220 ? `${texto.slice(0, 220).trim()}…` : texto);
  return saida;
}
