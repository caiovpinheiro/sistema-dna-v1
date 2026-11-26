import assert from "node:assert/strict";
import test from "node:test";
import { classificar } from "./detectar-mudancas.mjs";

const c = (...a) => classificar(a);

test("alteração só em mcp-server/src: testa e implanta só o MCP", () => {
  const r = c("mcp-server/src/app.ts", "mcp-server/package.json");
  assert.deepEqual([r.deploy_mcp, r.deploy_monolito, r.testar_mcp, r.testar_monolito, r.ordem], [true, false, true, false, "somente-mcp"]);
});

test("testes, scripts e docs do MCP: testam, mas não implantam nada", () => {
  const r = c("mcp-server/test/e2e-protocolo.test.ts", "mcp-server/scripts/mtls-pki.sh", "docs/mcp/README.md");
  assert.deepEqual([r.deploy_mcp, r.deploy_monolito, r.testar_mcp, r.ordem], [false, false, true, "nenhum"]);
});

test("alteração só no monólito (backend/frontend/prisma/Dockerfile): implanta só o monólito", () => {
  for (const arq of ["backend/src/services/vaga.service.ts", "frontend/src/pages/VagasPage.tsx", "Dockerfile", "package-lock.json", "prisma/migrations/20270101_x/migration.sql", "backend/src/mcp/politica.ts"]) {
    const r = c(arq);
    assert.deepEqual([r.deploy_monolito, r.deploy_mcp, r.ordem], [true, false, "somente-monolito"], arq);
  }
});

test("contrato interno ou assinatura: implanta os dois, monólito primeiro", () => {
  for (const arq of ["backend/src/mcp/assinatura.ts", "mcp-server/src/assinatura.ts", "backend/src/mcp/interno.ts", "mcp-server/src/monolito.ts", "docs/mcp/contrato-interno.md", "backend/src/mcp/tls-interno.ts"]) {
    const r = c(arq);
    assert.deepEqual([r.contrato, r.deploy_monolito, r.deploy_mcp, r.compartilhado, r.ordem], [true, true, true, true, "monolito-depois-mcp"], arq);
    assert.ok(r.testar_monolito && r.testar_mcp);
  }
});

test("migration: monólito (e só ele) antes de qualquer coisa; combinada com MCP mantém a ordem", () => {
  const so = c("prisma/migrations/20270101120000_x/migration.sql");
  assert.deepEqual([so.migracao, so.ordem], [true, "somente-monolito"]);
  const ambos = c("prisma/migrations/20270101120000_x/migration.sql", "mcp-server/src/app.ts");
  assert.deepEqual([ambos.ordem, ambos.compartilhado], ["monolito-depois-mcp", true]);
});

test("só documentação ou workflows: nada para testar nem implantar além do que já roda no CI", () => {
  const r = c("README.md", "docs/agentes/x/agente.md", ".github/workflows/mcp-ci.yml");
  assert.equal(r.somente_docs, true);
  assert.deepEqual([r.deploy_monolito, r.deploy_mcp, r.ordem], [false, false, "nenhum"]);
});
