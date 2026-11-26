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

/** Chave de assinatura só para o endpoint JWKS (os tokens são opacos). Nova a cada boot: nada depende dela. */
function chaveEfemera() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { ...privateKey.export({ format: "jwk" }), alg: "RS256", use: "sig", kid: "mcp-efemera" };
}

async function integracaoAtivaPorSlug(db: Pool, slug: string) {
  const { rows } = await db.query<{ id: string; nome: string }>(
    "SELECT id, nome FROM dna_work.mcp_integracao WHERE slug = $1 AND ativa = true",
    [slug],
  );
  return rows[0] ?? null;
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

export function criarProvider(db: Pool, config: AppConfig, mcp: McpConfig): Provider {
  const producao = process.env.NODE_ENV === "production";
  const segredoCookie = config.MCP_OAUTH_COOKIE_SECRET
    || createHash("sha256").update(`dnawork-mcp-cookies:${config.JWT_SECRET}`).digest("hex");

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
    jwks: { keys: [chaveEfemera()] },
    cookies: {
      keys: [segredoCookie],
      long: { signed: true, secure: producao, sameSite: "lax", httpOnly: true },
      short: { signed: true, secure: producao, sameSite: "lax", httpOnly: true },
    },
    scopes: ESCOPOS_SUPORTADOS,
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
        allowFetch: async () => true,
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
  provider.proxy = true; // atrás do proxy do EasyPanel (X-Forwarded-*)
  return provider;
}

/**
 * Monta o provider no Fastify: o oidc-provider (Koa) atende /oauth/* e os metadados RFC 8414.
 * O corpo da requisição fica intocado para o provider ler.
 */
export function montarOAuth(app: FastifyInstance, provider: Provider, limitePorMinuto: number): void {
  provider.on("server_error", (_ctx, erro) => {
    app.log.error({ mensagem: erro.message }, "mcp oauth: erro interno do provider");
  });
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
    oauth.get("/oauth/authorize", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, encaminhar);
    oauth.get("/oauth/authorize/:uid", encaminhar);
    oauth.get("/oauth/jwks", encaminhar);
    oauth.get("/.well-known/oauth-authorization-server", encaminhar);
    oauth.get("/.well-known/openid-configuration", encaminhar);
  });
}
