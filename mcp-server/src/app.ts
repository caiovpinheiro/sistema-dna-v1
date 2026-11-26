import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { GatewayConfig } from "./config.js";
import { MonolitoClient, MonolitoIndisponivel, type RespostaMonolito } from "./monolito.js";
import { Verificador } from "./prontidao.js";
import { CertStore } from "./tls.js";

export const VERSAO = "0.1.0";
const SLUG = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

export type Gateway = { app: FastifyInstance; verificador: Verificador; monolito: MonolitoClient; certs: CertStore | null };

type Falha = { status: number; codigo: string; mensagem: string; headers?: Record<string, string> };
class FalhaHttp extends Error { constructor(public readonly falha: Falha) { super(falha.mensagem); } }

const bearerDe = (h: string | undefined) => (typeof h === "string" ? /^Bearer ([A-Za-z0-9._~+/-]{20,300})$/.exec(h)?.[1] ?? null : null);

/** Mapeia o que o monólito respondeu (negócio) para o que o cliente MCP precisa ver. */
function falhaDe(r: RespostaMonolito, wwwAuth: (invalido: boolean) => string): Falha {
  const codigo = String(r.json?.error?.code ?? "ERRO");
  const mensagem = String(r.json?.error?.message ?? "Erro.");
  switch (r.status) {
    case 401: return { status: 401, codigo, mensagem: "Token ausente, expirado ou revogado.", headers: { "www-authenticate": wwwAuth(true) } };
    case 403: return { status: 403, codigo, mensagem };
    case 404: return { status: 404, codigo, mensagem };
    case 429: return { status: 429, codigo, mensagem, headers: { "retry-after": String(Math.max(1, Math.min(120, Number(r.json?.error?.details?.reiniciaEmSegundos) || 5))) } };
    default: return { status: 503, codigo: "MONOLITO_ERRO", mensagem: "O serviço interno não pôde atender.", headers: { "retry-after": "5" } };
  }
}

export async function buildGateway(cfg: GatewayConfig, opcoes: { relogio?: () => Date; logStream?: { write(linha: string): void } } = {}): Promise<Gateway> {
  const certs = cfg.tls ? new CertStore(cfg.tls, cfg.certRecheckMs, opcoes.relogio) : null;
  const monolito = new MonolitoClient(cfg, certs, opcoes.relogio ? () => opcoes.relogio!().getTime() : undefined);
  const verificador = new Verificador(cfg, monolito, certs);
  const app = Fastify({
    logger: cfg.logLevel === "silent" ? false : {
      level: cfg.logLevel,
      ...(opcoes.logStream ? { stream: opcoes.logStream } : {}),
      redact: ["req.headers.authorization", "req.headers.cookie", "headers.authorization"],
      serializers: { req: (req) => ({ method: req.method, url: String(req.url ?? "").split("?")[0], host: req.host, ip: req.ip }) },
    },
    bodyLimit: cfg.maxBodyBytes,
    trustProxy: cfg.trustProxy,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    requestTimeout: cfg.requestTimeoutMs + 5_000,
    forceCloseConnections: "idle",
  }) as unknown as FastifyInstance;

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_r, body, done) => done(null, body));
  await app.register(rateLimit, {
    max: cfg.rateLimitPorMin, timeWindow: "1 minute",
    allowList: (req) => req.url === "/health" || req.url === "/ready",
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: { code: "LIMITE_EXCEDIDO", message: "Muitas requisições. Aguarde um instante.", retryAfter: Math.ceil(ctx.ttl / 1000) } }),
  });

  const recursoMeta = (slug: string) => `${cfg.publicUrl}/.well-known/oauth-protected-resource/mcp/${slug}`;
  const wwwAuth = (slug: string) => (invalido: boolean) => `Bearer ${invalido ? 'error="invalid_token", ' : ""}resource_metadata="${recursoMeta(slug)}"`;

  app.addHook("onRequest", async (request, reply) => {
    void reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff");
    const caminho = request.url.split("?")[0];
    if (caminho === "/health" || caminho === "/ready") return;
    const host = String(request.headers.host ?? "").toLowerCase();
    if (!cfg.allowedHosts.includes(host)) return reply.code(403).send({ error: { code: "HOST_NAO_PERMITIDO", message: "Host não permitido." } });
    const origin = request.headers.origin;
    if (origin !== undefined && !cfg.allowedOrigins.includes(String(origin).toLowerCase())) {
      return reply.code(403).send({ error: { code: "ORIGEM_NAO_PERMITIDA", message: "Origem não permitida." } });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const caminho = request.url.split("?")[0];
    if (caminho === "/health" || caminho === "/ready") return;
    request.log.info({ requestId: request.id, status: reply.statusCode, duracaoMs: Math.round(reply.elapsedTime) }, "requisição");
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const e = error as { statusCode?: number; code?: string; message?: string };
    if (e.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ jsonrpc: "2.0", error: { code: -32600, message: "Corpo grande demais." }, id: null });
    if (e.statusCode === 429) return reply.code(429).send(error);
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: "REQUISICAO_INVALIDA", message: "Requisição inválida." } });
    request.log.error({ mensagem: e.message }, "erro interno");
    return reply.code(500).send({ error: { code: "ERRO_INTERNO", message: "Erro interno." } });
  });

  // ---- probes
  app.get("/health", async () => ({ status: "ok", versao: VERSAO }));
  app.get("/ready", async (_request, reply) => {
    const p = await verificador.verificar();
    return reply.code(p.pronto ? 200 : 503).send(p);
  });

  // ---- RFC 9728: o caminho do metadado espelha o do recurso (/mcp/:slug)
  app.get("/.well-known/oauth-protected-resource/mcp/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!SLUG.test(slug)) return reply.code(404).send({ error: { code: "NAO_ENCONTRADO", message: "Integração não encontrada." } });
    try {
      const r = await monolito.integracao(slug, request.id);
      if (r.status === 404) return reply.code(404).send({ error: { code: "INTEGRACAO_NAO_ENCONTRADA", message: "Integração não encontrada." } });
      if (r.status !== 200) throw new MonolitoIndisponivel("MONOLITO_ERRO", "erro");
      return {
        resource: `${cfg.publicUrl}/mcp/${slug}`,
        authorization_servers: [cfg.issuerUrl],
        bearer_methods_supported: ["header"],
        scopes_supported: r.json.data.escopos ?? ["mcp:read"],
        resource_name: r.json.data.nome,
      };
    } catch (e) {
      if (e instanceof MonolitoIndisponivel) { verificador.invalidar(); return reply.code(503).header("retry-after", "5").send({ error: { code: e.codigo, message: e.message } }); }
      throw e;
    }
  });

  const naoPermitido = (_r: FastifyRequest, reply: FastifyReply) => reply.code(405).header("allow", "POST").send({ error: { code: "METODO_NAO_PERMITIDO", message: "Use POST (Streamable HTTP sem sessão)." } });
  app.get("/mcp/:slug", naoPermitido);
  app.delete("/mcp/:slug", naoPermitido);

  // ---- MCP
  app.post("/mcp/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const rpc = (status: number, code: number, message: string) => reply.code(status).send({ jsonrpc: "2.0", error: { code, message }, id: null });
    if (!SLUG.test(slug)) return reply.code(404).send({ error: { code: "INTEGRACAO_NAO_ENCONTRADA", message: "Integração não encontrada." } });
    if (verificador.encerrando) return reply.code(503).header("retry-after", "5").send({ error: { code: "ENCERRANDO", message: "Gateway encerrando." } });
    if (!Buffer.isBuffer(request.body)) return rpc(415, -32600, "Use Content-Type: application/json.");
    let mensagem: any;
    try { mensagem = JSON.parse(request.body.toString("utf8")); } catch { return rpc(400, -32700, "JSON inválido."); }
    if (Array.isArray(mensagem) || typeof mensagem !== "object" || mensagem === null || mensagem.jsonrpc !== "2.0" || typeof mensagem.method !== "string") {
      return rpc(400, -32600, "Requisição JSON-RPC inválida (lotes não são aceitos).");
    }
    const token = bearerDe(request.headers.authorization);
    // Descoberta inicial sem login (ChatGPT): só initialize/ping/notificações/tools/list, e apenas metadados das ferramentas
    // LIGADAS na integração. Qualquer outra coisa (inclusive tools/call) exige OAuth.
    const metodoAnonimo = String(mensagem.method);
    const anonimoPermitido = cfg.descobertaPublica && ["initialize", "ping", "notifications/initialized", "tools/list"].includes(metodoAnonimo);
    if (!token && !anonimoPermitido) return reply.code(401).header("www-authenticate", wwwAuth(slug)(false)).send({ error: { code: "TOKEN_AUSENTE", message: "Autenticação necessária." } });

    let tools: unknown[] = [];
    let resultado: unknown = null;
    let erroRpc: { code: number; message: string } | null = null;
    let instrucoes: string | undefined;
    try {
      const metodo = String(mensagem.method);
      const nome = mensagem.params?.name;
      if (metodo === "tools/call" && typeof nome === "string" && nome.length > 0 && nome.length <= 80) {
        if (!token) throw new FalhaHttp({ status: 401, codigo: "TOKEN_AUSENTE", mensagem: "Autenticação necessária.", headers: { "www-authenticate": wwwAuth(slug)(false) } });
        const r = await monolito.executar(slug, token, { ferramenta: nome, argumentos: mensagem.params?.arguments ?? {} }, request.id);
        if (r.status === 200) {
          const d = r.json.data;
          resultado = { content: d.content, ...(d.structuredContent !== undefined ? { structuredContent: d.structuredContent } : {}), isError: d.isError === true };
        } else if (r.status === 404 && r.json?.error?.code === "FERRAMENTA_INDISPONIVEL") {
          erroRpc = { code: ErrorCode.InvalidParams, message: "Ferramenta indisponível para este usuário." };
        } else if (r.status === 422 || r.status === 400) {
          erroRpc = { code: ErrorCode.InvalidParams, message: "Parâmetros inválidos." };
        } else throw new FalhaHttp(falhaDe(r, wwwAuth(slug)));
      } else if (metodo === "tools/list") {
        // Com token: catálogo EFETIVO do usuário (permissões de agora). Sem token: catálogo inicial da integração (só metadados).
        const r = token ? await monolito.ferramentas(slug, token, request.id) : await monolito.catalogo(slug, request.id);
        if (r.status !== 200) throw new FalhaHttp(falhaDe(r, wwwAuth(slug)));
        tools = (r.json.data.ferramentas as any[]).map((f) => ({
          name: f.nome, title: f.titulo, description: f.descricao, inputSchema: f.inputSchema, ...(f.outputSchema ? { outputSchema: f.outputSchema } : {}),
          annotations: f.annotations, securitySchemes: f.securitySchemes ?? f._meta?.securitySchemes, _meta: f._meta,
        }));
      } else if (!token) {
        // initialize/ping/notificações sem login: a integração precisa existir e estar ativa; sem instruções internas.
        const r = await monolito.integracao(slug, request.id);
        if (r.status !== 200) throw new FalhaHttp(falhaDe(r, wwwAuth(slug)));
      } else {
        const r = await monolito.autenticar(slug, token, request.id);
        if (r.status !== 200) throw new FalhaHttp(falhaDe(r, wwwAuth(slug)));
        instrucoes = r.json.data.integracao?.instrucoes ?? undefined;
      }
    } catch (e) {
      if (e instanceof FalhaHttp) {
        const f = e.falha;
        for (const [k, v] of Object.entries(f.headers ?? {})) void reply.header(k, v);
        return reply.code(f.status).send({ error: { code: f.codigo, message: f.mensagem } });
      }
      if (e instanceof MonolitoIndisponivel) { verificador.invalidar(); return reply.code(503).header("retry-after", "5").send({ error: { code: e.codigo, message: e.message } }); }
      throw e;
    }

    const server = new Server({ name: "dnawork-mcp", version: VERSAO }, { capabilities: { tools: { listChanged: false } }, ...(instrucoes ? { instructions: instrucoes } : {}) });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools as never }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      if (erroRpc) throw new McpError(erroRpc.code, erroRpc.message);
      if (resultado) return resultado as never;
      throw new McpError(ErrorCode.InvalidParams, "Parâmetros inválidos.");
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.setHeader("cache-control", "no-store");
    reply.raw.setHeader("x-content-type-options", "nosniff");
    reply.raw.on("close", () => { void transport.close().catch(() => undefined); void server.close().catch(() => undefined); });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, mensagem);
  });

  app.addHook("onClose", async () => { certs?.fechar(); });
  return { app, verificador, monolito, certs };
}
