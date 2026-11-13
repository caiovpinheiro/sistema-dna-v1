import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { IDS_PAGINA, PAGINAS, paginasDaApi } from "../src/lib/paginas.js";

test("o Disparador aparece nas Configurações para liberar por usuário", () => {
  const pagina = PAGINAS.find((item) => item.id === "disparador");
  assert.deepEqual(pagina, { id: "disparador", nome: "Disparador Infojobs", grupo: "Geral" });
  assert.equal(IDS_PAGINA.has("disparador"), true);
  // Link externo: não protege nenhuma rota da API.
  assert.deepEqual(paginasDaApi("/api/v1/disparador"), []);
});

test("quem já usava o sistema continua vendo o Disparador depois da troca", () => {
  const pasta = new URL("../../prisma/migrations/", import.meta.url);
  const migracao = readdirSync(pasta).find((nome) => nome.endsWith("_pagina_disparador"));
  assert.ok(migracao, "falta a migration que libera o Disparador para os usuários atuais");
  const sql = readFileSync(new URL(`${migracao}/migration.sql`, pasta), "utf8");
  assert.match(sql, /INSERT INTO dna_work\.app_usuario_pagina/);
  assert.match(sql, /'disparador'/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
});

test("o menu só mostra o Disparador para quem tem a página", () => {
  const shell = readFileSync(new URL("../../frontend/src/components/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /permitido\("disparador"\) \? \(\s*<a href=\{DISPARADOR_URL\}/);
});
