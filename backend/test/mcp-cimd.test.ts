import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { APP_URL, MCP_URL, autorizar, criarAmbiente, criarIntegracao, criarUsuario, pkce, percorrerAutorizacao, trocarCodigo, type Ambiente, type UsuarioTeste } from "./mcp-suporte.js";

let amb: Ambiente;
let ana: UsuarioTeste;
let recurso: string;
const fetchOriginal = globalThis.fetch;

const CIMD_URL = "https://app.cimd.test/oauth/client.json";
let documento: Record<string, unknown> | string | null = null;
let statusDoc = 200;
let tipoDoc = "application/json";
const pedidos: string[] = [];

const docValido = (extra: Record<string, unknown> = {}) => ({
  client_id: CIMD_URL, client_name: "Assistente CIMD", redirect_uris: ["https://cliente.test.local/callback"],
  token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], ...extra,
});

const stub = (async (url: string | URL | Request, init?: RequestInit) => {
  const alvo = String(url);
  if (alvo.startsWith("https://app.cimd.test/")) {
    pedidos.push(alvo);
    if (documento === null) throw new Error("rede indisponível");
    return new Response(typeof documento === "string" ? documento : JSON.stringify(documento), { status: statusDoc, headers: { "content-type": tipoDoc, "cache-control": "max-age=30" } });
  }
  return fetchOriginal(url as never, init);
}) as typeof fetch;

before(async () => {
  globalThis.fetch = stub;
  amb = await criarAmbiente({ MCP_OAUTH_DCR: "1", MCP_OAUTH_REDIRECT_HOSTS: "cliente.test.local" });
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  const integracao = await criarIntegracao(amb, "recrutamento", { usuarios: [{ id: ana.id }] });
  recurso = integracao.recurso;
});
after(async () => { globalThis.fetch = fetchOriginal; await amb?.fechar(); });

const arranjo = (extra: Record<string, unknown> = {}) => { documento = docValido(extra); statusDoc = 200; tipoDoc = "application/json"; };

test("CIMD: client_id é uma URL https; o documento define nome e redirect_uris; fluxo completo até o token", async () => {
  arranjo();
  const { verifier, challenge } = pkce();
  const previa = await autorizar(amb, { clientId: CIMD_URL, resource: recurso, challenge });
  const uidPrevia = String(previa.headers.location).split("/").pop()!;
  const info = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uidPrevia}`, headers: { cookie: ana.cookie } });
  assert.equal(info.json().data.aplicativo.nome, "Assistente CIMD");
  assert.equal(info.json().data.pode, true);
  const passo = await percorrerAutorizacao(amb, ana, { clientId: CIMD_URL, resource: recurso, challenge });
  assert.ok(passo.final, passo.decisao.body);
  const code = new URL(String(passo.final.headers.location)).searchParams.get("code");
  assert.ok(code);
  const troca = await trocarCodigo(amb, { code, verifier, resource: recurso, clientId: CIMD_URL });
  assert.equal(troca.statusCode, 200, troca.body);
  assert.ok(troca.json().refresh_token);
});

test("CIMD: documento inválido é recusado (client_id diferente, segredo, autenticação por segredo, redirect fora da lista, http)", async () => {
  const { challenge } = pkce();
  const casos: Array<[string, Record<string, unknown>]> = [
    ["client_id diferente", { client_id: "https://app.cimd.test/outro.json" }],
    ["com client_secret", { client_secret: "x".repeat(40) }],
    ["autenticação por segredo", { token_endpoint_auth_method: "client_secret_basic" }],
    ["redirect em host fora da lista", { redirect_uris: ["https://evil.example/callback"] }],
    ["redirect http", { redirect_uris: ["http://cliente.test.local/callback"] }],
  ];
  for (const [nome, extra] of casos) {
    // O cache do provider é por client_id: usa uma URL diferente a cada caso para forçar nova leitura.
    const url = `https://app.cimd.test/caso-${encodeURIComponent(nome).slice(0, 30)}.json`;
    documento = docValido({ client_id: url, ...extra });
    if ("client_id" in extra) (documento as Record<string, unknown>).client_id = extra.client_id;
    statusDoc = 200;
    const r = await autorizar(amb, { clientId: url, resource: recurso, challenge, redirectUri: "https://cliente.test.local/callback" });
    const destino = String(r.headers.location ?? "");
    assert.ok(!destino.startsWith(`${APP_URL}/mcp/autorizar/`), `aceitou CIMD inválido: ${nome} (${r.statusCode})`);
    assert.ok(r.statusCode >= 400 || /error=/.test(destino), nome);
  }
});

test("CIMD: falha de rede, status ≠ 200, corpo que não é JSON e client_id não-https são recusados", async () => {
  const { challenge } = pkce();
  const tentativas: Array<[string, () => void, string]> = [
    ["rede", () => { documento = null; }, "https://app.cimd.test/rede.json"],
    ["404", () => { documento = docValido(); statusDoc = 404; }, "https://app.cimd.test/404.json"],
    ["não JSON", () => { documento = "<html>oi</html>"; statusDoc = 200; tipoDoc = "text/html"; }, "https://app.cimd.test/html.json"],
  ];
  for (const [nome, preparar, url] of tentativas) {
    statusDoc = 200; tipoDoc = "application/json";
    preparar();
    const r = await autorizar(amb, { clientId: url, resource: recurso, challenge, redirectUri: "https://cliente.test.local/callback" });
    assert.ok(!String(r.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`), `aceitou ${nome}`);
    assert.ok(r.statusCode >= 400 || /error=/.test(String(r.headers.location)), nome);
  }
  for (const url of ["http://app.cimd.test/c.json", "https://app.cimd.test/c.json#frag", "https://user:pw@app.cimd.test/c.json", "app.cimd.test/c.json"]) {
    arranjo();
    const r = await autorizar(amb, { clientId: url, resource: recurso, challenge, redirectUri: "https://cliente.test.local/callback" });
    assert.ok(!String(r.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`), `aceitou client_id ${url}`);
  }
});

test("CIMD: proteção contra SSRF — IPs internos, loopback e metadados de nuvem nunca são consultados", async () => {
  globalThis.fetch = fetchOriginal; // sem o stub: vale a proteção real da biblioteca
  try {
    const { challenge } = pkce();
    for (const url of ["https://127.0.0.1/client.json", "https://169.254.169.254/latest/meta-data.json", "https://10.0.0.5/c.json", "https://[::1]/c.json", "https://localhost/c.json"]) {
      const inicio = Date.now();
      const r = await autorizar(amb, { clientId: url, resource: recurso, challenge, redirectUri: "https://cliente.test.local/callback" });
      assert.ok(!String(r.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`), `consultou ${url}`);
      assert.ok(Date.now() - inicio < 6000, `${url} demorou demais`);
    }
  } finally {
    globalThis.fetch = stub;
  }
});

test("CIMD: o resultado é cacheado (não busca o documento a cada autorização)", async () => {
  arranjo({ client_id: "https://app.cimd.test/cache.json" });
  const url = "https://app.cimd.test/cache.json";
  const { challenge } = pkce();
  pedidos.length = 0;
  await autorizar(amb, { clientId: url, resource: recurso, challenge });
  await autorizar(amb, { clientId: url, resource: recurso, challenge });
  assert.equal(pedidos.filter((p) => p === url).length, 1);
});

test("DCR (quando ligado): registra cliente público, recusa redirect http e expõe registration_endpoint", async () => {
  const cab = { "x-forwarded-proto": "https", host: new URL(APP_URL).host, "content-type": "application/json" };
  const meta = await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: cab });
  assert.equal(meta.json().registration_endpoint, `${APP_URL}/oauth/register`);
  const ok = await amb.app.inject({ method: "POST", url: "/oauth/register", headers: cab, payload: JSON.stringify({ client_name: "DCR Teste", redirect_uris: ["https://cliente.test.local/cb"], token_endpoint_auth_method: "none" }) });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.ok(ok.json().client_id);
  assert.ok(!ok.json().client_secret, "cliente público não recebe segredo");
  // A biblioteca aceita http no cadastro; o consentimento (único caminho para um code) recusa redirect que não seja https.
  const http = await amb.app.inject({ method: "POST", url: "/oauth/register", headers: cab, payload: JSON.stringify({ client_name: "Http", redirect_uris: ["http://cliente.test.local/cb"], token_endpoint_auth_method: "none" }) });
  if (http.statusCode === 201) {
    const { challenge: c2 } = pkce();
    const r2 = await autorizar(amb, { clientId: http.json().client_id, redirectUri: "http://cliente.test.local/cb", resource: recurso, challenge: c2 });
    const uid2 = String(r2.headers.location).split("/").pop()!;
    const info2 = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid2}`, headers: { cookie: ana.cookie } });
    assert.equal(info2.json().data.pode, false);
    const aprova = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid2}/decisao`, headers: { cookie: ana.cookie, origin: APP_URL }, payload: { aprovar: true } });
    assert.equal(aprova.statusCode, 403);
  }
  // Cliente registrado por DCR com redirect em host fora da lista: o consentimento nega.
  const fora = await amb.app.inject({ method: "POST", url: "/oauth/register", headers: cab, payload: JSON.stringify({ client_name: "Fora", redirect_uris: ["https://evil.example/cb"], token_endpoint_auth_method: "none" }) });
  if (fora.statusCode === 201) {
    const { challenge } = pkce();
    const r = await autorizar(amb, { clientId: fora.json().client_id, redirectUri: "https://evil.example/cb", resource: recurso, challenge });
    const uid = String(r.headers.location).split("/").pop()!;
    const info = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}`, headers: { cookie: ana.cookie } });
    assert.equal(info.json().data.pode, false);
    assert.match(info.json().data.motivo, /retorno/);
  }
  void MCP_URL;
});
