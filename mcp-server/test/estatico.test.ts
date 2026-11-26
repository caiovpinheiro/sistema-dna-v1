import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const raiz = path.resolve(import.meta.dirname, "../..");
const gw = path.resolve(import.meta.dirname, "..");

test("o gateway não tem acesso ao banco: nenhuma dependência de PostgreSQL/Prisma, nenhum import de banco, nenhuma DATABASE_URL", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(gw, "package.json"), "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const proibido of ["pg", "pg-pool", "prisma", "@prisma/client", "postgres", "knex", "typeorm", "sequelize", "mysql2", "mongodb"]) assert.ok(!deps.includes(proibido), `dependência proibida: ${proibido}`);
  const lock = fs.readFileSync(path.join(gw, "package-lock.json"), "utf8");
  assert.ok(!/"node_modules\/pg"/.test(lock) && !/"node_modules\/@prisma/.test(lock), "driver de banco no lockfile do gateway");
  for (const arq of fs.readdirSync(path.join(gw, "src")).filter((f) => f.endsWith(".ts"))) {
    const texto = fs.readFileSync(path.join(gw, "src", arq), "utf8");
    assert.ok(!/from "(pg|pg-pool|@prisma\/client)"/.test(texto), `${arq} importa banco`);
    assert.ok(!/DATABASE_URL|dna_work\.|SELECT |INSERT INTO/.test(texto), `${arq} referencia banco`);
    assert.ok(!/from "\.\.\/\.\.\/backend/.test(texto), `${arq} importa código do monólito`);
  }
});

test("Dockerfile independente: usuário não root, contexto próprio, sem copiar o repositório, sem segredos, healthcheck", () => {
  const d = fs.readFileSync(path.join(gw, "Dockerfile"), "utf8");
  assert.match(d, /^USER node$/m);
  assert.ok(!/COPY \. \./.test(d) && !/\.\.\//.test(d), "contexto fora de mcp-server/");
  assert.ok(!/\b(ENV|ARG)\s+\w*(SECRET|KEY|TOKEN|PASSWORD)\w*\s*=/.test(d), "segredo no Dockerfile");
  assert.match(d, /HEALTHCHECK/);
  assert.match(d, /npm ci --omit=dev|npm prune --omit=dev/);
  assert.match(d, /FROM node:22/);
  const ignore = fs.readFileSync(path.join(gw, ".dockerignore"), "utf8");
  for (const item of ["*.pem", "*.key", ".env"]) assert.ok(ignore.includes(item), `.dockerignore sem ${item}`);
});

test("nenhuma chave privada, certificado ou segredo versionado no repositório", () => {
  const arquivos = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  const proibidos = arquivos.filter((a) => /\.(pem|key|crt|csr|p12|pfx)$/i.test(a));
  assert.deepEqual(proibidos, [], "arquivo de certificado/chave versionado");
  const padrao = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/;
  for (const arq of arquivos) {
    const p = path.join(raiz, arq);
    if (!fs.existsSync(p) || fs.statSync(p).size > 2_000_000 || /\.(png|jpe?g|webp|pdf|ico|woff2?|traineddata|zip)$/i.test(arq)) continue;
    const texto = fs.readFileSync(p, "utf8");
    assert.ok(!padrao.test(texto), `chave privada em ${arq}`);
  }
  const ignorados = fs.readFileSync(path.join(raiz, ".gitignore"), "utf8") + fs.readFileSync(path.join(gw, ".gitignore"), "utf8");
  for (const item of ["*.pem", "*.key"]) assert.ok(ignorados.includes(item), `.gitignore sem ${item}`);
});

test("a implementação da assinatura é idêntica no gateway e no monólito (mesmo texto assinado, mesma HMAC)", async () => {
  const { assinar: a1 } = await import("../src/assinatura.js");
  const { assinar: a2 } = await import("../../backend/src/mcp/assinatura.js");
  const campos = { metodo: "POST", caminho: "/internal/mcp/x/executar?q=1", contrato: 1, chave: "gw1", timestamp: 1_700_000_000, nonce: "nonce-1234567890abcd", requestId: "req-12345678", corpo: '{"a":1}', token: "tok-0123456789012345678901234567890123456789" };
  assert.equal(a1("segredo-de-teste-segredo-de-teste-123456", campos), a2("segredo-de-teste-segredo-de-teste-123456", campos));
  assert.equal(a1("segredo-de-teste-segredo-de-teste-123456", { ...campos, token: null }), a2("segredo-de-teste-segredo-de-teste-123456", { ...campos, token: null }));
});
