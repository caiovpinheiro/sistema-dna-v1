import { generateKeyPairSync, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import Provider, { errors, interactionPolicy, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AdaptadorPg } from "./adaptador-oauth.js";
import { recursoDaIntegracao, redirectPermitido, slugDoRecurso, type McpConfig } from "./config.js";

export const ESCOPO_LEITURA = "mcp:read";
export const ESCOPOS_SUPORTADOS = [ESCOPO_LEITURA];

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function gerarChave() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { ...privateKey.export({ format: "jwk" }), alg: "RS256", use: "sig", kid: "mcp-principal" };
}

type ChaveJwk = ReturnType<typeof gerarChave>;

/**
 * Chave de assinatura do provider (JWKS). Os access/refresh tokens são opacos e não dependem dela, mas todas as
 * réplicas precisam servir o MESMO JWKS e sobreviver a reinícios: a primeira a subir grava (INSERT … DO NOTHING,
 * atômico) e as demais leem a mesma.
 */
export async function chaveAssinaturaPersistente(db: Pool): Promise<ChaveJwk> {
  await db.query(
    "INSERT INTO dna_work.mcp_oauth_registro (tipo, id, payload) VALUES ('ChaveAssinatura', 'principal', $1::jsonb) ON CONFLICT (tipo, id) DO NOTHING",
    [JSON.stringify(gerarChave())],
  );
  const { rows } = await db.query<{ payload: ChaveJwk }>("SELECT payload FROM dna_work.mcp_oauth_registro WHERE tipo = 'ChaveAssinatura' AND id = 'principal'");
  return rows[0].payload;
}

async function integracaoAtivaPorSlug(db: Pool, slug: string) {
  const { rows } = await db.query<{ id: string; nome: string }>(
    "SELECT id, nome FROM dna_work.mcp_integracao WHERE slug = $1 AND ativa = true",
    [slug],
  );
  return rows[0] ?? null;
}

/** Grants que ESTA integração aceita. O documento CIMD do ChatGPT também declara jwt-bearer, que não habilitamos. */
const GRANTS_SUPORTADOS = new Set(["authorization_code", "refresh_token"]);

/** Cache do jwks_uri dos clientes CIMD: respeita um TTL curto e é invalidado por falha de autenticação (rotação de chaves). */
export class CacheJwks {
  private readonly urls = new Set<string>();
  private readonly itens = new Map<string, { corpo: string; headers: Headers; expira: number }>();
  constructor(private readonly ttlSegundos: number) {}
  registrar(url: unknown) { if (typeof url === "string" && url.startsWith("https://")) this.urls.add(url); }
  conhece(url: string) { return this.ttlSegundos > 0 && this.urls.has(url); }
  obter(url: string) { const e = this.itens.get(url); return e && e.expira > Date.now() ? e : undefined; }
  guardar(url: string, corpo: string, headers: Headers) { this.itens.set(url, { corpo, headers, expira: Date.now() + this.ttlSegundos * 1000 }); }
  invalidar() { this.itens.clear(); }
  buscasEmCache() { return this.itens.size; }
}

/**
 * fetch usado pelo provider para o documento CIMD e o jwks_uri (já protegido contra SSRF pela biblioteca).
 * - No documento do cliente, remove grant types que não suportamos (ex.: jwt-bearer): só REDUZ capacidades.
 * - Guarda o jwks_uri em cache curto (a biblioteca o buscaria a cada requisição de token).
 */
export function criarFetchDoCliente(cache: CacheJwks) {
  return async function fetchDoCliente(url: string | URL, options?: RequestInit): Promise<Response> {
    const alvo = String(url);
    if (cache.conhece(alvo)) {
      const guardado = cache.obter(alvo);
      if (guardado) return new Response(guardado.corpo, { status: 200, headers: guardado.headers });
    }
    const resposta = await globalThis.fetch(url as never, options);
    if (resposta.status !== 200) return resposta;
    const texto = await resposta.text();
    const refazer = (corpo: string) => new Response(corpo, { status: 200, headers: resposta.headers });
    if (cache.conhece(alvo)) {
      try { if (Array.isArray((JSON.parse(texto) as { keys?: unknown }).keys)) cache.guardar(alvo, texto, resposta.headers); } catch { /* não guarda */ }
      return refazer(texto);
    }
    try {
      const doc = JSON.parse(texto) as Record<string, unknown>;
      if (doc && typeof doc === "object" && !Array.isArray(doc) && doc.client_id === alvo) {
        cache.registrar(doc.jwks_uri);
        if (Array.isArray(doc.grant_types)) doc.grant_types = (doc.grant_types as unknown[]).filter((g) => typeof g === "string" && GRANTS_SUPORTADOS.has(g));
        return refazer(JSON.stringify(doc));
      }
    } catch { /* não é JSON: segue como veio */ }
    return refazer(texto);
  };
}

function politicaSempreConfirma() {
  const { Check, base } = interactionPolicy;
  const politica = base();
  // Sempre pede login e consentimento na primeira passagem; na retomada (já com o resultado do painel) segue.
  for (const nome of ["login", "consent"] as const) {
    const prompt = politica.get(nome);
    if (!prompt) continue;
    prompt.checks.clear();
    prompt.checks.add(new Check("mcp_sempre", "confirmação sempre exigida", "interaction_required", (ctx) => {
      const resultado = ctx.oidc.result as { login?: unknown; consent?: unknown } | undefined;
      return resultado?.[nome] ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
    }));
  }
  return politica;
}

export function criarProvider(db: Pool, config: AppConfig, mcp: McpConfig, chave: ChaveJwk): Provider {
  const producao = process.env.NODE_ENV === "production";
  const segredoCookie = config.MCP_OAUTH_COOKIE_SECRET
    || createHash("sha256").update(`dnawork-mcp-cookies:${config.JWT_SECRET}`).digest("hex");

  const cacheJwks = new CacheJwks(config.MCP_JWKS_CACHE_S);
  const configuracao: Configuration = {
    adapter: class {
      constructor(nome: string) {
        return new AdaptadorPg(db, nome);
      }
    } as unknown as Configuration["adapter"],
    clients: mcp.clientesPreCadastrados.map((cliente) => ({
      client_id: cliente.client_id,
      client_name: cliente.client_name,
      redirect_uris: cliente.redirect_uris,
      ...(cliente.client_secret
        ? { client_secret: cliente.client_secret, token_endpoint_auth_method: "client_secret_post" as const }
        : { token_endpoint_auth_method: "none" as const }),
    })),
    clientDefaults: {
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    jwks: { keys: [chave] },
    cookies: {
      keys: [segredoCookie],
      long: { signed: true, secure: producao, sameSite: "lax", httpOnly: true },
      short: { signed: true, secure: producao, sameSite: "lax", httpOnly: true },
    },
    scopes: ESCOPOS_SUPORTADOS,
    fetch: criarFetchDoCliente(cacheJwks) as never,
    // Só os métodos que usamos: público (none), segredo de clientes pré-cadastrados e private_key_jwt (ChatGPT). Sem client_secret_jwt.
    clientAuthMethods: ["none", "client_secret_basic", "client_secret_post", "private_key_jwt"],
    enabledJWA: { clientAuthSigningAlgValues: ["RS256", "ES256"] },
    extraParams: ["mcp_escopo_padrao"],
    claims: {},
    responseTypes: ["code"],
    pkce: { required: () => true },
    routes: {
      authorization: "/oauth/authorize",
      token: "/oauth/token",
      revocation: "/oauth/revoke",
      registration: "/oauth/register",
      jwks: "/oauth/jwks",
      introspection: "/oauth/introspect",
      userinfo: "/oauth/userinfo",
      end_session: "/oauth/session/end",
      code_verification: "/oauth/device",
      device_authorization: "/oauth/device/auth",
      pushed_authorization_request: "/oauth/par",
    },
    ttl: {
      AccessToken: config.MCP_ACCESS_TTL_S,
      AuthorizationCode: 60,
      RefreshToken: config.MCP_REFRESH_TTL_S,
      Grant: config.MCP_REFRESH_TTL_S,
      Interaction: 600,
      Session: 600,
      IdToken: 60,
    },
    rotateRefreshToken: true,
    issueRefreshToken: async (_ctx, client) => client.grantTypeAllowed("refresh_token"),
    // Conta = usuário real, ativo, do painel. O bootstrap-admin (sem linha em app_usuario) nunca existe aqui.
    findAccount: async (_ctx, id) => {
      const { rows } = await db.query("SELECT 1 FROM dna_work.app_usuario WHERE id::text = $1 AND ativo = true", [id]);
      if (!rows.length) return undefined;
      return { accountId: id, claims: async () => ({ sub: id }) };
    },
    interactions: {
      url: (_ctx, interaction) => `${mcp.appUrl}/mcp/autorizar/${interaction.uid}`,
      // Sempre pede login e consentimento: a pessoa que aprova é a que está logada no painel agora.
      policy: politicaSempreConfirma(),
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: true },
      rpInitiatedLogout: { enabled: false },
      registration: { enabled: config.MCP_OAUTH_DCR, initialAccessToken: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: "draft-03",
        // Lista exata de client_id (ex.: https://chatgpt.com/oauth/client.json). Vazia = qualquer https público (com proteção SSRF).
        allowFetch: async (_ctx, clientId) => !mcp.cimdUrls.length || mcp.cimdUrls.includes(clientId),
        allowClient: async (_ctx, client) => (client.redirectUris ?? []).every((uri) => redirectPermitido(mcp, uri)),
      },
      resourceIndicators: {
        enabled: true,
        // O resource é obrigatório e precisa ser exatamente a URL MCP de uma integração ativa.
        defaultResource: async () => {
          throw new errors.InvalidTarget("o parâmetro resource é obrigatório (URL do endpoint MCP)");
        },
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, recurso) => {
          const slug = slugDoRecurso(mcp, recurso);
          if (!slug || !(await integracaoAtivaPorSlug(db, slug))) throw new errors.InvalidTarget("recurso desconhecido");
          return {
            scope: ESCOPO_LEITURA,
            audience: recursoDaIntegracao(mcp, slug),
            accessTokenTTL: config.MCP_ACCESS_TTL_S,
            accessTokenFormat: "opaque",
          };
        },
      },
    },
    renderError: async (ctx: KoaContextWithOIDC, out) => {
      ctx.type = "text/html; charset=utf-8";
      ctx.body = `<!doctype html><meta charset="utf-8"><title>Autorização</title><p>Não foi possível concluir a autorização (${escapar(String(out.error ?? "erro"))}).</p>`;
    },
  };

  const provider = new Provider(mcp.appUrl, configuracao);
  // Falha de autenticação de cliente (ex.: chave rotacionada): descarta o cache do JWKS para a próxima tentativa buscar o atual.
  provider.on("grant.error", (_ctx, erro) => { if (erro.error === "invalid_client") cacheJwks.invalidar(); });
  provider.proxy = true; // atrás do proxy do EasyPanel (X-Forwarded-*)
  return provider;
}

/**
 * Monta o provider no Fastify: o oidc-provider (Koa) atende /oauth/* e os metadados RFC 8414.
 * O corpo da requisição fica intocado para o provider ler.
 */
export function montarOAuth(app: FastifyInstance, provider: Provider, limitePorMinuto: number, escopoPadrao: string[]): void {
  provider.on("server_error", (_ctx, erro) => {
    app.log.error({ mensagem: erro.message }, "mcp oauth: erro interno do provider");
  });
  // Diagnóstico: por que um login ou uma troca de código falhou (só códigos e descrições do OAuth, nunca código, token ou assertion).
  const registrarFalha = (etapa: string) => (ctx: { oidc?: { client?: { clientId?: string }; params?: Record<string, unknown> } }, erro: { error?: string; error_description?: string; message?: string }) => {
    const params = ctx?.oidc?.params ?? {};
    app.log.warn({
      etapa, erro: erro.error ?? "erro", descricao: erro.error_description ?? erro.message, cliente: ctx?.oidc?.client?.clientId ?? params.client_id,
      grant_type: params.grant_type, resource: params.resource, redirect_uri: params.redirect_uri,
    }, "mcp oauth: falha");
  };
  provider.on("grant.error", registrarFalha("token"));
  provider.on("authorization.error", registrarFalha("autorizacao"));
  void app.register(async (oauth) => {
    for (const tipo of ["application/x-www-form-urlencoded", "application/json"]) {
      oauth.addContentTypeParser(tipo, (_request, _payload, done) => done(null));
    }
    const atender = provider.callback();
    const encaminhar = async (request: { raw: import("node:http").IncomingMessage }, reply: { raw: import("node:http").ServerResponse; hijack(): unknown }) => {
      reply.hijack();
      atender(request.raw, reply.raw);
    };
    const limitado = { config: { rateLimit: { max: limitePorMinuto, timeWindow: "1 minute" } } };
    oauth.post("/oauth/token", limitado, encaminhar);
    oauth.post("/oauth/revoke", limitado, encaminhar);
    oauth.post("/oauth/register", limitado, encaminhar);
    // Cliente que não manda `scope` recebe o escopo único da integração (mcp:read); escopos desconhecidos (ex.: offline_access) são ignorados pelo provider.
    oauth.get("/oauth/authorize", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
      const url = new URL(request.raw.url ?? "", "http://x");
      // Política explícita: o escopo padrão só vale quando o cliente NÃO informa `scope`. Escopos desconhecidos
      // (ex.: offline_access) nunca viram mcp:read; o provider os ignora e, se sobrar nenhum suportado, recusa (invalid_scope).
      url.searchParams.delete("mcp_escopo_padrao"); // nunca vem do cliente
      if (!(url.searchParams.get("scope") ?? "").trim() && escopoPadrao.length) {
        url.searchParams.set("scope", escopoPadrao.join(" "));
        url.searchParams.set("mcp_escopo_padrao", "1");
      }
      request.raw.url = `${url.pathname}${url.search}`;
      return encaminhar(request, reply);
    });
    oauth.get("/oauth/authorize/:uid", encaminhar);
    oauth.get("/oauth/jwks", encaminhar);
    oauth.get("/.well-known/oauth-authorization-server", encaminhar);
    oauth.get("/.well-known/openid-configuration", encaminhar);
  });
}
