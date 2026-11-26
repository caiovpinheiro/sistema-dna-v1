import assert from "node:assert/strict";
import test from "node:test";
import { analisar, hrefSeguro, trechos } from "../src/lib/markdown.ts";

test("HTML e scripts viram texto; nenhum nó de HTML cru é produzido", () => {
  const b = analisar("Oi <script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.equal(b.length, 1);
  assert.deepEqual(b[0], { tipo: "paragrafo", trechos: [{ tipo: "texto", texto: "Oi <script>alert(1)</script> <img src=x onerror=alert(1)>" }] });
});

test("links: só http(s) e mailto; javascript:, data: e vbscript: viram texto", () => {
  assert.equal(hrefSeguro("javascript:alert(1)"), null);
  assert.equal(hrefSeguro(" JaVaScRiPt:alert(1)"), null);
  assert.equal(hrefSeguro("data:text/html,<script>"), null);
  assert.equal(hrefSeguro("vbscript:x"), null);
  assert.equal(hrefSeguro("/caminho-relativo"), null);
  assert.equal(hrefSeguro("https://dnawork.ai/x"), "https://dnawork.ai/x");
  assert.equal(hrefSeguro("mailto:contato@exemplo.com"), "mailto:contato@exemplo.com");
  assert.ok(trechos("[clique](javascript:alert(1))").every((x) => x.tipo === "texto"), "nenhum link perigoso");
  assert.ok(trechos("[x](data:text/html;base64,PHNjcmlwdD4=)").every((x) => x.tipo === "texto"));
  const ok = trechos("[site](https://exemplo.com)");
  assert.equal(ok[0].tipo, "link");
});

test("estrutura: títulos, listas, citação, código e ênfases", () => {
  const b = analisar("# Título\n\n- um\n- **dois**\n\n1. a\n2. b\n\n> citação\n\n```\n<b>cru</b>\n```\n\nTexto com *ênfase* e `código`.");
  assert.deepEqual(b.map((x) => x.tipo), ["titulo", "lista", "lista", "citacao", "codigo", "paragrafo"]);
  assert.equal((b[4] as { texto: string }).texto, "<b>cru</b>");
});

test("entrada gigante é limitada", () => {
  assert.ok(analisar("a".repeat(300_000)).length === 1);
});
