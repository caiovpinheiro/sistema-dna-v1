import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync(new URL("../.github/workflows/deploy-independente.yml", import.meta.url), "utf8");
const ci = readFileSync(new URL("../.github/workflows/mcp-ci.yml", import.meta.url), "utf8");

function blocos(texto) {
  const jobs = texto.slice(texto.indexOf("\njobs:\n") + 7);
  return jobs.split(/\n(?=  [a-z0-9-]+:\n)/).map((b) => ({ nome: b.trim().split(":")[0], texto: b }));
}

test("nenhum job de deploy roda fora da main, sem aprovação (environment) ou sem o modo simular", () => {
  for (const nome of ["imagem-mcp", "deploy-monolito", "deploy-mcp", "registrar"]) {
    const b = blocos(deploy).find((x) => x.nome === nome);
    assert.ok(b, nome);
    assert.match(b.texto, /github\.ref == 'refs\/heads\/main'/, `${nome} sem guarda de branch`);
    assert.match(b.texto, /inputs\.simular != true/, `${nome} sem modo simular`);
  }
  for (const nome of ["deploy-monolito", "deploy-mcp"]) {
    const b = blocos(deploy).find((x) => x.nome === nome);
    assert.match(b.texto, /environment: producao-/, `${nome} sem Environment de aprovação`);
  }
});

test("o push só dispara na main e o deploy automático do MCP depende de uma variável (desligada por padrão)", () => {
  assert.match(deploy, /push:\n    branches: \[main\]/);
  assert.match(deploy, /MCP_DEPLOY_AUTOMATICO \|\| 'false'/);
  assert.match(deploy, /dm=false; motivo="push na main"/);
});

test("fila única de produção, sem cancelar deploy em andamento", () => {
  assert.match(deploy, /concurrency:\n  group: deploy-producao\n  cancel-in-progress: false/);
});

test("ordem segura: o MCP só implanta depois do monólito (ou com ele ignorado), nunca se o monólito falhou", () => {
  const b = blocos(deploy).find((x) => x.nome === "deploy-mcp");
  assert.match(b.texto, /needs: \[plano, testes, imagem-mcp, deploy-monolito\]/);
  assert.match(b.texto, /needs\.deploy-monolito\.result == 'success' \|\| needs\.deploy-monolito\.result == 'skipped'/);
});

test("webhooks e URLs só em secrets/variáveis; nada embutido", () => {
  for (const t of [deploy, ci]) {
    assert.ok(!/https?:\/\/[^\s"'$]*(easypanel|webhook|\/api\/deploy)/i.test(t), "URL de webhook embutida");
  }
  assert.match(deploy, /secrets\.WEBHOOK_DEPLOY_SISTEMA_DNA/);
  assert.match(deploy, /secrets\.WEBHOOK_DEPLOY_MCP_SERVER/);
});

test("o CI nunca implanta nem publica: sem webhook, sem login em registry, sem push de imagem", () => {
  assert.ok(!/WEBHOOK|docker\/login-action|push: true|environment:/.test(ci));
  assert.match(ci, /permissions:\n  contents: read/);
});

test("o deploy.yml existente continua o mesmo (build do monólito e webhook)", () => {
  const d = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(d, /WEBHOOK_DEPLOY_SISTEMA_DNA/);
  assert.match(d, /context: \./);
});
