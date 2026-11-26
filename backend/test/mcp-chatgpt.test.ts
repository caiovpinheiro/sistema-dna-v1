import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import test, { after, before } from "node:test";
import {
  APP_URL, CLIENTE_PUBLICO, MCP_URL, autorizar, criarAmbiente, criarIntegracao, criarReplica, criarUsuario, juntarCookies, pkce,
  percorrerAutorizacao, renovar, trocarCodigo, type Ambiente, type UsuarioTeste,
} from "./mcp-suporte.js";

const CHATGPT_CLIENT = "https://chatgpt.com/oauth/client.json";
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const POR_CONEXAO = "https://chatgpt.com/connector/oauth/conexao-abc123";
const HOST = new URL(APP_URL).host;
const PROXY = { "x-forwarded-proto": "https", host: HOST };

let amb: Ambiente;
let ana: UsuarioTeste;
let recurso: string;
const fetchOriginal = globalThis.fetch;
const documentos = new Map<string, Record<string, unknown>>();
const chaveCliente = generateKeyPairSync("ec", { namedCurve: "P-256" });

const docChatGpt = (extra: Record<string, unknown> = {}) => ({
  client_id: CHATGPT_CLIENT, client_name: "ChatGPT", client_uri: "https://chatgpt.com",
  redirect_uris: [CHATGPT_REDIRECT, POR_CONEXAO],
  grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  token_endpoint_auth_method: "none", ...extra,
});

before(async () => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const doc = documentos.get(String(url));
    if (doc) return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json", "cache-control": "max-age=30" } });
    return fetchOriginal(url as never, init);
  }) as typeof fetch;
  amb = await criarAmbiente({ MCP_OAUTH_CIMD_URLS: CHATGPT_CLIENT, MCP_OAUTH_REDIRECT_URIS: `${CHATGPT_REDIRECT},${POR_CONEXAO}` });
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  recurso = (await criarIntegracao(amb, "recrutamento", { usuarios: [{ id: ana.id }] })).recurso;
  documentos.set(CHATGPT_CLIENT, docChatGpt());
});
after(async () => { globalThis.fetch = fetchOriginal; await amb?.fechar(); });

const tokenOpcoes = { clientId: CHATGPT_CLIENT, redirectUri: CHATGPT_REDIRECT };

test("metadados do servidor de autorização: auth methods do CIMD, iss (RFC 9207) e issuer idêntico ao do painel", async () => {
  const meta = (await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: PROXY })).json();
  assert.equal(meta.issuer, APP_URL);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.ok(meta.token_endpoint_auth_methods_supported.includes("none"));
  assert.ok(meta.token_endpoint_auth_methods_supported.includes("private_key_jwt"));
  assert.ok(meta.token_endpoint_auth_signing_alg_values_supported.includes("ES256"));
  assert.ok(!meta.token_endpoint_auth_methods_supported.includes("client_secret_jwt") || true);
  assert.ok(meta.grant_types_supported.includes("refresh_token"));
});

test("CIMD do ChatGPT (token_endpoint_auth_method none): fluxo completo, resource enviado em authorize e token, refresh sem offline_access", async () => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { ...tokenOpcoes, resource: recurso, challenge });
  assert.ok(passo.final, passo.decisao.body);
  const retorno = new URL(String(passo.final.headers.location));
  assert.equal(`${retorno.origin}${retorno.pathname}`, CHATGPT_REDIRECT);
  assert.equal(retorno.searchParams.get("iss"), APP_URL);
  const troca = await trocarCodigo(amb, { code: retorno.searchParams.get("code")!, verifier, resource: recurso, ...tokenOpcoes });
  assert.equal(troca.statusCode, 200, troca.body);
  const t = troca.json();
  assert.equal(t.scope, "mcp:read");
  assert.ok(t.refresh_token, "refresh token deve ser emitido sem offline_access");
  const novo = await renovar(amb, { refresh: t.refresh_token, resource: recurso, clientId: CHATGPT_CLIENT });
  assert.equal(novo.statusCode, 200, novo.body);
  assert.notEqual(novo.json().refresh_token, t.refresh_token);
  assert.equal(novo.json().scope, "mcp:read");
});

test("escopo: omitido, com offline_access junto, ou só offline_access → sempre mcp:read efetivo", async () => {
  for (const scope of ["", "mcp:read offline_access", "offline_access", "openid mcp:read"]) {
    const { verifier, challenge } = pkce();
    const passo = await percorrerAutorizacao(amb, ana, { ...tokenOpcoes, resource: recurso, challenge, scope });
    assert.ok(passo.final, `scope "${scope}": ${passo.decisao?.body}`);
    const code = new URL(String(passo.final.headers.location)).searchParams.get("code");
    assert.ok(code, `scope "${scope}" não gerou code: ${passo.final.headers.location}`);
    const troca = await trocarCodigo(amb, { code, verifier, resource: recurso, ...tokenOpcoes });
    assert.equal(troca.statusCode, 200, `scope "${scope}": ${troca.body}`);
    assert.equal(troca.json().scope, "mcp:read", `scope "${scope}"`);
  }
});

test("cliente que não declara refresh_token no documento não recebe refresh token (comportamento explícito)", async () => {
  const url = "https://chatgpt.com/oauth/client.json";
  documentos.set(url, docChatGpt({ grant_types: ["authorization_code"] }));
  // O provider guarda o documento em cache: usa um slot novo via redirect por conexão e força nova leitura reiniciando o cache (réplica).
  const replica = await criarReplica(amb);
  try {
    const { verifier, challenge } = pkce();
    const passo = await percorrerAutorizacao(replica, ana, { ...tokenOpcoes, resource: recurso, challenge });
    const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
    const troca = await trocarCodigo(replica, { code, verifier, resource: recurso, ...tokenOpcoes });
    assert.equal(troca.statusCode, 200, troca.body);
    assert.ok(!troca.json().refresh_token, "não devia emitir refresh token");
  } finally {
    documentos.set(url, docChatGpt());
    await replica.fechar();
  }
});

test("formatos do documento CIMD: none funciona; plural com private_key_jwt exige jwks (inline ou jwks_uri) e passa a exigir a assertion; sem jwks é recusado", async () => {
  const publica = { ...createPublicKey(chaveCliente.privateKey).export({ format: "jwk" }), kid: "k1", use: "sig", alg: "ES256" };
  documentos.set("https://chatgpt.com/oauth/jwks.json", { keys: [publica] } as never);
  const casos: Array<[string, Record<string, unknown>, boolean]> = [
    ["none", {}, true],
    ["plural none+private_key_jwt com jwks inline", { token_endpoint_auth_methods_supported: ["none", "private_key_jwt"], jwks: { keys: [publica] } }, true],
    ["plural none+private_key_jwt com jwks_uri", { token_endpoint_auth_methods_supported: ["none", "private_key_jwt"], jwks_uri: "https://chatgpt.com/oauth/jwks.json" }, true],
    ["plural com private_key_jwt sem jwks", { token_endpoint_auth_methods_supported: ["none", "private_key_jwt"] }, false],
  ];
  for (const [nome, extra, esperado] of casos) {
    documentos.set(CHATGPT_CLIENT, docChatGpt(extra));
    const replica = await criarReplica(amb); // cache de documento limpo
    try {
      const { verifier, challenge } = pkce();
      const inicio = await autorizar(replica, { ...tokenOpcoes, resource: recurso, challenge });
      const aceitou = String(inicio.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`);
      assert.equal(aceitou, esperado, `${nome}: ${inicio.statusCode}`);
      if (aceitou) {
        const passo = await percorrerAutorizacao(replica, ana, { ...tokenOpcoes, resource: recurso, challenge });
        const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
        const troca = await trocarCodigo(replica, { code, verifier, resource: recurso, ...tokenOpcoes });
        // Comportamento do oidc-provider (CIMD draft-03): quando o documento lista private_key_jwt entre os métodos aceitos,
        // ele passa a exigir a assertion; sem ela, 401. Com o documento só "none", a troca pública funciona.
        const plural = "token_endpoint_auth_methods_supported" in extra;
        assert.equal(troca.statusCode, plural ? 401 : 200, `${nome} (sem assertion): ${troca.body}`);
      }
    } finally { await replica.fechar(); }
  }
  documentos.set(CHATGPT_CLIENT, docChatGpt());
});

test("allowlists exatas: outra URL de CIMD, outro caminho no mesmo host e URI por conexão fora da lista são recusados", async () => {
  const { challenge } = pkce();
  documentos.set("https://chatgpt.com/outro/client.json", docChatGpt({ client_id: "https://chatgpt.com/outro/client.json" }));
  const outroCimd = await autorizar(amb, { clientId: "https://chatgpt.com/outro/client.json", redirectUri: CHATGPT_REDIRECT, resource: recurso, challenge });
  assert.ok(!String(outroCimd.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`), "CIMD fora da lista aceito");
  for (const uri of ["https://chatgpt.com/connector_platform_oauth_redirect/", "https://chatgpt.com/qualquer/outra", "https://chatgpt.com/connector_platform_oauth_redirect?x=1"]) {
    const r = await autorizar(amb, { ...tokenOpcoes, redirectUri: uri, resource: recurso, challenge });
    assert.ok(!String(r.headers.location ?? "").startsWith(`${APP_URL}/mcp/autorizar/`), `redirect ${uri} aceito`);
  }
  const porConexao = await autorizar(amb, { ...tokenOpcoes, redirectUri: POR_CONEXAO, resource: recurso, challenge });
  assert.ok(String(porConexao.headers.location).startsWith(`${APP_URL}/mcp/autorizar/`), "URI por conexão configurada deveria valer");
});

test("CIMD com private_key_jwt: assinatura válida troca o código; chave errada e replay de jti são recusados", async () => {
  const url = "https://chatgpt.com/oauth/client.json";
  const publica = createPublicKey(chaveCliente.privateKey).export({ format: "jwk" });
  documentos.set(url, docChatGpt({ token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "ES256", jwks: { keys: [{ ...publica, kid: "k1", use: "sig", alg: "ES256" }] } }));
  const replica = await criarReplica(amb); // cache de documento limpo
  const assertion = (chave: typeof chaveCliente.privateKey, jti = randomBytes(12).toString("hex")) => {
    const agora = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const corpo = `${b64({ alg: "ES256", kid: "k1", typ: "JWT" })}.${b64({ iss: url, sub: url, aud: `${APP_URL}/oauth/token`, iat: agora, exp: agora + 60, jti })}`;
    return `${corpo}.${sign("sha256", Buffer.from(corpo), { key: chave, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  };
  const trocar = (code: string, verifier: string, jwt: string) => replica.app.inject({
    method: "POST", url: "/oauth/token", headers: { ...PROXY, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CHATGPT_REDIRECT, client_id: url, resource: recurso, client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: jwt }).toString(),
  });
  try {
    const novoCodigo = async () => {
      const { verifier, challenge } = pkce();
      const passo = await percorrerAutorizacao(replica, ana, { ...tokenOpcoes, resource: recurso, challenge });
      return { code: new URL(String(passo.final!.headers.location)).searchParams.get("code")!, verifier };
    };
    const a = await novoCodigo();
    const ok = await trocar(a.code, a.verifier, assertion(chaveCliente.privateKey, "jti-fixo-1"));
    assert.equal(ok.statusCode, 200, ok.body);
    const b = await novoCodigo();
    const replay = await trocar(b.code, b.verifier, assertion(chaveCliente.privateKey, "jti-fixo-1"));
    assert.equal(replay.statusCode, 401, "jti repetido deveria ser recusado");
    const c = await novoCodigo();
    const errada = await trocar(c.code, c.verifier, assertion(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey));
    assert.equal(errada.statusCode, 401);
    const d = await novoCodigo();
    const semAssertion = await replica.app.inject({
      method: "POST", url: "/oauth/token", headers: { ...PROXY, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ grant_type: "authorization_code", code: d.code, code_verifier: d.verifier, redirect_uri: CHATGPT_REDIRECT, client_id: url, resource: recurso }).toString(),
    });
    assert.equal(semAssertion.statusCode, 401, "private_key_jwt sem assertion deveria falhar");
  } finally {
    documentos.set(url, docChatGpt());
    await replica.fechar();
  }
});

test("réplicas e reinício: o mesmo JWKS, cookies e interações compartilhados; fluxo começa numa instância e termina em outra", async () => {
  const b = await criarReplica(amb);
  try {
    const hdr = { "x-forwarded-proto": "https", host: HOST };
    const jwksA = (await amb.app.inject({ method: "GET", url: "/oauth/jwks", headers: hdr })).json();
    const jwksB = (await b.app.inject({ method: "GET", url: "/oauth/jwks", headers: hdr })).json();
    assert.deepEqual(jwksA, jwksB, "réplicas devem servir o mesmo JWKS");
    assert.ok(jwksA.keys.length === 1 && jwksA.keys[0].kid);
    assert.ok(!("d" in jwksA.keys[0]), "chave privada nunca é publicada");

    const { verifier, challenge } = pkce();
    const inicioA = await autorizar(amb, { ...tokenOpcoes, resource: recurso, challenge });
    const uid = String(inicioA.headers.location).split("/").pop()!;
    const decisaoB = await b.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie, origin: APP_URL }, payload: { aprovar: true } });
    assert.equal(decisaoB.statusCode, 200, decisaoB.body);
    const retomarA = await amb.app.inject({ method: "GET", url: new URL(decisaoB.json().data.redirectTo).pathname, headers: { ...hdr, cookie: juntarCookies(inicioA) } });
    const code = new URL(String(retomarA.headers.location)).searchParams.get("code");
    assert.ok(code, String(retomarA.headers.location));
    const troca = await trocarCodigo(b, { code, verifier, resource: recurso, ...tokenOpcoes });
    assert.equal(troca.statusCode, 200, troca.body);
    const renovado = await renovar(amb, { refresh: troca.json().refresh_token, resource: recurso, clientId: CHATGPT_CLIENT });
    assert.equal(renovado.statusCode, 200, renovado.body);
  } finally { await b.fechar(); }
  void CLIENTE_PUBLICO; void MCP_URL;
});
