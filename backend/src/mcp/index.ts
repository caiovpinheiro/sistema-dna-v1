import type { FastifyInstance } from "fastify";
import type Provider from "oidc-provider";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { AcessoService } from "../services/acesso.service.js";
import { lerMcpConfig, type McpConfig } from "./config.js";
import { registrarConsentimento } from "./consentimento.js";
import { criarRegistroPadrao } from "./ferramentas/index.js";
import { IntegracoesMcpService } from "./integracoes.service.js";
import { criarAppInterno } from "./interno.js";
import { chaveAssinaturaPersistente, criarProvider, montarOAuth } from "./oauth.js";
import { observarTls } from "./tls-interno.js";
import type { RegistroFerramentas, ServicosMcp } from "./registro.js";

export type McpRuntime = {
  config: McpConfig;
  provider: Provider;
  registro: RegistroFerramentas;
  integracoes: IntegracoesMcpService;
  /** Instância Fastify das rotas /internal/mcp/*. Quem sobe o servidor escuta nela, em porta privada. */
  interno: FastifyInstance;
};

declare module "fastify" {
  interface FastifyInstance {
    mcp?: McpRuntime;
  }
}

/**
 * Liga o MCP no monólito. Com MCP_ENABLED desligado (padrão) não registra nada: nenhuma rota, nenhum listener.
 * Ligado: OAuth e consentimento no app público, e um app separado para a API interna.
 */
export async function iniciarMcp(app: FastifyInstance, deps: { db: Pool; config: AppConfig; acesso: AcessoService; servicos: ServicosMcp }): Promise<McpRuntime | null> {
  if (!deps.config.MCP_ENABLED) return null;
  const mcp = lerMcpConfig(deps.config); // falha no boot se a configuração for insegura ou incompleta
  const provider = criarProvider(deps.db, deps.config, mcp, await chaveAssinaturaPersistente(deps.db));
  const registro = criarRegistroPadrao();
  montarOAuth(app, provider, deps.config.MCP_OAUTH_RATE_POR_MIN);
  registrarConsentimento(app, { db: deps.db, provider, mcp });
  const interno = criarAppInterno({ db: deps.db, config: deps.config, mcp, provider, acesso: deps.acesso, registro, servicos: deps.servicos });
  const runtime: McpRuntime = { config: mcp, provider, registro, integracoes: new IntegracoesMcpService(deps.db, mcp, registro), interno };
  app.decorate("mcp", runtime);
  if (!mcp.inseguro) {
    const pararObservacao = observarTls(interno.server as unknown as import("node:tls").Server, { cert: deps.config.MCP_INTERNAL_TLS_CERT, key: deps.config.MCP_INTERNAL_TLS_KEY, ca: deps.config.MCP_INTERNAL_TLS_CA }, app.log);
    app.addHook("onClose", async () => pararObservacao());
  }
  app.addHook("onClose", async () => {
    await interno.close();
  });
  return runtime;
}
