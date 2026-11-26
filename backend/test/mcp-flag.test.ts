import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { criarAmbiente, type Ambiente } from "./mcp-suporte.js";

let amb: Ambiente;

before(async () => {
  // Sem MCP_ENABLED: é o estado de produção até alguém ligar.
  amb = await criarAmbiente({ MCP_ENABLED: "", MCP_GATEWAY_SECRETS: "", MCP_PUBLIC_URL: "", APP_PUBLIC_URL: "" });
});
after(async () => { await amb?.fechar(); });

test("feature flag desligada por padrão: config.MCP_ENABLED é false sem a variável", async () => {
  const { loadConfig } = await import("../src/config.js");
  const anterior = process.env.MCP_ENABLED;
  delete process.env.MCP_ENABLED;
  try {
    assert.equal(loadConfig().MCP_ENABLED, false);
  } finally {
    if (anterior !== undefined) process.env.MCP_ENABLED = anterior;
  }
});

test("flag desligada: nada do MCP existe (sem OAuth, sem metadados, sem consentimento, sem listener interno)", async () => {
  assert.equal(amb.app.mcp, undefined);
  for (const [metodo, url] of [
    ["GET", "/.well-known/oauth-authorization-server"], ["GET", "/.well-known/openid-configuration"], ["GET", "/oauth/authorize"],
    ["POST", "/oauth/token"], ["POST", "/oauth/register"], ["GET", "/oauth/jwks"], ["POST", "/oauth/revoke"],
    ["GET", "/internal/mcp/x/ferramentas"], ["POST", "/internal/mcp/x/executar"],
  ] as const) {
    const r = await amb.app.inject({ method: metodo, url });
    assert.equal(r.statusCode, 404, `${metodo} ${url} → ${r.statusCode}`);
  }
  const consentimento = await amb.app.inject({ method: "GET", url: "/api/v1/mcp/interacao/abcdefgh12345" });
  assert.ok([401, 404].includes(consentimento.statusCode));
});

test("o painel continua funcionando igual com o MCP desligado", async () => {
  const login = await amb.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin@dnawork.local", password: "Teste-Seguro-123" } });
  assert.equal(login.statusCode, 200);
  const saude = await amb.app.inject({ method: "GET", url: "/health" });
  assert.equal(saude.statusCode, 200);
});

test("ligado com configuração insegura ou incompleta, o boot falha (não sobe pela metade)", async () => {
  const { buildApp } = await import("../src/app.js");
  const { loadConfig } = await import("../src/config.js");
  const casos: Array<Record<string, string>> = [
    { MCP_ENABLED: "1", MCP_PUBLIC_URL: "http://mcp.exemplo.com", APP_PUBLIC_URL: "https://painel.exemplo.com", MCP_GATEWAY_SECRETS: `k1:${"a".repeat(40)}` },
    { MCP_ENABLED: "1", MCP_PUBLIC_URL: "https://mcp.exemplo.com", APP_PUBLIC_URL: "https://painel.exemplo.com", MCP_GATEWAY_SECRETS: "" },
    { MCP_ENABLED: "1", MCP_PUBLIC_URL: "https://mcp.exemplo.com", APP_PUBLIC_URL: "", MCP_GATEWAY_SECRETS: `k1:${"a".repeat(40)}` },
  ];
  for (const caso of casos) {
    const salvo = { ...process.env };
    Object.assign(process.env, caso);
    try {
      await assert.rejects(() => buildApp({ config: loadConfig(), db: amb.db, capabilities: { quantidadePosicoes: true, colaboradorContratacao: true, idempotencia: true, sequence: true, missing: [] } }));
    } finally {
      for (const chave of Object.keys(caso)) process.env[chave] = salvo[chave] ?? "";
    }
  }
});
