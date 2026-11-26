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
  assert.match(b.texto, /needs: \[plano, testes, imagem-mcp, deploy-monolito, aguardar-monolito\]/);
  assert.match(b.texto, /needs\.aguardar-monolito\.result == 'success' \|\| needs\.aguardar-monolito\.result == 'skipped'/);
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

test("um dono por componente: o webhook do monólito só dispara quando este workflow é o dono; senão ele apenas espera o deploy.yml", () => {
  assert.match(deploy, /MONOLITO_DEPLOY_DONO \|\| 'deploy\.yml'/);
  assert.match(deploy, /if \[ "\$dm" = "true" \] && \[ "\$DONO" != "deploy-independente" \]; then esperar=true; dm_aqui=false/);
  const espera = blocos(deploy).find((x) => x.nome === "aguardar-monolito");
  assert.ok(espera, "falta o job que espera o deploy.yml");
  assert.ok(!/WEBHOOK/.test(espera.texto), "o job de espera não pode disparar webhook");
  assert.match(espera.texto, /--workflow deploy\.yml --commit/);
  // O webhook do monólito aparece uma única vez, dentro do job deploy-monolito.
  assert.equal((deploy.match(/secrets\.WEBHOOK_DEPLOY_SISTEMA_DNA/g) ?? []).length, 1);
  assert.match(blocos(deploy).find((x) => x.nome === "deploy-monolito").texto, /WEBHOOK_DEPLOY_SISTEMA_DNA/);
  // O alvo "monolito" manual é recusado enquanto o dono for o deploy.yml.
  assert.match(deploy, /O deploy do monólito pertence ao deploy\.yml/);
});

test("CI imprime o resumo das falhas do monólito", () => {
  assert.match(ci, /Resumo das falhas do monólito/);
  assert.match(ci, /GITHUB_STEP_SUMMARY/);
});

test("deploy.yml (monólito) ignora push que mexe só no gateway MCP: serviços independentes", () => {
  const legado = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const ignorados = legado.match(/paths-ignore:\n((?:\s+- .*\n)+)/)?.[1] ?? "";
  assert.match(ignorados, /"mcp-server\/\*\*"/);
  assert.doesNotMatch(legado, /\n    paths:\n/, "paths (permissivo) junto com paths-ignore não é permitido");
  // O que o monólito precisa para construir nunca pode estar na lista de ignorados.
  for (const necessario of ["backend/", "frontend/", "prisma/", "templates/", "Dockerfile", "package.json", "docker-entrypoint.sh", "scripts/migrate-production.mjs"]) {
    assert.ok(!ignorados.includes(necessario), `${necessario} não pode ser ignorado`);
  }
});
