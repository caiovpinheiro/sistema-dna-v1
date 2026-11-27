import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { APP_URL, MCP_URL, autorizar, criarAmbiente, criarIntegracao, criarUsuario, percorrerAutorizacao, pkce, renovar, requisicaoInterna, trocarCodigo, type Ambiente, type UsuarioTeste } from "./mcp-suporte.js";

/**
 * Modo alternativo para o ChatGPT: CIMD desligado (MCP_OAUTH_CIMD=0) e registro dinâmico ligado (MCP_OAUTH_DCR=1).
 * O ChatGPT registra um cliente público e usa PKCE (sem assinatura de cliente nem JWKS). Todo o resto continua igual:
 * login real no painel, consentimento, resource obrigatório, redirect exato, política por usuário.
 */
let amb: Ambiente;
let ana: UsuarioTeste;
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const RECURSO = `${MCP_URL}/mcp/dcr`;
const cab = { "x-forwarded-proto": "https", host: new URL(APP_URL).host, "content-type": "application/json" };

before(async () => {
  amb = await criarAmbiente({ MCP_OAUTH_DCR: "1", MCP_OAUTH_CIMD: "0", MCP_OAUTH_REDIRECT_URIS: REDIRECT, MCP_OAUTH_CIMD_URLS: "" });
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  await criarIntegracao(amb, "dcr", { ferramentas: ["consultar_filtros_vagas", "listar_vagas_abertas"], usuarios: [{ id: ana.id }] });
});
after(async () => { await amb?.fechar(); });

test("metadados: sem CIMD e com registration_endpoint, para o ChatGPT escolher o registro dinâmico", async () => {
  const meta = (await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: cab })).json();
  assert.ok(!meta.client_id_metadata_document_supported, "CIMD deve estar desligado");
  assert.equal(meta.registration_endpoint, `${APP_URL}/oauth/register`);
  assert.ok(meta.code_challenge_methods_supported.includes("S256"));
});

test("fluxo completo como o ChatGPT: registra cliente público, autoriza no painel, troca o código, usa e renova o token", async () => {
  const reg = await amb.app.inject({ method: "POST", url: "/oauth/register", headers: cab, payload: JSON.stringify({
    client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }) });
  assert.equal(reg.statusCode, 201, reg.body);
  const clientId = reg.json().client_id as string;
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { clientId, redirectUri: REDIRECT, resource: RECURSO, challenge, scope: "mcp:read" });
  assert.ok(passo.final, `consentimento falhou: ${passo.decisao.body}`);
  const code = new URL(String(passo.final.headers.location)).searchParams.get("code");
  assert.ok(code);
  const troca = await trocarCodigo(amb, { code, verifier, clientId, redirectUri: REDIRECT, resource: RECURSO });
  assert.equal(troca.statusCode, 200, troca.body);
  const tokens = troca.json() as { access_token: string; refresh_token: string };
  const lista = await requisicaoInterna(amb, { slug: "dcr", operacao: "ferramentas", token: tokens.access_token });
  assert.equal(lista.statusCode, 200, lista.body);
  assert.deepEqual((lista.json() as any).data.ferramentas.map((f: any) => f.nome).sort(), ["consultar_filtros_vagas", "listar_vagas_abertas"]);
  const novo = await renovar(amb, { refresh: tokens.refresh_token, clientId, resource: RECURSO });
  assert.equal(novo.statusCode, 200, novo.body);
});

test("com CIMD desligado, client_id em forma de URL é recusado; redirect fora da lista não recebe código", async () => {
  const { challenge } = pkce();
  const cimd = await autorizar(amb, { clientId: "https://chatgpt.com/oauth/client.json", redirectUri: REDIRECT, resource: RECURSO, challenge });
  assert.notEqual(cimd.statusCode, 303, "não pode iniciar login com client_id de documento");
  const fora = await amb.app.inject({ method: "POST", url: "/oauth/register", headers: cab, payload: JSON.stringify({ client_name: "Fora", redirect_uris: ["https://evil.example/cb"], token_endpoint_auth_method: "none" }) });
  if (fora.statusCode === 201) {
    const passo = await percorrerAutorizacao(amb, ana, { clientId: fora.json().client_id, redirectUri: "https://evil.example/cb", resource: RECURSO, challenge });
    assert.equal(passo.final, null, "consentimento recusa redirect fora da lista");
  }
});
