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

export type CargoOpcao = { id: string; nome: string; chave: string; descricao: string | null; requisitos: string | null };

/** Cargo de um modelo antigo: pelo cargo_id, ou pela chave do texto quando o modelo ainda não tem vínculo. */
export function cargoDoModelo(formulario: { cargo: string; cargo_id: string | null }, cargos: CargoOpcao[]): CargoOpcao | null {
  if (formulario.cargo_id) {
    const porId = cargos.find((cargo) => cargo.id === formulario.cargo_id);
    if (porId) return porId;
  }
  const chave = chaveCargo(formulario.cargo);
  return chave ? cargos.find((cargo) => cargo.chave === chave) ?? null : null;
}
