import assert from "node:assert/strict";
import test from "node:test";
import { converter } from "./conhecimento-markdown.mjs";

test("Markdown com cabeçalho vira um item de importação (rascunho)", () => {
  const md = "---\nid: exemplo-ficticio\ntitulo: \"Exemplo fictício\"\ncategoria: perguntas-frequentes\nmodulo: triagem\ntags: [exemplo, teste]\npalavras_chave: distância, deslocamento\nfonte: Equipe\n---\n# Título\n\nTexto.";
  const r = converter(md, "a.md");
  assert.equal(r.id, "exemplo-ficticio");
  assert.deepEqual(r.meta, { categoria: "perguntas-frequentes", modulo: "triagem" });
  assert.deepEqual(r.conteudo.tags, ["exemplo", "teste"]);
  assert.deepEqual(r.conteudo.palavras_chave, ["distância", "deslocamento"]);
  assert.equal(r.conteudo.conteudo, "# Título\n\nTexto.");
});

test("sem cabeçalho ou sem campo obrigatório: erro com o nome do arquivo", () => {
  assert.throws(() => converter("# só texto", "b.md"), /b\.md/);
  assert.throws(() => converter("---\nid: x-y\n---\ntexto", "c.md"), /titulo/);
});
