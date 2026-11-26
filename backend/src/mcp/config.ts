import { z } from "zod";
import type { AppConfig } from "../config.js";
import { lerSegredos, type Segredos } from "./assinatura.js";
import { validarMaterialTls } from "./tls-interno.js";

export type McpConfig = {
  publicUrl: string; // origem do gateway, sem barra final
  appUrl: string; // origem do painel = emissor OAuth, sem barra final
  segredos: Segredos;
  clientesPreCadastrados: ClientePreCadastrado[];
  hostsRedirect: string[];
  redirectUris: string[];
  cimdUrls: string[];
  contratos: number[];
  clientesInternos: string[];
  /** true = listener interno em texto puro (só dev/teste). false = mTLS validado. */
  inseguro: boolean;
};

const clienteSchema = z.object({
  client_id: z.string().min(3).max(200),
  client_secret: z.string().min(32).max(200).optional(),
  client_name: z.string().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
});
export type ClientePreCadastrado = z.infer<typeof clienteSchema>;

function origem(valor: string, nome: string, producao: boolean): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error(`${nome} precisa ser uma URL (ex.: https://mcp.dnawork.ai).`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !producao)) {
    throw new Error(`${nome} precisa usar https.`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) {
    throw new Error(`${nome} deve ser só a origem, sem caminho.`);
  }
  return url.origin;
}

/** Falha cedo (no boot) se o MCP está ligado com configuração insegura ou incompleta. */
export function lerMcpConfig(config: AppConfig): McpConfig {
  const producao = process.env.NODE_ENV === "production";
  const segredos = lerSegredos(config.MCP_GATEWAY_SECRETS);
  if (segredos.size === 0) throw new Error("MCP_ENABLED exige MCP_GATEWAY_SECRETS (id:segredo).");
  let clientes: ClientePreCadastrado[] = [];
  if (config.MCP_OAUTH_CLIENTS.trim()) {
    clientes = z.array(clienteSchema).parse(JSON.parse(config.MCP_OAUTH_CLIENTS));
  }
  const lista = (texto: string) => texto.split(",").map((item) => item.trim()).filter(Boolean);
  const temTls = Boolean(config.MCP_INTERNAL_TLS_CERT || config.MCP_INTERNAL_TLS_KEY || config.MCP_INTERNAL_TLS_CA);
  if (!temTls && (!config.MCP_INTERNAL_INSECURE || producao)) {
    throw new Error("MCP: o listener interno exige mTLS (MCP_INTERNAL_TLS_CERT, _KEY e _CA). Texto puro só fora de produção, com MCP_INTERNAL_INSECURE=1.");
  }
  if (temTls) validarMaterialTls({ cert: config.MCP_INTERNAL_TLS_CERT, key: config.MCP_INTERNAL_TLS_KEY, ca: config.MCP_INTERNAL_TLS_CA });
  const contratos = lista(config.MCP_CONTRATOS).map(Number);
  if (!contratos.length || contratos.some((n) => !Number.isInteger(n) || n < 1)) throw new Error("MCP_CONTRATOS inválido (ex.: 1 ou 1,2).");
  for (const uri of lista(config.MCP_OAUTH_REDIRECT_URIS)) if (!redirectPermitido({ hostsRedirect: [], redirectUris: [] }, uri)) throw new Error(`MCP_OAUTH_REDIRECT_URIS: URI não permitida (${uri}).`);
  return {
    inseguro: !temTls,
    contratos,
    clientesInternos: lista(config.MCP_INTERNAL_CLIENTES),
    redirectUris: lista(config.MCP_OAUTH_REDIRECT_URIS),
    cimdUrls: lista(config.MCP_OAUTH_CIMD_URLS),
    publicUrl: origem(config.MCP_PUBLIC_URL, "MCP_PUBLIC_URL", producao),
    appUrl: origem(config.APP_PUBLIC_URL, "APP_PUBLIC_URL", producao),
    segredos,
    clientesPreCadastrados: clientes,
    hostsRedirect: config.MCP_OAUTH_REDIRECT_HOSTS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
  };
}

/** Recurso OAuth (audience) de uma integração: exatamente a URL do endpoint MCP. */
export function recursoDaIntegracao(mcp: Pick<McpConfig, "publicUrl">, slug: string): string {
  return `${mcp.publicUrl}/mcp/${slug}`;
}

/** Extrai o slug de um recurso, só se for exatamente `${publicUrl}/mcp/<slug>`. */
export function slugDoRecurso(mcp: Pick<McpConfig, "publicUrl">, recurso: string): string | null {
  const prefixo = `${mcp.publicUrl}/mcp/`;
  if (!recurso.startsWith(prefixo)) return null;
  const slug = recurso.slice(prefixo.length);
  return /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/.test(slug) ? slug : null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Redirect URI aceitável: https (ou http só em loopback, para clientes nativos), sem credenciais e,
 * quando MCP_OAUTH_REDIRECT_HOSTS está definido, apenas nesses hosts. Vale para qualquer tipo de cliente
 * (pré-cadastrado, CIMD ou DCR): o consentimento só prossegue se todos os redirects do cliente passarem.
 */
export function redirectPermitido(mcp: Pick<McpConfig, "hostsRedirect" | "redirectUris">, uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const seguro = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!seguro) return false;
  // Lista exata tem precedência: só essas URIs, sem liberar o domínio inteiro.
  if (mcp.redirectUris.length) return mcp.redirectUris.includes(uri);
  return !mcp.hostsRedirect.length || mcp.hostsRedirect.includes(url.hostname.toLowerCase());
}
