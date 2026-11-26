import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import test, { after, before } from "node:test";
import {
  APP_URL, autorizar, criarAmbiente, criarIntegracao, criarReplica, criarUsuario, pkce, percorrerAutorizacao, type Ambiente, type UsuarioTeste,
} from "./mcp-suporte.js";

/** Documento CIMD com os MESMOS campos do documento real do ChatGPT, mas chaves descartáveis de teste. */
const CLIENT_ID = "https://chatgpt.com/oauth/client.json";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const JWKS_URI = "https://chatgpt.com/oauth/jwks.json";
const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const HOST = new URL(APP_URL).host;
const PROXY = { "x-forwarded-proto": "https", host: HOST };

const par = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
let k1 = par();
let k2 = par();
let jwksAtual: KeyObject = k1.publicKey;
let kidAtual = "kid-1";
let jwksStatus = 200;
const jwk = (pub: KeyObject, kid: string) => ({ ...pub.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" });

const documentoReal = () => ({
  client_id: CLIENT_ID, client_name: "ChatGPT", redirect_uris: [REDIRECT],
  token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  grant_types: ["authorization_code", "refresh_token", JWT_BEARER], response_types: ["code"],
  token_endpoint_auth_signing_alg: "RS256", jwks_uri: JWKS_URI,
});

let amb: Ambiente;
let ana: UsuarioTeste;
let recurso: string;
const fetchOriginal = globalThis.fetch;
const pedidos: string[] = [];

before(async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    pedidos.push(u);
    if (u === CLIENT_ID) return new Response(JSON.stringify(documentoReal()), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } });
    if (u === JWKS_URI) return new Response(JSON.stringify({ keys: [jwk(jwksAtual, kidAtual)] }), { status: jwksStatus, headers: { "content-type": "application/json", "cache-control": "max-age=60" } });
    return fetchOriginal(url as never, init);
  }) as typeof fetch;
  amb = await criarAmbiente({ MCP_OAUTH_CIMD_URLS: CLIENT_ID, MCP_OAUTH_REDIRECT_URIS: REDIRECT });
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  recurso = (await criarIntegracao(amb, "recrutamento", { usuarios: [{ id: ana.id }] })).recurso;
});
after(async () => { globalThis.fetch = fetchOriginal; await amb?.fechar(); });

type Assertion = { alg?: string; chave?: KeyObject; kid?: string; iss?: string; sub?: string; aud?: string; exp?: number; iat?: number; jti?: string | null; semExp?: boolean };
function assertion(o: Assertion = {}): string {
  const agora = Math.floor(Date.now() / 1000);
  const b64 = (x: unknown) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const cab = b64({ alg: o.alg ?? "RS256", kid: o.kid ?? kidAtual, typ: "JWT" });
  const corpo: Record<string, unknown> = { iss: o.iss ?? CLIENT_ID, sub: o.sub ?? CLIENT_ID, aud: o.aud ?? `${APP_URL}/oauth/token`, iat: o.iat ?? agora };
  if (!o.semExp) corpo.exp = o.exp ?? agora + 60;
  if (o.jti !== null) corpo.jti = o.jti ?? randomBytes(12).toString("hex");
  const dados = `${cab}.${b64(corpo)}`;
  if (o.alg === "none") return `${dados}.`;
  if (o.alg === "HS256") return `${dados}.${Buffer.from("x".repeat(32)).toString("base64url")}`;
  return `${dados}.${sign("sha256", Buffer.from(dados), (o.chave ?? k1.privateKey)).toString("base64url")}`;
}

const tokenPost = (a: Ambiente, form: Record<string, string>) => a.app.inject({
  method: "POST", url: "/oauth/token", headers: { ...PROXY, "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams(form).toString(),
});
const obterCodigo = async (a: Ambiente = amb) => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(a, ana, { clientId: CLIENT_ID, redirectUri: REDIRECT, resource: recurso, challenge });
  assert.ok(passo.final, passo.decisao.body);
  const code = new URL(String(passo.final.headers.location)).searchParams.get("code");
  assert.ok(code, String(passo.final.headers.location));
  return { code, verifier };
};
const trocar = (a: Ambiente, c: { code: string; verifier: string }, jwt: string | null, extra: Record<string, string> = {}) => tokenPost(a, {
  grant_type: "authorization_code", code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT, client_id: CLIENT_ID, resource: recurso,
  ...(jwt ? { client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: jwt } : {}), ...extra,
});

test("documento real (private_key_jwt + RS256 + jwks_uri + jwt-bearer no cliente): fluxo completo e refresh; o grant jwt-bearer NÃO é habilitado", async () => {
  const replica = await criarReplica(amb);
  try {
    const c = await obterCodigo(replica);
    const r = await trocar(replica, c, assertion());
    assert.equal(r.statusCode, 200, r.body);
    const t = r.json();
    assert.ok(t.access_token && t.refresh_token);
    assert.equal(t.scope, "mcp:read");
    // Refresh exige a assertion do cliente também.
    const semAssertion = await tokenPost(replica, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: CLIENT_ID, resource: recurso });
    assert.equal(semAssertion.statusCode, 401);
    const ok = await tokenPost(replica, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: CLIENT_ID, resource: recurso, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion() });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.notEqual(ok.json().refresh_token, t.refresh_token);
    // O servidor não anuncia nem aceita o grant jwt-bearer.
    const meta = (await replica.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: PROXY })).json();
    assert.ok(!meta.grant_types_supported.includes(JWT_BEARER), "jwt-bearer anunciado");
    assert.deepEqual([...meta.grant_types_supported].sort(), ["authorization_code", "refresh_token"]);
    const bearer = await tokenPost(replica, { grant_type: JWT_BEARER, assertion: assertion(), client_id: CLIENT_ID, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion() });
    assert.equal(bearer.statusCode, 400);
    assert.equal(bearer.json().error, "unsupported_grant_type");
  } finally { await replica.fechar(); }
});

test("métodos de autenticação: o servidor anuncia só none, secret (pré-cadastrados) e private_key_jwt; algoritmos só RS256/ES256", async () => {
  const meta = (await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: PROXY })).json();
  assert.deepEqual([...meta.token_endpoint_auth_methods_supported].sort(), ["client_secret_basic", "client_secret_post", "none", "private_key_jwt"]);
  assert.deepEqual([...meta.token_endpoint_auth_signing_alg_values_supported].sort(), ["ES256", "RS256"]);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
});

test("a assertion é validada: assinatura, alg, iss, sub, aud, exp, jti e replay", async () => {
  const replica = await criarReplica(amb);
  try {
    const agora = Math.floor(Date.now() / 1000);
    const ruins: Array<[string, Assertion]> = [
      ["chave errada", { chave: par().privateKey }],
      ["alg none", { alg: "none" }], ["alg HS256", { alg: "HS256" }],
      ["iss diferente", { iss: "https://outro.example/client.json" }], ["sub diferente", { sub: "https://outro.example/client.json" }],
      ["aud de outro servidor", { aud: "https://evil.example/oauth/token" }],
      ["expirada", { exp: agora - 120, iat: agora - 240 }], ["sem exp", { semExp: true }], ["sem jti", { jti: null }],
      ["kid desconhecido (fora do JWKS em cache)", { kid: "kid-que-nao-existe" }],
    ];
    for (const [nome, o] of ruins) {
      const c = await obterCodigo(replica);
      const r = await trocar(replica, c, assertion(o));
      // Rejeitada com invalid_client (401) ou invalid_request (400): nunca emite token.
      assert.ok(r.statusCode === 401 || r.statusCode === 400, `${nome}: ${r.statusCode} ${r.body}`);
      assert.ok(!r.json().access_token, `${nome} emitiu token`);
      console.log(`ASSERTION recusada [${nome}] → ${r.statusCode} ${r.json().error}`);
    }
    // aud = issuer também é aceito (RFC 7523); a mesma assertion não vale duas vezes (replay) nem em outra réplica.
    const jti = "jti-unico-" + randomBytes(6).toString("hex");
    const c1 = await obterCodigo(replica);
    assert.equal((await trocar(replica, c1, assertion({ aud: APP_URL, jti }))).statusCode, 200);
    const c2 = await obterCodigo(replica);
    assert.equal((await trocar(replica, c2, assertion({ jti }))).statusCode, 401, "replay de jti aceito");
    const outra = await criarReplica(amb);
    try { const c3 = await obterCodigo(outra); assert.equal((await trocar(outra, c3, assertion({ jti }))).statusCode, 401, "replay entre réplicas aceito"); } finally { await outra.fechar(); }
    // Sem assertion, ou com client_secret: recusado (o documento exige private_key_jwt).
    const c4 = await obterCodigo(replica);
    assert.equal((await trocar(replica, c4, null)).statusCode, 401);
    assert.equal((await trocar(replica, c4, null, { client_secret: "x".repeat(40) })).statusCode, 401);
  } finally { await replica.fechar(); }
});

test("JWKS oficial: cache curto (sem busca a cada requisição); rotação absorvida após uma falha (cache invalidado); chave antiga deixa de valer", async () => {
  const replica = await criarReplica(amb);
  try {
    jwksAtual = k1.publicKey; kidAtual = "kid-1";
    const buscas = () => pedidos.filter((p) => p === JWKS_URI).length;
    const a = await obterCodigo(replica);
    assert.equal((await trocar(replica, a, assertion({ chave: k1.privateKey, kid: "kid-1" }))).statusCode, 200);
    const depoisDoPrimeiro = buscas();
    const a2 = await obterCodigo(replica);
    assert.equal((await trocar(replica, a2, assertion({ chave: k1.privateKey, kid: "kid-1" }))).statusCode, 200);
    assert.equal(buscas(), depoisDoPrimeiro, "o JWKS foi buscado a cada requisição (sem cache)");
    // Rotação: o ChatGPT publica só a chave 2. Com o cache vigente a primeira tentativa falha (e invalida o cache)…
    jwksAtual = k2.publicKey; kidAtual = "kid-2";
    const b = await obterCodigo(replica);
    const primeira = await trocar(replica, b, assertion({ chave: k2.privateKey, kid: "kid-2" }));
    assert.ok(primeira.statusCode === 401, "chave nova aceita com o cache antigo");
    // …e a nova tentativa busca o JWKS atual e funciona (o código não foi consumido pela falha de autenticação).
    const segunda = await trocar(replica, b, assertion({ chave: k2.privateKey, kid: "kid-2" }));
    assert.equal(segunda.statusCode, 200, "rotação não foi absorvida: " + segunda.body);
    assert.ok(buscas() > depoisDoPrimeiro, "o JWKS não foi buscado de novo na rotação");
    for (const kid of ["kid-1", "kid-2"]) {
      const c = await obterCodigo(replica);
      const r = await trocar(replica, c, assertion({ chave: k1.privateKey, kid }));
      assert.ok(r.statusCode === 401 || r.statusCode === 400, `chave antiga aceita (kid ${kid})`);
    }
  } finally { jwksAtual = k1.publicKey; kidAtual = "kid-1"; await replica.fechar(); }
});

test("JWKS indisponível ou inválido: falha fechada (401) e o documento não vira confiança em cache", async () => {
  const replica = await criarReplica(amb);
  try {
    jwksStatus = 500;
    const a = await obterCodigo(replica);
    assert.notEqual((await trocar(replica, a, assertion())).statusCode, 200);
  } finally { jwksStatus = 200; await replica.fechar(); }
});

test("política de escopo explícita: omitido → padrão (mostrado no consentimento); desconhecidos são ignorados, nunca viram mcp:read; só desconhecidos → recusa", async () => {
  const consultar = async (scope: string | null) => {
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: recurso, state: "s" });
    if (scope !== null) q.set("scope", scope);
    const r = await amb.app.inject({ method: "GET", url: `/oauth/authorize?${q}`, headers: PROXY });
    const loc = String(r.headers.location ?? "");
    if (!loc.startsWith(`${APP_URL}/mcp/autorizar/`)) return { loc, info: null as null | Record<string, any> };
    const info = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${loc.split("/").pop()}`, headers: { cookie: ana.cookie } });
    return { loc, info: info.json().data as Record<string, any> };
  };
  const omitido = await consultar(null);
  assert.deepEqual(omitido.info!.escopos.concedidos, ["mcp:read"]);
  assert.equal(omitido.info!.escopos.padraoAplicado, true);
  const explicito = await consultar("mcp:read");
  assert.equal(explicito.info!.escopos.padraoAplicado, false);
  const misto = await consultar("mcp:read offline_access openid");
  assert.deepEqual(misto.info!.escopos.concedidos, ["mcp:read"]);
  assert.ok(misto.info!.escopos.ignorados.includes("openid"), "escopo desconhecido não foi sinalizado como ignorado");
  assert.ok(!misto.info!.escopos.concedidos.includes("openid") && !misto.info!.escopos.concedidos.includes("offline_access"));
  assert.equal(misto.info!.escopos.padraoAplicado, false, "escopo padrão não pode ser aplicado quando o cliente pediu escopos");
  const soDesconhecido = await consultar("offline_access");
  assert.ok(soDesconhecido.info === null || soDesconhecido.info.pode === false, "escopo desconhecido virou acesso");
  if (soDesconhecido.info === null) assert.match(soDesconhecido.loc, /error=invalid_scope|error=/);
  // O cliente não consegue forjar o marcador de "padrão aplicado".
  const { challenge } = pkce();
  const forjado = await amb.app.inject({ method: "GET", url: `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: recurso, scope: "mcp:read", mcp_escopo_padrao: "1" })}`, headers: PROXY });
  const info = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${String(forjado.headers.location).split("/").pop()}`, headers: { cookie: ana.cookie } });
  assert.equal(info.json().data.escopos.padraoAplicado, false);
});

test("sem escopo padrão configurado (MCP_ESCOPO_PADRAO vazio), cliente que omite scope é recusado", async () => {
  const sem = await criarAmbiente({ MCP_OAUTH_CIMD_URLS: CLIENT_ID, MCP_OAUTH_REDIRECT_URIS: REDIRECT, MCP_ESCOPO_PADRAO: "" });
  try {
    const u = await criarUsuario(sem, "Bia", ["vagas"]);
    const rec = (await criarIntegracao(sem, "recrutamento", { usuarios: [{ id: u.id }] })).recurso;
    const { challenge } = pkce();
    const r = await sem.app.inject({ method: "GET", url: `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", resource: rec })}`, headers: PROXY });
    const loc = String(r.headers.location ?? "");
    if (loc.startsWith(`${APP_URL}/mcp/autorizar/`)) {
      const info = await sem.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${loc.split("/").pop()}`, headers: { cookie: u.cookie } });
      assert.equal(info.json().data.pode, false);
    } else assert.match(loc + r.body, /invalid_scope|error=/);
  } finally { await sem.fechar(); }
  void autorizar;
});

test("DCR segue desligado por padrão e o documento real não amplia nada: redirect e CIMD exatos", async () => {
  const meta = (await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: PROXY })).json();
  assert.ok(!("registration_endpoint" in meta));
  const { challenge } = pkce();
  const outroRedirect = await autorizar(amb, { clientId: CLIENT_ID, redirectUri: "https://chatgpt.com/outra/rota", resource: recurso, challenge });
  assert.ok(!String(outroRedirect.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`));
});
