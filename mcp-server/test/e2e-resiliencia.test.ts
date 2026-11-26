import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import test, { after, before } from "node:test";
import { criarIntegracao, criarReplica, criarUsuario, obterTokens, type UsuarioTeste } from "../../backend/test/mcp-suporte.js";
import { ProxyTcp, SEGREDO_GW, portaLivre, subirSistema, type Sistema } from "./suporte-e2e.js";
import { MCP_URL } from "./suporte-e2e.js";

const RECURSO = `${MCP_URL}/mcp/recrutamento`;
const capturas: Array<{ method: string; url: string; headers: Record<string, unknown>; body: Buffer }> = [];
let s: Sistema;
let ana: UsuarioTeste;
let token: string;

before(async () => {
  s = await subirSistema({ aoCriarMonolito: (app) => { app.addHook("preHandler", async (req) => { capturas.push({ method: req.method, url: req.raw.url ?? "", headers: { ...req.headers }, body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) }); }); } });
  ana = await criarUsuario(s.amb, "Ana", ["vagas"]);
  await criarIntegracao(s.amb, "recrutamento", { usuarios: [{ id: ana.id }] });
  token = (await obterTokens(s.amb, ana, RECURSO)).access_token;
});
after(async () => { await s?.parar(); });

const lista = (base: string, t = token) => fetch(`${base}/mcp/recrutamento`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) { const v = await fn(); if (ok(v) || Date.now() > fim) return v; await esperar(150); }
}
const mutavel = (nome: string, par: { cert: string; key: string }) => {
  const dir = fs.mkdtempSync(path.join(s.pki.dir, `${nome}-`));
  const cert = path.join(dir, "cert.pem"); const key = path.join(dir, "key.pem");
  fs.copyFileSync(par.cert, cert); fs.copyFileSync(par.key, key);
  return { dir, cert, key };
};

// ---------------------------------------------------------------- indisponibilidade do monólito

test("monólito indisponível: 503 controlado com Retry-After, /health segue 200, /ready 503, sem queda do gateway; volta sozinho", async () => {
  const proxy = new ProxyTcp(await portaLivre(), s.portaMonolito);
  await proxy.iniciar();
  const g = await s.novoGateway({ MONOLITO_INTERNAL_URL: `https://localhost:${proxy.porta}` });
  try {
    assert.equal((await lista(g.base)).status, 200);
    assert.equal((await fetch(`${g.base}/ready`)).status, 200);
    await proxy.parar();
    const r = await lista(g.base);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("retry-after"), "5");
    assert.equal(((await r.json()) as any).error.code, "MONOLITO_INDISPONIVEL");
    assert.equal((await fetch(`${g.base}/health`)).status, 200);
    assert.equal((await fetch(`${g.base}/ready`)).status, 503);
    assert.equal((await fetch(`${g.base}/.well-known/oauth-protected-resource/mcp/recrutamento`, { headers: { host: `127.0.0.1:${new URL(g.base).port}` } })).status, 503);
    // O painel não é afetado por nada disso.
    assert.equal((await s.amb.app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    await proxy.iniciar();
    const voltou = await ate(() => lista(g.base), (x) => x.status === 200);
    assert.equal(voltou.status, 200);
    assert.equal((await ate(() => fetch(`${g.base}/ready`), (x) => x.status === 200)).status, 200);
  } finally { await g.parar(); await proxy.parar(); }
});

test("monólito que aceita a conexão e não responde: timeout controlado (503), sem pendurar o gateway", async () => {
  const proxy = new ProxyTcp(await portaLivre(), s.portaMonolito);
  proxy.modo = "buraco-negro";
  await proxy.iniciar();
  const g = await s.novoGateway({ MONOLITO_INTERNAL_URL: `https://localhost:${proxy.porta}`, REQUEST_TIMEOUT_MS: "1500", CONNECT_TIMEOUT_MS: "800" });
  try {
    const inicio = Date.now();
    const r = await lista(g.base);
    assert.equal(r.status, 503);
    assert.ok(Date.now() - inicio < 5000, "demorou demais para falhar");
    assert.equal((await fetch(`${g.base}/health`)).status, 200);
  } finally { await g.parar(); await proxy.parar(); }
});

// ---------------------------------------------------------------- reinícios independentes

test("reinício do gateway: sem sessão em memória; o mesmo token continua valendo no gateway novo", async () => {
  const a = await s.novoGateway();
  assert.equal((await lista(a.base)).status, 200);
  await a.parar();
  await assert.rejects(() => lista(a.base));
  const b = await s.novoGateway();
  assert.equal((await lista(b.base)).status, 200);
});

test("reinício do monólito (outra instância sobre o mesmo banco): tokens, JWKS e permissões continuam; o gateway só reconecta", async () => {
  const proxy = new ProxyTcp(await portaLivre(), s.portaMonolito);
  await proxy.iniciar();
  const g = await s.novoGateway({ MONOLITO_INTERNAL_URL: `https://localhost:${proxy.porta}` });
  const replica = await criarReplica(s.amb);
  try {
    assert.equal((await lista(g.base)).status, 200);
    await replica.app.mcp!.interno.listen({ port: 0, host: "127.0.0.1" });
    const nova = (replica.app.mcp!.interno.server.address() as import("node:net").AddressInfo).port;
    await proxy.parar();
    proxy.destino = nova;
    await proxy.iniciar();
    const r = await ate(() => lista(g.base), (x) => x.status === 200);
    assert.equal(r.status, 200, "token emitido pela instância antiga deveria valer na nova");
  } finally { await g.parar(); await proxy.parar(); await replica.fechar(); }
});

// ---------------------------------------------------------------- certificados

test("certificado de cliente ausente: o gateway sobe, /health ok, /ready e chamadas 503 (falha fechada, sem queda)", async () => {
  const g = await s.novoGateway({ MCP_TLS_CERT: path.join(s.pki.dir, "nao-existe.pem") });
  assert.equal((await fetch(`${g.base}/health`)).status, 200);
  const ready = await fetch(`${g.base}/ready`);
  assert.equal(ready.status, 503);
  assert.match(JSON.stringify(await ready.json()), /certificado: não foi possível ler/);
  const r = await lista(g.base);
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as any).error.code, "CERTIFICADO_INVALIDO");
  await g.parar();
});

test("certificado de cliente expirado (relógio) e ainda não válido: chamadas 503 e nada sai pela rede", async () => {
  const vencido = s.pki.emitir("gw-vencido", { tipo: "cliente", cn: "gateway-mcp", inicio: "20200101000000Z", fim: "20200102000000Z" });
  const futuro = s.pki.emitir("gw-futuro", { tipo: "cliente", cn: "gateway-mcp", inicio: "20990101000000Z", fim: "20991231000000Z" });
  for (const [nome, par, re] of [["vencido", vencido, /expirado/], ["futuro", futuro, /ainda não é válido/]] as const) {
    const g = await s.novoGateway({ MCP_TLS_CERT: par.cert, MCP_TLS_KEY: par.key });
    const r = await lista(g.base);
    assert.equal(r.status, 503, nome);
    assert.match(JSON.stringify(await (await fetch(`${g.base}/ready`)).json()), re, nome);
    await g.parar();
  }
  // Relógio injetado: o certificado válido deixa de valer quando o tempo passa.
  const g = await s.novoGateway({}, { relogio: () => new Date(Date.now() + 30 * 86_400_000) });
  assert.equal((await lista(g.base)).status, 503, "certificado vencido pelo relógio ainda funcionou");
  await g.parar();
});

test("cliente com certificado de CA desconhecida, ou CN fora da lista, ou servidor com SAN diferente: 503 e o monólito nunca é alcançado", async () => {
  const estranha = s.pki.novaCa("ca-estranha").emitir("gw-estranho", { tipo: "cliente", cn: "gateway-mcp" });
  const intruso = s.pki.emitir("gw-intruso", { tipo: "cliente", cn: "intruso" });
  const antes = capturas.length;
  const casos: Array<[string, Record<string, string>, string]> = [
    ["CA desconhecida", { MCP_TLS_CERT: estranha.cert, MCP_TLS_KEY: estranha.key }, "CERTIFICADO_INVALIDO"],
    ["CN não permitido", { MCP_TLS_CERT: intruso.cert, MCP_TLS_KEY: intruso.key }, "CONFIGURACAO_INVALIDA"],
    ["SAN diferente", { MONOLITO_TLS_SERVERNAME: "monolito.nome-errado.interno" }, "CERTIFICADO_INVALIDO"],
  ];
  for (const [nome, env, codigo] of casos) {
    const g = await s.novoGateway(env);
    const r = await lista(g.base);
    assert.equal(r.status, 503, nome);
    const c = ((await r.json()) as any).error.code;
    assert.ok(c === codigo || c === "MONOLITO_INDISPONIVEL", `${nome}: ${c}`);
    await g.parar();
  }
  assert.equal(capturas.length, antes, "alguma chamada chegou ao monólito com identidade inválida");
});

test("CA do gateway diferente da que assinou o servidor: o gateway recusa o servidor (503)", async () => {
  const outra = s.pki.novaCa("ca-outra");
  const g = await s.novoGateway({ MCP_TLS_CA: outra.ca.cert });
  const r = await lista(g.base);
  assert.equal(r.status, 503);
  await g.parar();
});

test("renovação/rotação sem reiniciar: certificado inválido → gateway não pronto; troca por um válido → fica pronto sozinho", async () => {
  const vencido = s.pki.emitir("rot-vencido", { tipo: "cliente", cn: "gateway-mcp", inicio: "20200101000000Z", fim: "20200102000000Z" });
  const arq = mutavel("rot", vencido);
  const g = await s.novoGateway({ MCP_TLS_CERT: arq.cert, MCP_TLS_KEY: arq.key });
  try {
    assert.equal((await fetch(`${g.base}/ready`)).status, 503);
    assert.equal((await lista(g.base)).status, 503);
    const novo = s.pki.emitir("rot-novo", { tipo: "cliente", cn: "gateway-mcp" });
    fs.copyFileSync(novo.cert, arq.cert);
    fs.copyFileSync(novo.key, arq.key);
    const pronto = await ate(() => fetch(`${g.base}/ready`), (x) => x.status === 200, 10_000);
    assert.equal(pronto.status, 200);
    assert.equal((await lista(g.base)).status, 200);
  } finally { await g.parar(); }
});

// ---------------------------------------------------------------- replay

test("replay: nenhuma requisição repete nonce; reenviar uma requisição assinada capturada (com certificado válido) é recusado", async () => {
  capturas.length = 0;
  for (let i = 0; i < 5; i += 1) await lista(s.base);
  assert.ok(capturas.length >= 5);
  const nonces = capturas.map((c) => c.headers["x-mcp-nonce"]);
  assert.equal(new Set(nonces).size, nonces.length, "gateway reutilizou nonce");
  const ruidos = capturas.filter((c) => c.url.includes("/ferramentas"));
  assert.ok(ruidos.length);
  const alvo = ruidos[0];
  const reenviar = (corpo: Buffer, mexer: (h: Record<string, string>) => void = () => undefined) => new Promise<{ status: number; corpo: string }>((ok, falha) => {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(alvo.headers)) if (typeof v === "string" && !["host", "content-length", "connection"].includes(k)) h[k] = v;
    mexer(h);
    const req = https.request({ host: "127.0.0.1", port: s.portaMonolito, path: alvo.url, method: "POST", agent: false, servername: "localhost", ca: fs.readFileSync(s.certs.ca), cert: fs.readFileSync(s.certs.clienteCert), key: fs.readFileSync(s.certs.clienteKey), headers: { ...h, "content-length": String(corpo.length) } }, (res) => { let b = ""; res.on("data", (d) => { b += d; }); res.on("end", () => ok({ status: res.statusCode ?? 0, corpo: b })); });
    req.on("error", falha);
    req.end(corpo);
  });
  const igual = await reenviar(alvo.body);
  assert.equal(igual.status, 401, igual.corpo);
  assert.match(igual.corpo, /ASSINATURA_INVALIDA/);
  const corpoMexido = await reenviar(Buffer.from('{"x":1}'));
  assert.equal(corpoMexido.status, 401);
  const slugTrocado = alvo.url.replace("recrutamento", "outra");
  void slugTrocado;
  const semAuth = await reenviar(alvo.body, (h) => { delete h.authorization; });
  assert.equal(semAuth.status, 401);
});

// ---------------------------------------------------------------- processo (graceful shutdown, config, boot sem monólito)

function processo(env: Record<string, string>) {
  const filho = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: path.resolve(import.meta.dirname, ".."), env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  filho.stdout.on("data", (d) => { saida += d; });
  filho.stderr.on("data", (d) => { saida += d; });
  return { filho, saida: () => saida, codigo: new Promise<number | null>((ok) => filho.on("exit", (c) => ok(c))) };
}

test("processo real: sobe com o monólito, encerra com SIGTERM em código 0; sem monólito no boot continua no ar (sem reinício em laço)", async () => {
  const porta = await portaLivre();
  const env = (extra: Record<string, string> = {}) => ({
    NODE_ENV: "production", PORT: String(porta), HOST: "127.0.0.1", MCP_PUBLIC_URL: MCP_URL, MONOLITO_ISSUER_URL: "https://painel.test.local",
    MONOLITO_INTERNAL_URL: `https://localhost:${s.portaMonolito}`, MCP_GATEWAY_KEY_ID: "gw1", MCP_GATEWAY_SECRET: SEGREDO_GW,
    MCP_TLS_CA: s.certs.ca, MCP_TLS_CERT: s.certs.clienteCert, MCP_TLS_KEY: s.certs.clienteKey, LOG_LEVEL: "info", ...extra,
  });
  const p = processo(env());
  try {
    const ok = await ate(() => fetch(`http://127.0.0.1:${porta}/health`).catch(() => null), (r) => r !== null && r.status === 200, 20_000);
    assert.equal(ok?.status, 200, p.saida());
    assert.equal((await fetch(`http://127.0.0.1:${porta}/ready`)).status, 200);
    p.filho.kill("SIGTERM");
    assert.equal(await p.codigo, 0, p.saida());
    assert.ok(!p.saida().includes(SEGREDO_GW), "segredo nos logs");
    assert.ok(!p.saida().includes(token), "token nos logs");
  } finally { p.filho.kill("SIGKILL"); }

  const porta2 = await portaLivre();
  const q = processo({ ...env(), PORT: String(porta2), MONOLITO_INTERNAL_URL: "https://localhost:1" });
  try {
    const ok = await ate(() => fetch(`http://127.0.0.1:${porta2}/health`).catch(() => null), (r) => r !== null && r.status === 200, 20_000);
    assert.equal(ok?.status, 200, q.saida());
    assert.equal((await fetch(`http://127.0.0.1:${porta2}/ready`)).status, 503);
    await esperar(1500);
    assert.equal(q.filho.exitCode, null, "o gateway saiu por causa do monólito fora do ar");
    q.filho.kill("SIGTERM");
    assert.equal(await q.codigo, 0);
  } finally { q.filho.kill("SIGKILL"); }

  const r = processo({ ...env(), MCP_GATEWAY_SECRET: "curto" });
  assert.equal(await r.codigo, 1, "configuração inválida deve sair com erro");
  assert.ok(!r.saida().includes("curto") || /MCP_GATEWAY_SECRET/.test(r.saida()));
  const t = processo({ ...env(), MCP_TLS_CA: "", MCP_TLS_CERT: "", MCP_TLS_KEY: "" });
  assert.equal(await t.codigo, 1, "sem mTLS em produção o gateway não sobe");
  assert.match(t.saida(), /mTLS/);
});
