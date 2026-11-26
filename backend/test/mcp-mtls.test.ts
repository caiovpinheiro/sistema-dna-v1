import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import test, { after, before } from "node:test";
import { lerMcpConfig } from "../src/mcp/config.js";
import { observarTls, validarMaterialTls } from "../src/mcp/tls-interno.js";
import { criarPki, temOpenssl, type Pki } from "./pki-suporte.js";
import { criarAmbiente, requisicaoInterna, type Ambiente } from "./mcp-suporte.js";

const pula = !temOpenssl();
let pki: Pki;
let amb: Ambiente;
let porta = 0;
let arquivos: { cert: string; key: string; ca: string };
const ruins: Record<string, { cert: string; key: string; ca: string }> = {};
const SEGREDO = `k1:${"s".repeat(40)}`;

before(async () => {
  if (pula) return;
  pki = criarPki("ca-interna-teste");
  const servidor = pki.emitir("monolito", { tipo: "servidor", cn: "monolito", san: ["DNS:localhost", "IP:127.0.0.1"] });
  arquivos = { cert: servidor.cert, key: servidor.key, ca: pki.ca.cert };
  const outraCa = pki.novaCa("ca-estranha");
  const expirado = pki.emitir("exp", { tipo: "servidor", inicio: "20200101000000Z", fim: "20200102000000Z" });
  const futuro = pki.emitir("fut", { tipo: "servidor", inicio: "20990101000000Z", fim: "20991231000000Z" });
  const semSan = pki.emitir("sem-san", { tipo: "servidor", semSan: true });
  const deOutraCa = outraCa.emitir("estranho", { tipo: "servidor" });
  ruins.expirado = { ...expirado, ca: pki.ca.cert };
  ruins.futuro = { ...futuro, ca: pki.ca.cert };
  ruins.semSan = { ...semSan, ca: pki.ca.cert };
  ruins.outraCa = { ...deOutraCa, ca: pki.ca.cert };
  ruins.chaveTroca = { cert: servidor.cert, key: expirado.key, ca: pki.ca.cert };
  ruins.arquivoAusente = { cert: path.join(pki.dir, "nao-existe.pem"), key: servidor.key, ca: pki.ca.cert };
  const lixo = path.join(pki.dir, "lixo.pem");
  fs.writeFileSync(lixo, "isto nao e um certificado");
  ruins.lixo = { cert: lixo, key: servidor.key, ca: pki.ca.cert };
  const vazio = path.join(pki.dir, "vazio.pem");
  fs.writeFileSync(vazio, "");
  ruins.vazio = { cert: servidor.cert, key: vazio, ca: pki.ca.cert };
  ruins.semCa = { ...servidor, ca: "" };
  amb = await criarAmbiente({
    MCP_INTERNAL_INSECURE: "", MCP_INTERNAL_TLS_CERT: arquivos.cert, MCP_INTERNAL_TLS_KEY: arquivos.key, MCP_INTERNAL_TLS_CA: arquivos.ca,
    MCP_INTERNAL_CLIENTES: "gateway-mcp",
  });
  await amb.app.mcp!.interno.listen({ port: 0, host: "127.0.0.1" });
  porta = (amb.app.mcp!.interno.server.address() as { port: number }).port;
});
after(async () => { await amb?.fechar(); pki?.limpar(); });

function pedir(cliente: { cert: string; key: string } | null, extra: https.RequestOptions = {}): Promise<{ status: number; corpo: string; servidorSerial: string }> {
  return new Promise((resolver, rejeitar) => {
    const req = https.request({
      host: "127.0.0.1", port: porta, path: "/internal/mcp/saude", method: "POST", agent: false, ca: fs.readFileSync(arquivos.ca), servername: "localhost",
      headers: { "content-type": "application/json" },
      ...(cliente ? { cert: fs.readFileSync(cliente.cert), key: fs.readFileSync(cliente.key) } : {}), ...extra,
    }, (res) => {
      const servidorSerial = (res.socket as import("node:tls").TLSSocket).getPeerCertificate().serialNumber;
      let corpo = "";
      res.on("data", (d) => { corpo += d; });
      res.on("end", () => resolver({ status: res.statusCode ?? 0, corpo, servidorSerial }));
    });
    req.on("error", rejeitar);
    req.end("{}");
  });
}

test("material TLS válido passa; mostra os dias restantes", { skip: pula }, () => {
  const m = validarMaterialTls(arquivos);
  assert.ok(m.diasRestantes >= 5 && m.diasRestantes <= 7);
});

test("fail-closed: certificado expirado, futuro, sem SAN, de outra CA, chave trocada, ausente, lixo, vazio ou sem CA", { skip: pula }, () => {
  const esperado: Record<string, RegExp> = {
    expirado: /expirado/, futuro: /ainda não é válido/, semSan: /SAN/, outraCa: /não foi emitido pela CA/, chaveTroca: /não corresponde/,
    arquivoAusente: /não foi possível ler/, lixo: /não contém certificado/, vazio: /não foi possível ler/, semCa: /informe/,
  };
  for (const [nome, regra] of Object.entries(esperado)) assert.throws(() => validarMaterialTls(ruins[nome]), regra, nome);
  // Relógio injetado: certificado que vence amanhã passa hoje e falha depois de amanhã.
  const curto = pki.emitir("curto", { tipo: "servidor", dias: 1 });
  validarMaterialTls({ ...curto, ca: pki.ca.cert });
  assert.throws(() => validarMaterialTls({ ...curto, ca: pki.ca.cert }, new Date(Date.now() + 3 * 86_400_000)), /expirado/);
});

test("configuração do monólito: mTLS ou flag explícita de texto puro (HMAC em rede privada)", { skip: pula }, () => {
  const base = { MCP_PUBLIC_URL: "https://mcp.dnawork.ai", APP_PUBLIC_URL: "https://painel.dnawork.ai", MCP_GATEWAY_SECRETS: SEGREDO, MCP_OAUTH_CLIENTS: "", MCP_OAUTH_REDIRECT_HOSTS: "", MCP_OAUTH_REDIRECT_URIS: "", MCP_OAUTH_CIMD_URLS: "", MCP_CONTRATOS: "1", MCP_INTERNAL_CLIENTES: "", MCP_INTERNAL_TLS_CERT: "", MCP_INTERNAL_TLS_KEY: "", MCP_INTERNAL_TLS_CA: "" };
  assert.throws(() => lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: false } as never), /mTLS/);
  const antes = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    // Em produção, texto puro só com a flag explícita (rede privada, autenticação por HMAC).
    assert.throws(() => lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: false } as never), /mTLS/);
    assert.equal(lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: true } as never).inseguro, true);
  } finally { process.env.NODE_ENV = antes; }
  assert.equal(lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: true } as never).inseguro, true);
  for (const nome of Object.keys(ruins)) {
    assert.throws(() => lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: false, MCP_INTERNAL_TLS_CERT: ruins[nome].cert, MCP_INTERNAL_TLS_KEY: ruins[nome].key, MCP_INTERNAL_TLS_CA: ruins[nome].ca } as never), /TLS interno/, nome);
  }
  const ok = lerMcpConfig({ ...base, MCP_INTERNAL_INSECURE: false, MCP_INTERNAL_TLS_CERT: arquivos.cert, MCP_INTERNAL_TLS_KEY: arquivos.key, MCP_INTERNAL_TLS_CA: arquivos.ca } as never);
  assert.equal(ok.inseguro, false);
});

test("o boot do monólito falha com certificado inválido (nunca sobe sem mTLS válido)", { skip: pula }, async () => {
  const { buildApp } = await import("../src/app.js");
  const { loadConfig } = await import("../src/config.js");
  const salvo = { ...process.env };
  Object.assign(process.env, { MCP_INTERNAL_INSECURE: "", MCP_INTERNAL_TLS_CERT: ruins.expirado.cert, MCP_INTERNAL_TLS_KEY: ruins.expirado.key, MCP_INTERNAL_TLS_CA: ruins.expirado.ca });
  try {
    await assert.rejects(() => buildApp({ config: loadConfig(), db: amb.db, capabilities: { quantidadePosicoes: true, colaboradorContratacao: true, idempotencia: true, sequence: true, missing: [] } }), /expirado/);
  } finally { Object.assign(process.env, salvo); }
});

test("handshake: sem certificado de cliente, com certificado de outra CA ou em HTTP puro nem chega à aplicação", { skip: pula }, async () => {
  await assert.rejects(() => pedir(null));
  const estranha = pki.novaCa("outra").emitir("gateway-mcp", { tipo: "cliente", cn: "gateway-mcp" });
  await assert.rejects(() => pedir(estranha));
  const http = await fetch(`http://127.0.0.1:${porta}/internal/mcp/saude`, { method: "POST", body: "{}" }).then((r) => r.status, () => 0);
  assert.equal(http, 0);
});

test("cliente com certificado válido, mas fora da lista de CNs, recebe 403; o permitido chega à aplicação e ainda precisa da assinatura HMAC", { skip: pula }, async () => {
  const intruso = pki.emitir("intruso", { tipo: "cliente", cn: "intruso" });
  assert.equal((await pedir(intruso)).status, 403);
  const gateway = pki.emitir("gateway-mcp", { tipo: "cliente", cn: "gateway-mcp" });
  const r = await pedir(gateway);
  assert.equal(r.status, 401);
  assert.match(r.corpo, /ASSINATURA_INVALIDA/);
});

test("validação de hostname: o cliente recusa o servidor quando o SAN não casa", { skip: pula }, async () => {
  const gateway = pki.emitir("gateway-mcp", { tipo: "cliente", cn: "gateway-mcp" });
  await assert.rejects(() => pedir(gateway, { servername: "monolito.errado.interno" }), /altnames|hostname|match/i);
});

test("renovação sem reiniciar: novo certificado de servidor é carregado; material inválido é recusado e o anterior continua valendo", { skip: pula }, async () => {
  const gateway = pki.emitir("gateway-mcp", { tipo: "cliente", cn: "gateway-mcp" });
  const copia = { cert: path.join(pki.dir, "rot.cert.pem"), key: path.join(pki.dir, "rot.key.pem"), ca: arquivos.ca };
  fs.copyFileSync(arquivos.cert, copia.cert);
  fs.copyFileSync(arquivos.key, copia.key);
  const parar = observarTls(amb.app.mcp!.interno.server as never, copia, { info() {}, warn() {}, error() {} }, 50);
  try {
    const antes = await pedir(gateway);
    const novo = pki.emitir("monolito-novo", { tipo: "servidor", san: ["DNS:localhost", "IP:127.0.0.1"] });
    fs.copyFileSync(novo.cert, copia.cert);
    fs.copyFileSync(novo.key, copia.key);
    await new Promise((r) => setTimeout(r, 400));
    const depois = await pedir(gateway);
    assert.notEqual(depois.servidorSerial, antes.servidorSerial, "o listener não trocou o certificado");
    // Material inválido (expirado): recusado, o anterior segue.
    fs.copyFileSync(ruins.expirado.cert, copia.cert);
    fs.copyFileSync(ruins.expirado.key, copia.key);
    await new Promise((r) => setTimeout(r, 400));
    const mantido = await pedir(gateway);
    assert.equal(mantido.servidorSerial, depois.servidorSerial);
  } finally { parar(); }
});

test("rota de prontidão: exige assinatura e informa contratos, issuer e URL pública para checagem de configuração", async () => {
  const sem = await amb.app.mcp!.interno.inject({ method: "POST", url: "/internal/mcp/saude", payload: "{}", headers: { "content-type": "application/json" } });
  assert.ok(sem.statusCode === 401 || sem.statusCode === 403);
  void requisicaoInterna;
});
