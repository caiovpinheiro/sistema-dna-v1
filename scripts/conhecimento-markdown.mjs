// Converte arquivos Markdown com cabeçalho (front matter) no JSON de importação da base de conhecimento.
// Uso: node scripts/conhecimento-markdown.mjs pasta/ > importacao.json
// O JSON resultante vai para POST /api/v1/configuracoes/conhecimento/importar ({ simular: true } primeiro).
// Tudo entra como RASCUNHO: nada é publicado pela importação. Formato em docs/mcp/conhecimento.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const LISTA = new Set(["tags", "palavras_chave", "acesso_paginas"]);

export function converter(texto, nomeArquivo = "") {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(texto);
  if (!m) throw new Error(`${nomeArquivo}: falta o cabeçalho entre linhas ---`);
  const campos = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const c = /^([a-z_]+):\s*(.*)$/.exec(linha.trim());
    if (!c) continue;
    const valor = c[2].trim().replace(/^"(.*)"$/, "$1");
    campos[c[1]] = LISTA.has(c[1]) ? valor.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean) : valor;
  }
  for (const obrigatorio of ["id", "titulo", "categoria"]) if (!campos[obrigatorio]) throw new Error(`${nomeArquivo}: campo obrigatório ausente: ${obrigatorio}`);
  return {
    id: campos.id,
    meta: { categoria: campos.categoria, ...(campos.modulo ? { modulo: campos.modulo } : {}), ...(campos.revisar_em ? { revisar_em: campos.revisar_em } : {}), ...(campos.acesso_paginas ? { acesso_paginas: campos.acesso_paginas } : {}), ...(campos.somente_admin === "true" ? { somente_admin: true } : {}) },
    conteudo: {
      titulo: campos.titulo, conteudo: m[2].trim(),
      ...(campos.resumo ? { resumo: campos.resumo } : {}), ...(campos.tags ? { tags: campos.tags } : {}), ...(campos.palavras_chave ? { palavras_chave: campos.palavras_chave } : {}),
      ...(campos.referencia ? { referencia: campos.referencia } : {}), ...(campos.fonte ? { fonte: campos.fonte } : {}),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pasta = process.argv[2];
  if (!pasta || !statSync(pasta).isDirectory()) { console.error("Uso: node scripts/conhecimento-markdown.mjs <pasta-com-arquivos-md>"); process.exit(1); }
  const artigos = readdirSync(pasta).filter((n) => n.endsWith(".md")).sort().map((n) => converter(readFileSync(path.join(pasta, n), "utf8"), n));
  process.stdout.write(`${JSON.stringify({ simular: true, artigos }, null, 2)}\n`);
}
