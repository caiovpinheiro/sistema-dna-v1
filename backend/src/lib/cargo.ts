const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Chave de comparação: sem acento, minúsculas, pontuação vira espaço, espaços simples. */
export function chaveCargo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Operador De Loja" → "Operador de Loja"; "Açougueiro:" → "Açougueiro". Mantém os acentos. */
export function nomePadronizado(nome: string): string {
  return nome
    .replace(/[\s\p{P}]+$/u, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((palavra, indice) => {
      const minuscula = palavra.toLocaleLowerCase("pt-BR");
      if (indice > 0 && MINUSCULAS.has(minuscula)) return minuscula;
      return minuscula.charAt(0).toLocaleUpperCase("pt-BR") + minuscula.slice(1);
    })
    .join(" ");
}
