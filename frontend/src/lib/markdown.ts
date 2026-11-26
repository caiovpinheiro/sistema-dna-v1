/**
 * Markdown seguro para a base de conhecimento: o texto vira uma árvore de blocos e trechos, e a tela monta
 * elementos React a partir dela. Nunca há HTML cru nem dangerouslySetInnerHTML: `<script>`, `<img onerror>`
 * etc. aparecem como texto. Links só com http(s) ou mailto; qualquer outro esquema (javascript:, data:) vira texto.
 */
export type Trecho =
  | { tipo: "texto"; texto: string }
  | { tipo: "negrito"; filhos: Trecho[] }
  | { tipo: "italico"; filhos: Trecho[] }
  | { tipo: "codigo"; texto: string }
  | { tipo: "link"; href: string; filhos: Trecho[] };

export type Bloco =
  | { tipo: "titulo"; nivel: 1 | 2 | 3 | 4; trechos: Trecho[] }
  | { tipo: "paragrafo"; trechos: Trecho[] }
  | { tipo: "lista"; ordenada: boolean; itens: Trecho[][] }
  | { tipo: "citacao"; trechos: Trecho[] }
  | { tipo: "codigo"; texto: string }
  | { tipo: "linha" };

const LIMITE = 100_000;

export function hrefSeguro(href: string): string | null {
  const h = href.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  try {
    const u = new URL(h);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function trechos(texto: string, profundidade = 0): Trecho[] {
  if (profundidade > 4) return [{ tipo: "texto", texto }];
  const saida: Trecho[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/;
  let resto = texto;
  while (resto) {
    const m = re.exec(resto);
    if (!m) { saida.push({ tipo: "texto", texto: resto }); break; }
    if (m.index > 0) saida.push({ tipo: "texto", texto: resto.slice(0, m.index) });
    const t = m[0];
    if (m[1]) saida.push({ tipo: "codigo", texto: t.slice(1, -1) });
    else if (m[2]) saida.push({ tipo: "negrito", filhos: trechos(t.slice(2, -2), profundidade + 1) });
    else if (m[3]) saida.push({ tipo: "italico", filhos: trechos(t.slice(1, -1), profundidade + 1) });
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const href = hrefSeguro(lm[2]);
      saida.push(href ? { tipo: "link", href, filhos: trechos(lm[1], profundidade + 1) } : { tipo: "texto", texto: lm[1] });
    }
    resto = resto.slice(m.index + t.length);
  }
  return saida;
}

export function analisar(md: string): Bloco[] {
  const linhas = md.slice(0, LIMITE).replace(/\r\n?/g, "\n").split("\n");
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (!l.trim()) { i++; continue; }
    if (l.trim().startsWith("```")) {
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i].trim().startsWith("```")) corpo.push(linhas[i++]);
      i++;
      blocos.push({ tipo: "codigo", texto: corpo.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { blocos.push({ tipo: "titulo", nivel: h[1].length as 1 | 2 | 3 | 4, trechos: trechos(h[2].trim()) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { blocos.push({ tipo: "linha" }); i++; continue; }
    if (/^\s*>/.test(l)) {
      const corpo: string[] = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) corpo.push(linhas[i++].replace(/^\s*>\s?/, ""));
      blocos.push({ tipo: "citacao", trechos: trechos(corpo.join(" ")) });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+/;
    if (li.test(l)) {
      const ordenada = /^\s*\d/.test(l);
      const itens: Trecho[][] = [];
      while (i < linhas.length && li.test(linhas[i])) itens.push(trechos(linhas[i++].replace(li, "")));
      blocos.push({ tipo: "lista", ordenada, itens });
      continue;
    }
    const corpo: string[] = [];
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,4})\s|^\s*>|^\s*([-*+]|\d+[.)])\s+|^\s*```/.test(linhas[i])) corpo.push(linhas[i++].trim());
    blocos.push({ tipo: "paragrafo", trechos: trechos(corpo.join(" ")) });
  }
  return blocos;
}
