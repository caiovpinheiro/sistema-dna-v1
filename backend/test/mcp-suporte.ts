import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "@node-rs/argon2";
import EmbeddedPostgres from "embedded-postgres";
import type { FastifyInstance } from "fastify";
import pg from "pg";

export const APP_URL = "https://painel.test.local";
export const MCP_URL = "https://mcp.test.local";
export const SEGREDO_ATUAL = "segredo-atual-segredo-atual-segredo-atual-0123456789";
export const SEGREDO_ANTIGO = "segredo-antigo-segredo-antigo-segredo-antigo-9876543210";
export const CLIENTE_PUBLICO = { client_id: "cliente-publico-teste", client_name: "Cliente Público", redirect_uris: ["https://cliente.test.local/callback"] };
export const CLIENTE_CONFIDENCIAL = {
  client_id: "cliente-confidencial-teste",
  client_secret: "s".repeat(40),
  client_name: "Cliente Confidencial",
  redirect_uris: ["https://cliente.test.local/callback"],
};
export const SENHA = "Senha-Teste-123";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Ambiente de teste: banco descartável (nunca produção), app real com MCP ligado. */
export type Ambiente = {
  app: FastifyInstance;
  db: pg.Pool;
  fechar(): Promise<void>;
  config: import("../src/config.js").AppConfig;
};

async function criarBanco(): Promise<{ url: string; limpar(): Promise<void> }> {
  const externa = process.env.MCP_TEST_DATABASE_URL;
  const nome = `mcp_test_${randomBytes(5).toString("hex")}`;
  let urlBase: URL;
  let limpar = async () => {};
  if (externa) {
    urlBase = new URL(externa);
    if (!["127.0.0.1", "localhost"].includes(urlBase.hostname)) throw new Error("Teste recusado fora do PostgreSQL local.");
    const admin = new pg.Client({ connectionString: externa });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nome}`);
    await admin.end();
    limpar = async () => {
      const limpador = new pg.Client({ connectionString: externa });
      await limpador.connect();
      await limpador.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`).catch(() => undefined);
      await limpador.end();
    };
  } else {
    const porta = 55500 + Math.floor(Math.random() * 400);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dnawork-mcp-pg-"));
    const embedded = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: porta, persistent: false });
    await embedded.initialise();
    await embedded.start();
    urlBase = new URL(`postgres://postgres:postgres@127.0.0.1:${porta}/postgres`);
    const admin = new pg.Client({ connectionString: urlBase.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nome}`);
    await admin.end();
    limpar = async () => embedded.stop();
  }
  urlBase.pathname = `/${nome}`;
  const cliente = new pg.Client({ connectionString: urlBase.toString() });
  await cliente.connect();
  const sql = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
  await cliente.query(sql("database/schema/local-dev.sql"));
  await cliente.query(sql("prisma/migrations/20261025040000_acesso_paginas/migration.sql"));
  // Tabelas do espelho que a ferramenta de filtros lê (o local-dev.sql só cria o schema dna_work).
  await cliente.query(`
    CREATE TABLE IF NOT EXISTS public.grupo (id serial PRIMARY KEY, nome text NOT NULL);
    CREATE TABLE IF NOT EXISTS public.empresa (id text PRIMARY KEY, nome_fantasia text, grupo_id integer, cnpj text);
  `);
  await cliente.query(sql("prisma/migrations/20261126120000_mcp_base/migration.sql"));
  await cliente.end();
  return { url: urlBase.toString(), limpar };
}

export async function criarAmbiente(extra: Record<string, string> = {}): Promise<Ambiente> {
  const banco = await criarBanco();
  Object.assign(process.env, {
    DATABASE_URL: banco.url,
    JWT_SECRET: "test-secret-test-secret-test-secret",
    ADMIN_EMAIL: "admin@dnawork.local",
    ADMIN_PASSWORD: "Teste-Seguro-123",
    ADMIN_PASSWORD_HASH: "",
    NODE_ENV: "test",
    COOKIE_SECURE: "false",
    OPENAI_API_KEY: "",
    JEV_API_URL: "",
    JEV_API_KEY: "",
    MCP_ENABLED: "1",
    MCP_INTERNAL_INSECURE: "1",
    MCP_INTERNAL_TLS_CERT: "",
    MCP_INTERNAL_TLS_KEY: "",
    MCP_INTERNAL_TLS_CA: "",
    MCP_INTERNAL_CLIENTES: "",
    MCP_CONTRATOS: "1",
    MCP_OAUTH_REDIRECT_URIS: "",
    MCP_OAUTH_CIMD_URLS: "",
    MCP_PUBLIC_URL: MCP_URL,
    APP_PUBLIC_URL: APP_URL,
    MCP_GATEWAY_SECRETS: `k1:${SEGREDO_ATUAL},k0:${SEGREDO_ANTIGO}`,
    MCP_OAUTH_CLIENTS: JSON.stringify([CLIENTE_PUBLICO, CLIENTE_CONFIDENCIAL]),
    MCP_RATE_USUARIO_POR_MIN: "1000",
    MCP_OAUTH_RATE_POR_MIN: "1000",
    ...extra,
  });
  const { loadConfig } = await import("../src/config.js");
  const { createPool } = await import("../src/db/pool.js");
  const { loadCapabilities } = await import("../src/db/capabilities.js");
  const { buildApp } = await import("../src/app.js");
  const config = loadConfig();
  const db = createPool(config);
  const capabilities = await loadCapabilities(db);
  const app = await buildApp({ config, db, capabilities });
  return {
    app,
    db,
    config,
    async fechar() {
      await app.close();
      await db.end();
      await banco.limpar();
    },
  };
}

/** Outra instância do monólito sobre o MESMO banco (simula réplica ou reinício). */
export async function criarReplica(amb: Ambiente): Promise<Ambiente> {
  const { createPool } = await import("../src/db/pool.js");
  const { loadCapabilities } = await import("../src/db/capabilities.js");
  const { buildApp } = await import("../src/app.js");
  const db = createPool(amb.config);
  const app = await buildApp({ config: amb.config, db, capabilities: await loadCapabilities(db) });
  return { app, db, config: amb.config, async fechar() { await app.close(); await db.end(); } };
}

export type UsuarioTeste = { id: string; email: string; cookie: string };

/** Cria usuário real no painel (com páginas) e já faz o login pelo fluxo normal. */
export async function criarUsuario(amb: Ambiente, nome: string, paginas: string[], opcoes: { admin?: boolean } = {}): Promise<UsuarioTeste> {
  const id = randomUUID();
  const email = `${nome.toLowerCase().replace(/\W+/g, ".")}.${id.slice(0, 6)}@dnawork.test`;
  await amb.db.query(
    "INSERT INTO dna_work.app_usuario (id, nome, email, senha_hash, ativo, admin) VALUES ($1, $2, $3, $4, true, $5)",
    [id, nome, email, await hash(SENHA), opcoes.admin === true],
  );
  for (const pagina of paginas) await amb.db.query("INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina) VALUES ($1, $2)", [id, pagina]);
  const login = await amb.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: SENHA } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.cookies.find((item) => item.name === "dnawork_session");
  assert.ok(cookie);
  return { id, email, cookie: `${cookie.name}=${cookie.value}` };
}

export async function loginBootstrap(amb: Ambiente): Promise<string> {
  const login = await amb.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "admin@dnawork.local", password: "Teste-Seguro-123" } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.cookies.find((item) => item.name === "dnawork_session");
  assert.ok(cookie);
  return `${cookie.name}=${cookie.value}`;
}

/** Integração pronta: criada, com ferramentas, ativa e com os usuários vinculados. */
export async function criarIntegracao(amb: Ambiente, slug: string, opcoes: { ferramentas?: string[]; ativa?: boolean; usuarios?: Array<{ id: string; ferramentas?: string[] | null; permissoes?: string[] }> } = {}) {
  const mcp = amb.app.mcp!;
  const criada = await mcp.integracoes.criar({ slug, nome: `Integração ${slug}`, descricao: "Teste", instrucoes: "Use só dados do sistema." });
  await mcp.integracoes.definirFerramentas(criada.id, opcoes.ferramentas ?? ["consultar_filtros_vagas"]);
  for (const usuario of opcoes.usuarios ?? []) await mcp.integracoes.vincularUsuario(criada.id, usuario.id, { ferramentas: usuario.ferramentas ?? null, permissoes: usuario.permissoes });
  if (opcoes.ativa !== false) await mcp.integracoes.definirAtiva(criada.id, true);
  return { ...criada, recurso: `${MCP_URL}/mcp/${slug}` };
}

// ---------------------------------------------------------------- OAuth (cliente de teste)

export const pkce = () => {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

const CABECALHOS_PROXY = { "x-forwarded-proto": "https", "x-forwarded-host": new URL(APP_URL).host, host: new URL(APP_URL).host };

export function juntarCookies(...respostas: Array<{ cookies: Array<{ name: string; value: string }> }>): string {
  const jar = new Map<string, string>();
  for (const resposta of respostas) for (const cookie of resposta.cookies) jar.set(cookie.name, cookie.value);
  return [...jar].map(([nome, valor]) => `${nome}=${valor}`).join("; ");
}

export type ParametrosAutorizacao = {
  clientId?: string;
  redirectUri?: string;
  resource?: string | null;
  scope?: string;
  challenge: string;
  method?: string;
  state?: string;
};

export async function autorizar(amb: Ambiente, p: ParametrosAutorizacao) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId ?? CLIENTE_PUBLICO.client_id,
    redirect_uri: p.redirectUri ?? CLIENTE_PUBLICO.redirect_uris[0],
    scope: p.scope ?? "mcp:read",
    code_challenge: p.challenge,
    code_challenge_method: p.method ?? "S256",
    state: p.state ?? "estado-123",
  });
  if (p.resource !== null && p.resource !== undefined) q.set("resource", p.resource);
  const resposta = await amb.app.inject({ method: "GET", url: `/oauth/authorize?${q}`, headers: CABECALHOS_PROXY });
  return resposta;
}

export function uidDoRedirect(location: string): string {
  const url = new URL(location);
  assert.equal(url.origin, APP_URL);
  const m = /^\/mcp\/autorizar\/(.+)$/.exec(url.pathname);
  assert.ok(m, `redirect inesperado: ${location}`);
  return m[1];
}

/** Fluxo completo até o código: authorize → consentimento no painel → retomada. Devolve o redirect final do cliente. */
export async function percorrerAutorizacao(amb: Ambiente, usuario: { cookie: string }, p: ParametrosAutorizacao & { aprovar?: boolean }) {
  const inicio = await autorizar(amb, p);
  assert.equal(inicio.statusCode, 303, inicio.body);
  const uid = uidDoRedirect(String(inicio.headers.location));
  const decisao = await amb.app.inject({
    method: "POST",
    url: `/api/v1/mcp/interacao/${uid}/decisao`,
    headers: { cookie: usuario.cookie, origin: APP_URL },
    payload: { aprovar: p.aprovar !== false },
  });
  if (decisao.statusCode !== 200) return { inicio, uid, decisao, final: null as null };
  const retomar = new URL(decisao.json().data.redirectTo);
  const final = await amb.app.inject({
    method: "GET",
    url: retomar.pathname + retomar.search,
    headers: { ...CABECALHOS_PROXY, cookie: juntarCookies(inicio) },
  });
  return { inicio, uid, decisao, final };
}

export async function trocarCodigo(amb: Ambiente, p: { code: string; verifier: string; clientId?: string; redirectUri?: string; resource?: string; segredo?: string }) {
  const corpo = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    code_verifier: p.verifier,
    client_id: p.clientId ?? CLIENTE_PUBLICO.client_id,
    redirect_uri: p.redirectUri ?? CLIENTE_PUBLICO.redirect_uris[0],
  });
  if (p.resource) corpo.set("resource", p.resource);
  if (p.segredo) corpo.set("client_secret", p.segredo);
  return amb.app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: { ...CABECALHOS_PROXY, "content-type": "application/x-www-form-urlencoded" },
    payload: corpo.toString(),
  });
}

export async function renovar(amb: Ambiente, p: { refresh: string; clientId?: string; resource?: string }) {
  const corpo = new URLSearchParams({ grant_type: "refresh_token", refresh_token: p.refresh, client_id: p.clientId ?? CLIENTE_PUBLICO.client_id });
  if (p.resource) corpo.set("resource", p.resource);
  return amb.app.inject({ method: "POST", url: "/oauth/token", headers: { ...CABECALHOS_PROXY, "content-type": "application/x-www-form-urlencoded" }, payload: corpo.toString() });
}

export type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope?: string };

/** Atalho: faz o fluxo todo e devolve os tokens do usuário para a integração. */
export async function obterTokens(amb: Ambiente, usuario: { cookie: string }, recurso: string): Promise<Tokens> {
  const { verifier, challenge } = pkce();
  const passo = await percorrerAutorizacao(amb, usuario, { resource: recurso, challenge });
  assert.ok(passo.final, `consentimento falhou: ${passo.decisao.body}`);
  assert.equal(passo.final.statusCode, 303, passo.final.body);
  const retorno = new URL(String(passo.final.headers.location));
  const code = retorno.searchParams.get("code");
  assert.ok(code, `sem code: ${retorno}`);
  const troca = await trocarCodigo(amb, { code, verifier, resource: recurso });
  assert.equal(troca.statusCode, 200, troca.body);
  return troca.json() as Tokens;
}

// ---------------------------------------------------------------- API interna (gateway de teste)

import { assinar, CONTRATO_VERSAO } from "../src/mcp/assinatura.js";

export type OpcoesInternas = {
  /** Caminho completo (ex.: /internal/mcp/saude); substitui /internal/mcp/<slug>/<operacao>. */
  caminhoCompleto?: string;
  slug: string;
  operacao: "integracao" | "autenticar" | "ferramentas" | "executar";
  token?: string | null;
  corpo?: unknown;
  chave?: string;
  segredo?: string;
  timestamp?: number;
  nonce?: string;
  requestId?: string;
  contrato?: number;
  /** Cabeçalhos extras (ex.: tentativa de forjar identidade). Não entram na assinatura. */
  extras?: Record<string, string>;
  /** Corpo adulterado depois de assinar. */
  corpoEnviado?: string;
};

export function requisicaoInterna(amb: Ambiente, o: OpcoesInternas) {
  const corpoTexto = JSON.stringify(o.corpo ?? {});
  const chave = o.chave ?? "k1";
  const segredo = o.segredo ?? SEGREDO_ATUAL;
  const timestamp = o.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = o.nonce ?? randomBytes(16).toString("base64url");
  const requestId = o.requestId ?? `req-${randomBytes(6).toString("hex")}`;
  const contrato = o.contrato ?? CONTRATO_VERSAO;
  const caminho = o.caminhoCompleto ?? `/internal/mcp/${o.slug}/${o.operacao}`;
  const assinatura = assinar(segredo, { metodo: "POST", caminho, contrato, chave, timestamp, nonce, requestId, corpo: corpoTexto, token: o.token ?? null });
  return amb.app.mcp!.interno.inject({
    method: "POST",
    url: caminho,
    headers: {
      "content-type": "application/json",
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      "x-mcp-contract": String(contrato),
      "x-mcp-key-id": chave,
      "x-mcp-timestamp": String(timestamp),
      "x-mcp-nonce": nonce,
      "x-mcp-request-id": requestId,
      "x-mcp-signature": assinatura,
      ...(o.extras ?? {}),
    },
    payload: o.corpoEnviado ?? corpoTexto,
  });
}
