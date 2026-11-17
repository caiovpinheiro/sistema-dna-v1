/**
 * Pesquisa inteligente das listas: cada palavra digitada precisa aparecer em algum dos campos,
 * em qualquer ordem, sem diferenciar acento e maiúscula ("parana itaco" acha "Paraná Supermercados -
 * Jardim Itacolomi"). Uma palavra só de números também vale contra os dígitos de CNPJ, CPF ou telefone,
 * com ou sem pontuação ("17580852" acha "17.580.852/0001-06").
 *
 * As palavras vão num único parâmetro text[], então a condição cabe tanto nas consultas montadas com
 * `add` quanto nas consultas do legado, que usam parâmetros fixos ($1, $2…).
 * Não precisa da extensão unaccent: o acento sai com translate().
 */

const COM_ACENTO = "áàâãäåéèêëíìîïóòôõöúùûüçñýÿ";
const SEM_ACENTO = "aaaaaaeeeeiiiiooooouuuucnyy";

export function semAcento(valor: string) {
  return valor.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function escaparLike(valor: string) {
  return valor.replace(/[\\%_]/g, (letra) => `\\${letra}`);
}

/**
 * Palavras da busca, já sem acento, em minúsculas e escapadas para LIKE. Texto só com números e
 * pontuação de documento ("17.580.852/0001-06", "(11) 98765-4321") vira uma palavra só com os dígitos.
 */
export function palavrasDaBusca(texto: string | null | undefined): string[] {
  const limpo = String(texto ?? "").trim();
  if (!limpo) return [];
  if (/^[\d\s.\-/()+]+$/.test(limpo)) {
    const digitos = limpo.replace(/\D/g, "");
    return digitos ? [digitos] : [];
  }
  const palavras = semAcento(limpo)
    .split(/[\s,;|/]+/)
    .map((palavra) => palavra.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  return [...new Set(palavras)].slice(0, 8).map(escaparLike);
}

/** Expressão SQL do texto sem acento e em minúsculas. */
export function textoSemAcentoSql(expressao: string) {
  return `translate(lower(coalesce((${expressao})::text, '')), '${COM_ACENTO}', '${SEM_ACENTO}')`;
}

/**
 * Condição SQL: toda palavra do parâmetro `parametro` (text[] de palavrasDaBusca) aparece em algum
 * dos `campos`; palavra só de números também vale contra os dígitos de `camposDigitos`.
 * Lista vazia passa tudo (sem busca).
 */
export function condicaoPorPalavras(campos: string[], parametro: string, camposDigitos: string[] = []) {
  const alvo = textoSemAcentoSql(`concat_ws(' ', ${campos.join(", ")})`);
  const digitos = camposDigitos.length
    ? ` OR (w.p ~ '^[0-9]+$' AND (${camposDigitos.map((campo) => `regexp_replace(coalesce((${campo})::text, ''), '\\D', '', 'g') LIKE '%' || w.p || '%'`).join(" OR ")}))`
    : "";
  return `(coalesce(cardinality(${parametro}::text[]), 0) = 0 OR NOT EXISTS (
    SELECT 1 FROM unnest(${parametro}::text[]) AS w(p)
    WHERE NOT (${alvo} LIKE '%' || w.p || '%'${digitos})
  ))`;
}
