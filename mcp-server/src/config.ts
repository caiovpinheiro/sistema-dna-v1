import { z } from "zod";

const bool = z.string().optional().transform((v) => v === "1" || v === "true");

const schema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Origem pública deste gateway (ex.: https://mcp.dnawork.ai). O `resource` OAuth é <origem>/mcp/<slug>. */
  MCP_PUBLIC_URL: z.string().min(1),
  /** Emissor OAuth = origem pública do painel. Precisa ser idêntico ao `issuer` do servidor de autorização. */
  MONOLITO_ISSUER_URL: z.string().min(1),
  /** Endereço do listener INTERNO do monólito, na rede privada (ex.: https://monolito:3334). */
  MONOLITO_INTERNAL_URL: z.string().min(1),
  /** Nome esperado no SAN do certificado do monólito (padrão: o host de MONOLITO_INTERNAL_URL). */
  MONOLITO_TLS_SERVERNAME: z.string().default(""),
  MCP_GATEWAY_KEY_ID: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  MCP_GATEWAY_SECRET: z.string().min(32),
  MCP_CONTRATO: z.coerce.number().int().min(1).default(1),
  /** mTLS: CA que assina o servidor interno e o par (certificado + chave) deste gateway. Arquivos montados/secrets. */
  MCP_TLS_CA: z.string().default(""),
  MCP_TLS_CERT: z.string().default(""),
  MCP_TLS_KEY: z.string().default(""),
  /** Sem mTLS: fala com o monólito em texto puro, autenticado só pela assinatura HMAC. Use apenas em rede privada. */
  MCP_GATEWAY_INSEGURO: bool,
  MCP_ALLOWED_HOSTS: z.string().default(""),
  MCP_ALLOWED_ORIGINS: z.string().default(""),
  TRUST_PROXY: bool,
  /** Descoberta inicial de ferramentas sem login (OpenAI/ChatGPT). Só metadados; nenhuma ferramenta executa sem OAuth. */
  MCP_DESCOBERTA_PUBLICA: z.string().optional().transform((v) => v === undefined || v === "" ? true : v === "1" || v === "true"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(25_000),
  CONNECT_TIMEOUT_MS: z.coerce.number().int().min(200).max(30_000).default(3_000),
  MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(4_000_000).default(262_144),
  RATE_LIMIT_POR_MIN: z.coerce.number().int().min(1).max(100_000).default(300),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
  CERT_RECHECK_MS: z.coerce.number().int().min(100).max(600_000).default(30_000),
});

export type GatewayConfig = {
  port: number;
  host: string;
  logLevel: string;
  publicUrl: string;
  issuerUrl: string;
  monolito: URL;
  servername: string;
  keyId: string;
  secret: string;
  contrato: number;
  tls: { ca: string; cert: string; key: string } | null;
  allowedHosts: string[];
  allowedOrigins: string[];
  trustProxy: boolean;
  descobertaPublica: boolean;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  maxBodyBytes: number;
  rateLimitPorMin: number;
  shutdownTimeoutMs: number;
  certRecheckMs: number;
};

function origem(valor: string, nome: string, producao: boolean): string {
  let url: URL;
  try { url = new URL(valor); } catch { throw new Error(`${nome} precisa ser uma URL.`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local && !producao)) throw new Error(`${nome} precisa usar https.`);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) throw new Error(`${nome} deve ser só a origem, sem caminho.`);
  return url.origin;
}

const lista = (t: string) => t.split(",").map((i) => i.trim().toLowerCase()).filter(Boolean);

/** Erros de configuração derrubam o processo no boot (configuração errada não "funciona pela metade"). */
export function lerConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Variáveis de ambiente inválidas: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  }
  const e = parsed.data;
  const producao = env.NODE_ENV === "production";
  const publicUrl = origem(e.MCP_PUBLIC_URL, "MCP_PUBLIC_URL", producao);
  const monolito = new URL(e.MONOLITO_INTERNAL_URL);
  const temTls = Boolean(e.MCP_TLS_CA || e.MCP_TLS_CERT || e.MCP_TLS_KEY);
  if (temTls && !(e.MCP_TLS_CA && e.MCP_TLS_CERT && e.MCP_TLS_KEY)) throw new Error("mTLS incompleto: informe MCP_TLS_CA, MCP_TLS_CERT e MCP_TLS_KEY.");
  if (!temTls) {
    if (!e.MCP_GATEWAY_INSEGURO) throw new Error("Informe MCP_TLS_CA, MCP_TLS_CERT e MCP_TLS_KEY (mTLS) ou, para usar só a assinatura HMAC em rede privada, MCP_GATEWAY_INSEGURO=1.");
    if (monolito.protocol !== "http:") throw new Error("Sem mTLS, MONOLITO_INTERNAL_URL deve ser http:// (rede privada, só assinatura HMAC).");
  } else if (monolito.protocol !== "https:") {
    throw new Error("Com mTLS, MONOLITO_INTERNAL_URL deve usar https://.");
  }
  return {
    port: e.PORT, host: e.HOST, logLevel: e.LOG_LEVEL,
    publicUrl, issuerUrl: origem(e.MONOLITO_ISSUER_URL, "MONOLITO_ISSUER_URL", producao),
    monolito, servername: e.MONOLITO_TLS_SERVERNAME || monolito.hostname,
    keyId: e.MCP_GATEWAY_KEY_ID, secret: e.MCP_GATEWAY_SECRET, contrato: e.MCP_CONTRATO,
    tls: temTls ? { ca: e.MCP_TLS_CA, cert: e.MCP_TLS_CERT, key: e.MCP_TLS_KEY } : null,
    allowedHosts: lista(e.MCP_ALLOWED_HOSTS).length ? lista(e.MCP_ALLOWED_HOSTS) : [new URL(publicUrl).host.toLowerCase()],
    allowedOrigins: lista(e.MCP_ALLOWED_ORIGINS),
    trustProxy: e.TRUST_PROXY, descobertaPublica: e.MCP_DESCOBERTA_PUBLICA, requestTimeoutMs: e.REQUEST_TIMEOUT_MS, connectTimeoutMs: e.CONNECT_TIMEOUT_MS,
    maxBodyBytes: e.MAX_BODY_BYTES, rateLimitPorMin: e.RATE_LIMIT_POR_MIN, shutdownTimeoutMs: e.SHUTDOWN_TIMEOUT_MS, certRecheckMs: e.CERT_RECHECK_MS,
  };
}
