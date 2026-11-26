import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  APP_URL, CLIENTE_CONFIDENCIAL, CLIENTE_PUBLICO, MCP_URL, autorizar, criarAmbiente, criarIntegracao, criarUsuario,
  loginBootstrap, obterTokens, percorrerAutorizacao, pkce, renovar, trocarCodigo, uidDoRedirect, type Ambiente, type UsuarioTeste,
} from "./mcp-suporte.js";

let amb: Ambiente;
let ana: UsuarioTeste;
let bia: UsuarioTeste;
let recurso: string;

before(async () => {
  amb = await criarAmbiente();
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  bia = await criarUsuario(amb, "Bia", ["vagas"]); // não vinculada
  const integracao = await criarIntegracao(amb, "recrutamento", { usuarios: [{ id: ana.id }] });
  recurso = integracao.recurso;
  await criarIntegracao(amb, "outra", { usuarios: [{ id: ana.id }] });
});
after(async () => { await amb?.fechar(); });

test("metadados RFC 8414: só S256, iss (RFC 9207), CIMD e endpoints sob o emissor do painel", async () => {
  const resposta = await amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host } });
  assert.equal(resposta.statusCode, 200, resposta.body);
  const meta = resposta.json();
  assert.equal(meta.issuer, APP_URL);
  assert.equal(meta.authorization_endpoint, `${APP_URL}/oauth/authorize`);
  assert.equal(meta.token_endpoint, `${APP_URL}/oauth/token`);
  assert.equal(meta.revocation_endpoint, `${APP_URL}/oauth/revoke`);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.deepEqual(meta.response_types_supported, ["code"]);
  assert.ok(!("registration_endpoint" in meta), "DCR deve estar desligado por padrão");
  assert.ok(meta.scopes_supported.includes("mcp:read"));
});

test("fluxo completo: authorize → consentimento do painel → code com iss → token → refresh", async () => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge, state: "meu-estado" });
  assert.ok(passo.final);
  assert.equal(passo.final.statusCode, 303, passo.final.body);
  const retorno = new URL(String(passo.final.headers.location));
  assert.equal(`${retorno.origin}${retorno.pathname}`, CLIENTE_PUBLICO.redirect_uris[0]);
  assert.equal(retorno.searchParams.get("state"), "meu-estado");
  assert.equal(retorno.searchParams.get("iss"), APP_URL, "RFC 9207: iss na resposta de autorização");
  const code = retorno.searchParams.get("code")!;
  assert.ok(code);

  const troca = await trocarCodigo(amb, { code, verifier, resource: recurso });
  assert.equal(troca.statusCode, 200, troca.body);
  const tokens = troca.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.access_token && tokens.refresh_token);
  assert.ok(tokens.expires_in <= 3600);
  assert.equal(tokens.scope, "mcp:read");
  assert.equal(troca.headers["cache-control"], "no-store");

  // Segredos só como hash no banco.
  const { rows } = await amb.db.query("SELECT tipo, id, payload::text AS payload FROM dna_work.mcp_oauth_registro");
  for (const linha of rows) {
    assert.ok(!String(linha.id).includes(tokens.access_token), "token em texto puro no id");
    assert.ok(!String(linha.payload).includes(tokens.access_token), "token em texto puro no payload");
    assert.ok(!String(linha.payload).includes(tokens.refresh_token), "refresh em texto puro no payload");
    assert.ok(!String(linha.payload).includes(code), "code em texto puro");
  }

  const novo = await renovar(amb, { refresh: tokens.refresh_token, resource: recurso });
  assert.equal(novo.statusCode, 200, novo.body);
  assert.notEqual(novo.json().refresh_token, tokens.refresh_token, "refresh deve rotacionar");
});

test("PKCE: exige code_challenge S256; plain e ausência são recusados; verifier errado falha", async () => {
  const { challenge } = pkce();
  const plain = await autorizar(amb, { resource: recurso, challenge, method: "plain" });
  assert.equal(plain.statusCode, 303);
  assert.match(String(plain.headers.location), /error=/);
  assert.match(String(plain.headers.location), /iss=/);

  const semPkce = await amb.app.inject({
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: CLIENTE_PUBLICO.client_id, redirect_uri: CLIENTE_PUBLICO.redirect_uris[0], scope: "mcp:read", resource: recurso, state: "x" })}`,
    headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host },
  });
  assert.equal(semPkce.statusCode, 303);
  assert.match(String(semPkce.headers.location), /error=invalid_request/);

  const certo = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge: certo.challenge });
  const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
  const errado = await trocarCodigo(amb, { code, verifier: pkce().verifier, resource: recurso });
  assert.equal(errado.statusCode, 400);
  assert.equal(errado.json().error, "invalid_grant");
});

test("resource é obrigatório e precisa ser exatamente a URL de uma integração ativa", async () => {
  const { challenge } = pkce();
  const sem = await autorizar(amb, { resource: null, challenge });
  assert.match(String(sem.headers.location), /error=invalid_target/);
  for (const ruim of [`${MCP_URL}/mcp/inexistente`, `${MCP_URL}/outro/recrutamento`, `${MCP_URL}/mcp/recrutamento/`, "https://evil.example/mcp/recrutamento", `${MCP_URL}/mcp/RECRUTAMENTO`]) {
    const r = await autorizar(amb, { resource: ruim, challenge });
    assert.match(String(r.headers.location), /error=invalid_target/, `aceitou resource ${ruim}`);
  }
  const { rows } = await amb.db.query("SELECT id FROM dna_work.mcp_integracao WHERE slug = 'outra'");
  await amb.app.mcp!.integracoes.definirAtiva(rows[0].id, false);
  const desativada = await autorizar(amb, { resource: `${MCP_URL}/mcp/outra`, challenge });
  assert.match(String(desativada.headers.location), /error=invalid_target/);
  await amb.app.mcp!.integracoes.definirAtiva(rows[0].id, true);
});

test("redirect_uri exata: variações são recusadas sem redirecionar para o endereço informado", async () => {
  const { challenge } = pkce();
  for (const uri of [`${CLIENTE_PUBLICO.redirect_uris[0]}/`, `${CLIENTE_PUBLICO.redirect_uris[0]}?x=1`, "https://cliente.test.local/callback2", "https://evil.example/callback", "http://cliente.test.local/callback"]) {
    const r = await autorizar(amb, { resource: recurso, challenge, redirectUri: uri });
    assert.notEqual(r.statusCode, 303, `redirecionou com ${uri}`);
    assert.ok(!String(r.headers.location ?? "").includes("evil.example"));
    assert.ok(r.statusCode >= 400, `status ${r.statusCode} para ${uri}`);
  }
});

test("código de uso único: reutilizar recusa e revoga os tokens já emitidos", async () => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge });
  const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
  const primeira = await trocarCodigo(amb, { code, verifier, resource: recurso });
  assert.equal(primeira.statusCode, 200);
  const segunda = await trocarCodigo(amb, { code, verifier, resource: recurso });
  assert.equal(segunda.statusCode, 400);
  assert.equal(segunda.json().error, "invalid_grant");
  // O refresh da primeira troca também foi revogado (grant inteiro).
  const refresh = await renovar(amb, { refresh: primeira.json().refresh_token, resource: recurso });
  assert.equal(refresh.statusCode, 400);
});

test("concorrência: 8 trocas simultâneas do mesmo code geram no máximo um token", async () => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge });
  const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
  const respostas = await Promise.all(Array.from({ length: 8 }, () => trocarCodigo(amb, { code, verifier, resource: recurso })));
  const sucessos = respostas.filter((r) => r.statusCode === 200);
  assert.ok(sucessos.length <= 1, `${sucessos.length} sucessos para o mesmo código`);
  assert.ok(respostas.every((r) => r.statusCode === 200 || r.statusCode === 400));
});

test("refresh token: rotação, reuso do antigo revoga a cadeia e concorrência gera uma só renovação", async () => {
  const t1 = await obterTokens(amb, ana, recurso);
  const r2 = await renovar(amb, { refresh: t1.refresh_token, resource: recurso });
  assert.equal(r2.statusCode, 200, r2.body);
  const t2 = r2.json();
  // Reuso do refresh antigo = suspeita de roubo: recusa e derruba a cadeia (inclusive o novo).
  const reuso = await renovar(amb, { refresh: t1.refresh_token, resource: recurso });
  assert.equal(reuso.statusCode, 400);
  const novoDepois = await renovar(amb, { refresh: t2.refresh_token, resource: recurso });
  assert.equal(novoDepois.statusCode, 400, "a cadeia deveria ter sido revogada");

  const t3 = await obterTokens(amb, ana, recurso);
  const corrida = await Promise.all(Array.from({ length: 8 }, () => renovar(amb, { refresh: t3.refresh_token, resource: recurso })));
  assert.ok(corrida.filter((r) => r.statusCode === 200).length <= 1, "refresh concorrente deu mais de um sucesso");
});

test("revogação (RFC 7009) invalida o refresh token", async () => {
  const t = await obterTokens(amb, ana, recurso);
  const r = await amb.app.inject({
    method: "POST", url: "/oauth/revoke",
    headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host, "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({ token: t.refresh_token, token_type_hint: "refresh_token", client_id: CLIENTE_PUBLICO.client_id }).toString(),
  });
  assert.equal(r.statusCode, 200, r.body);
  const depois = await renovar(amb, { refresh: t.refresh_token, resource: recurso });
  assert.equal(depois.statusCode, 400);
});

test("cliente confidencial exige o segredo; sem ele a troca falha", async () => {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge, clientId: CLIENTE_CONFIDENCIAL.client_id });
  const code = new URL(String(passo.final!.headers.location)).searchParams.get("code")!;
  const sem = await trocarCodigo(amb, { code, verifier, resource: recurso, clientId: CLIENTE_CONFIDENCIAL.client_id });
  assert.equal(sem.statusCode, 401);
  const errado = await trocarCodigo(amb, { code, verifier, resource: recurso, clientId: CLIENTE_CONFIDENCIAL.client_id, segredo: "x".repeat(40) });
  assert.equal(errado.statusCode, 401);
});

test("DCR está desligado por padrão", async () => {
  const r = await amb.app.inject({
    method: "POST", url: "/oauth/register",
    headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host, "content-type": "application/json" },
    payload: JSON.stringify({ redirect_uris: ["https://x.test.local/cb"], token_endpoint_auth_method: "none" }),
  });
  assert.ok(r.statusCode >= 400, `DCR respondeu ${r.statusCode}`);
});

test("consentimento: só usuário real, ativo e vinculado aprova; bootstrap-admin e não vinculado são recusados", async () => {
  const { challenge } = pkce();
  const inicio = await autorizar(amb, { resource: recurso, challenge });
  const uid = uidDoRedirect(String(inicio.headers.location));

  const semSessao = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}` });
  assert.equal(semSessao.statusCode, 401);

  const boot = await loginBootstrap(amb);
  const verBoot = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}`, headers: { cookie: boot } });
  assert.equal(verBoot.statusCode, 200);
  assert.equal(verBoot.json().data.pode, false, "bootstrap-admin não pode usar o MCP");
  const aprovaBoot = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: boot, origin: APP_URL }, payload: { aprovar: true } });
  assert.equal(aprovaBoot.statusCode, 403);

  const naoVinculada = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: bia.cookie, origin: APP_URL }, payload: { aprovar: true } });
  assert.equal(naoVinculada.statusCode, 403);
  const ver = await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}`, headers: { cookie: ana.cookie } });
  assert.equal(ver.json().data.pode, true);
  assert.equal(ver.json().data.aplicativo.nome, CLIENTE_PUBLICO.client_name);

  // CSRF: sem o Origin do painel, nada de aprovar.
  const semOrigem = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie }, payload: { aprovar: true } });
  assert.equal(semOrigem.statusCode, 403);
  const outraOrigem = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie, origin: "https://evil.example" }, payload: { aprovar: true } });
  assert.equal(outraOrigem.statusCode, 403);

  // Usuário desativado entre o login e a decisão: bloqueado.
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = false WHERE id = $1", [ana.id]);
  const inativo = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie, origin: APP_URL }, payload: { aprovar: true } });
  assert.ok(inativo.statusCode === 403, `status ${inativo.statusCode}`);
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = true WHERE id = $1", [ana.id]);
});

test("negar o acesso devolve access_denied ao cliente com iss", async () => {
  const { challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, ana, { resource: recurso, challenge, aprovar: false });
  assert.ok(passo.final);
  const retorno = new URL(String(passo.final.headers.location));
  assert.equal(retorno.searchParams.get("error"), "access_denied");
  assert.equal(retorno.searchParams.get("iss"), APP_URL);
  assert.ok(!retorno.searchParams.get("code"));
});

test("uma sessão do painel não vira acesso se o navegador que retoma não é o mesmo (sem cookie de retomada)", async () => {
  const { challenge } = pkce();
  const inicio = await autorizar(amb, { resource: recurso, challenge });
  const uid = uidDoRedirect(String(inicio.headers.location));
  const decisao = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie, origin: APP_URL }, payload: { aprovar: true } });
  assert.equal(decisao.statusCode, 200);
  const outroNavegador = await amb.app.inject({ method: "GET", url: `/oauth/authorize/${uid}`, headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host } });
  assert.ok(!String(outroNavegador.headers.location ?? "").includes("code="), "retomou sem o cookie do navegador original");
});
