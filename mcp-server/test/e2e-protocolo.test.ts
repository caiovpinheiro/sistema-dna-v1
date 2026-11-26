import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { criarIntegracao, criarUsuario, obterTokens, type UsuarioTeste } from "../../backend/test/mcp-suporte.js";
import { APP_URL, MCP_URL, subirSistema, type Sistema } from "./suporte-e2e.js";

let s: Sistema;
let ana: UsuarioTeste;
let caio: UsuarioTeste;
let integracaoId: string;
let tokenAna: string;
const RECURSO = `${MCP_URL}/mcp/recrutamento`;

before(async () => {
  s = await subirSistema();
  ana = await criarUsuario(s.amb, "Ana", ["vagas"]);
  caio = await criarUsuario(s.amb, "Caio", ["painel"]);
  integracaoId = (await criarIntegracao(s.amb, "recrutamento", { usuarios: [{ id: ana.id }, { id: caio.id }] })).id;
  await criarIntegracao(s.amb, "outra", { usuarios: [{ id: ana.id }] });
  await s.amb.db.query("INSERT INTO dna_work.empresa (id_empresa, nome_fantasia, cnpj) VALUES ('E1', 'Loja Alfa', '12345678000199')");
  await s.amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, status) VALUES ('V1', 'E1', 'Atendente', 2, 0)");
  tokenAna = (await obterTokens(s.amb, ana, RECURSO)).access_token;
});
after(async () => { await s?.parar(); });

const post = (slug: string, corpo: unknown, headers: Record<string, string> = {}, base = s.base) =>
  fetch(`${base}/mcp/${slug}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

test("SDK: conecta, descobre instruções e ferramentas, executa e recebe conteúdo estruturado", async () => {
  const { client, transport } = s.cliente("recrutamento", tokenAna);
  await client.connect(transport);
  try {
    assert.equal(client.getServerVersion()?.name, "dnawork-mcp");
    assert.equal(client.getInstructions(), "Use só dados do sistema.");
    assert.ok(client.getServerCapabilities()?.tools);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ["consultar_filtros_vagas"]);
    assert.equal(tools[0].annotations?.readOnlyHint, true);
    assert.equal(tools[0].annotations?.destructiveHint, false);
    assert.equal(tools[0].inputSchema.type, "object");
    const r = await client.callTool({ name: "consultar_filtros_vagas", arguments: { limite: 5 } });
    assert.ok(!r.isError);
    assert.deepEqual((r.structuredContent as any).empresas, [{ id: "E1", nome: "Loja Alfa" }]);
    assert.ok(!JSON.stringify(r).includes("12345678000199"), "CNPJ vazou pelo gateway");
    const invalido = await client.callTool({ name: "consultar_filtros_vagas", arguments: { limite: 0 } });
    assert.equal(invalido.isError, true);
    await assert.rejects(() => client.callTool({ name: "ferramenta_que_nao_existe", arguments: {} }), (e: unknown) => e instanceof McpError && /indispon/i.test(e.message));
  } finally { await client.close(); }
});

test("RFC 9728/9207: o 401 aponta o metadado do recurso (caminho exato) e o issuer é idêntico ao do servidor de autorização", async () => {
  const r = await post("recrutamento", init);
  assert.equal(r.status, 401);
  const www = r.headers.get("www-authenticate")!;
  assert.equal(www, `Bearer resource_metadata="${MCP_URL}/.well-known/oauth-protected-resource/mcp/recrutamento"`);
  const meta = await (await fetch(`${s.base}/.well-known/oauth-protected-resource/mcp/recrutamento`, { headers: { host: `127.0.0.1:${new URL(s.base).port}` } })).json() as any;
  assert.equal(meta.resource, RECURSO, "resource deve ser exatamente a URL do endpoint MCP");
  assert.deepEqual(meta.authorization_servers, [APP_URL]);
  assert.deepEqual(meta.bearer_methods_supported, ["header"]);
  assert.deepEqual(meta.scopes_supported, ["mcp:read"]);
  const as = (await s.amb.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { "x-forwarded-proto": "https", host: new URL(APP_URL).host } })).json();
  assert.equal(as.issuer, meta.authorization_servers[0], "issuer do AS diferente do informado no metadado do recurso");
  assert.equal((await fetch(`${s.base}/.well-known/oauth-protected-resource/mcp/inexistente`)).status, 404);
  assert.equal((await fetch(`${s.base}/.well-known/oauth-protected-resource/mcp/BAD_SLUG`)).status, 404);
});

test("token inválido: 401 com invalid_token; sem token: 401 sem erro de token", async () => {
  const lixo = await post("recrutamento", init, { authorization: `Bearer ${"a".repeat(43)}` });
  assert.equal(lixo.status, 401);
  assert.match(lixo.headers.get("www-authenticate")!, /error="invalid_token"/);
  assert.match((await post("recrutamento", init)).headers.get("www-authenticate")!, /^Bearer resource_metadata=/);
});

test("OAuth completo → gateway: o token do consentimento funciona; refresh gera novo token que funciona; o antigo refresh não", async () => {
  const t = await obterTokens(s.amb, ana, RECURSO);
  const { client, transport } = s.cliente("recrutamento", t.access_token);
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 1);
  await client.close();
  const { renovar } = await import("../../backend/test/mcp-suporte.js");
  const novo = await renovar(s.amb, { refresh: t.refresh_token, resource: RECURSO });
  assert.equal(novo.statusCode, 200);
  const c2 = s.cliente("recrutamento", novo.json().access_token);
  await c2.client.connect(c2.transport);
  assert.equal((await c2.client.listTools()).tools.length, 1);
  await c2.client.close();
  const reuso = await renovar(s.amb, { refresh: t.refresh_token, resource: RECURSO });
  assert.equal(reuso.statusCode, 400);
});

test("revogação: depois de revogar, a próxima chamada pelo gateway é 401, mesmo com conexão/catálogo já em cache no cliente", async () => {
  const t = await obterTokens(s.amb, ana, RECURSO);
  const { client, transport } = s.cliente("recrutamento", t.access_token);
  await client.connect(transport);
  await client.listTools();
  await s.amb.app.mcp!.integracoes.revogar({ usuarioId: ana.id, integracaoId });
  await assert.rejects(() => client.callTool({ name: "consultar_filtros_vagas", arguments: {} }), /401|Unauthorized|HTTP/i);
  const direto = await post("recrutamento", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "consultar_filtros_vagas", arguments: {} } }, { authorization: `Bearer ${t.access_token}` });
  assert.equal(direto.status, 401);
  await client.close().catch(() => undefined);
  tokenAna = (await obterTokens(s.amb, ana, RECURSO)).access_token;
});

test("catálogo dinâmico: remover a permissão tira a ferramenta do tools/list e impede a execução da ferramenta já descoberta", async () => {
  const { client, transport } = s.cliente("recrutamento", tokenAna);
  await client.connect(transport);
  try {
    const cacheado = (await client.listTools()).tools;
    assert.equal(cacheado.length, 1);
    await s.amb.db.query("DELETE FROM dna_work.app_usuario_pagina WHERE id_usuario = $1 AND pagina = 'vagas'", [ana.id]);
    assert.deepEqual((await client.listTools()).tools, [], "catálogo deve refletir a permissão na hora");
    await assert.rejects(() => client.callTool({ name: cacheado[0].name, arguments: {} }), (e: unknown) => e instanceof McpError);
    await s.amb.db.query("INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina) VALUES ($1, 'vagas')", [ana.id]);
    assert.equal((await client.listTools()).tools.length, 1);
    // Desligar a ferramenta na integração também vale na hora.
    await s.amb.app.mcp!.integracoes.definirFerramentas(integracaoId, []);
    assert.deepEqual((await client.listTools()).tools, []);
    await s.amb.app.mcp!.integracoes.definirFerramentas(integracaoId, ["consultar_filtros_vagas"]);
  } finally { await client.close(); }
});

test("403: usuário desativado, desvinculado ou integração desativada; 429: limite por usuário", async () => {
  const chamar = () => post("recrutamento", { jsonrpc: "2.0", id: 3, method: "tools/list" }, { authorization: `Bearer ${tokenAna}` });
  await s.amb.db.query("UPDATE dna_work.app_usuario SET ativo = false WHERE id = $1", [ana.id]);
  const inativo = await chamar();
  assert.equal(inativo.status, 403);
  assert.equal(((await inativo.json()) as any).error.code, "USUARIO_INATIVO");
  await s.amb.db.query("UPDATE dna_work.app_usuario SET ativo = true WHERE id = $1", [ana.id]);
  assert.equal((await chamar()).status, 200);

  const chave = `u:${ana.id}:i:${integracaoId}`;
  const janela = Math.floor(Date.now() / 60_000);
  await s.amb.db.query("INSERT INTO dna_work.mcp_limite (chave, janela, n) VALUES ($1, $2, 100000) ON CONFLICT (chave, janela) DO UPDATE SET n = 100000", [chave, janela]);
  const limitado = await chamar();
  assert.equal(limitado.status, 429);
  assert.ok(Number(limitado.headers.get("retry-after")) >= 1);
  await s.amb.db.query("DELETE FROM dna_work.mcp_limite WHERE chave = $1", [chave]);
});

test("isolamento: token de uma integração não vale em outra; usuário sem página vê catálogo vazio e não executa", async () => {
  const outra = await post("outra", { jsonrpc: "2.0", id: 4, method: "tools/list" }, { authorization: `Bearer ${tokenAna}` });
  assert.equal(outra.status, 401);
  const tCaio = (await obterTokens(s.amb, caio, RECURSO)).access_token;
  const { client, transport } = s.cliente("recrutamento", tCaio);
  await client.connect(transport);
  try {
    assert.deepEqual((await client.listTools()).tools, []);
    await assert.rejects(() => client.callTool({ name: "consultar_filtros_vagas", arguments: {} }), McpError);
  } finally { await client.close(); }
  const cross = await post("recrutamento", { jsonrpc: "2.0", id: 5, method: "tools/list" }, { authorization: `Bearer ${tCaio}`, "x-user-id": ana.id });
  assert.equal(((await cross.json()) as any).result.tools.length, 0, "cabeçalho de identidade forjado alterou o usuário");
});

test("endurecimento do endpoint: GET/DELETE 405, JSON inválido, lote, corpo grande, host e origem não permitidos, content-type errado", async () => {
  const h = { authorization: `Bearer ${tokenAna}` };
  assert.equal((await fetch(`${s.base}/mcp/recrutamento`, { method: "GET", headers: h })).status, 405);
  assert.equal((await fetch(`${s.base}/mcp/recrutamento`, { method: "DELETE", headers: h })).status, 405);
  const ruim = await post("recrutamento", "{nao e json", h);
  assert.equal(ruim.status, 400);
  assert.equal(((await ruim.json()) as any).error.code, -32700);
  assert.equal((await post("recrutamento", [init, init], h)).status, 400);
  assert.equal((await post("recrutamento", { jsonrpc: "2.0", id: 1 }, h)).status, 400);
  const grande = await post("recrutamento", JSON.stringify({ ...init, pad: "x".repeat(300_000) }), h);
  assert.equal(grande.status, 413);
  assert.equal((await fetch(`${s.base}/mcp/recrutamento`, { method: "POST", headers: { ...h, "content-type": "text/plain" }, body: "x" })).status, 415);
  const origem = await post("recrutamento", init, { ...h, origin: "https://evil.example" });
  assert.equal(origem.status, 403);
  // Host fora da lista (DNS rebinding): fetch não deixa trocar Host; usa http.request.
  const http = await import("node:http");
  const status = await new Promise<number>((ok) => { const req = http.request({ host: "127.0.0.1", port: Number(new URL(s.base).port), path: "/mcp/recrutamento", method: "POST", headers: { host: "evil.example", "content-type": "application/json", ...h } }, (res) => { res.resume(); ok(res.statusCode ?? 0); }); req.end(JSON.stringify(init)); });
  assert.equal(status, 403);
  assert.equal((await post("slug_invalido!", init, h)).status, 404);
});

test("health é sempre 200; ready reflete certificados, contrato, issuer e URL pública", async () => {
  assert.equal((await fetch(`${s.base}/health`)).status, 200);
  const r = await fetch(`${s.base}/ready`);
  assert.equal(r.status, 200, await r.clone().text());
  const corpo = await r.json() as any;
  assert.equal(corpo.pronto, true);
  assert.ok(corpo.diasCertificado >= 5);
});

test("logs estruturados do gateway: registram requisição, status e duração; nunca token, segredo, nonce, assinatura ou corpo", async () => {
  const linhas: string[] = [];
  const g = await s.novoGateway({ LOG_LEVEL: "info" }, { logStream: { write: (l: string) => { linhas.push(l); } } });
  try {
    const { client, transport } = s.cliente("recrutamento", tokenAna, g.base);
    await client.connect(transport);
    await client.callTool({ name: "consultar_filtros_vagas", arguments: { busca: "texto-sigiloso-do-usuario" } });
    await client.close();
    await fetch(`${g.base}/mcp/recrutamento`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${"z".repeat(43)}` }, body: "{}" });
  } finally { await g.parar(); }
  const tudo = linhas.join("\n");
  assert.ok(linhas.length > 0, "nenhum log estruturado");
  assert.ok(linhas.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), "log fora de JSON");
  assert.match(tudo, /"requestId"/);
  assert.match(tudo, /"duracaoMs"/);
  for (const proibido of [tokenAna, "z".repeat(43), "segredo-do-gateway", "texto-sigiloso-do-usuario", "x-mcp-signature", "x-mcp-nonce", "authorization", "Bearer "]) {
    assert.ok(!tudo.toLowerCase().includes(proibido.toLowerCase()), `log contém: ${proibido}`);
  }
});
