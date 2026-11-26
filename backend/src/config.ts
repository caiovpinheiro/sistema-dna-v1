import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: path.resolve(process.cwd(), ".env") });
loadDotenv({ path: path.resolve(process.cwd(), "../.env") });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD_HASH: z.string().optional().default(""),
  ADMIN_PASSWORD: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default("127.0.0.1"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  /** Duração do login. Em produção fica 8 h; no .env local pode ser maior para não precisar entrar a cada teste. */
  SESSAO_HORAS: z.coerce.number().int().min(1).max(24 * 90).default(8),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  CONTRATACAO_STATUS_ATIVO: z.coerce.number().int().default(1),
  CONTRATACAO_STATUS_ENCERRADO: z.coerce.number().int().default(2),
  VAGA_STATUS_OCUPADA: z.coerce.number().int().default(1),
  VAGA_STATUS_ENCERRADA: z.coerce.number().int().default(2),
  VAGA_STATUS_BLOQUEADAS: z.string().default("2"),
  COLABORADOR_STATUS_ATIVO: z.coerce.number().int().default(1),
  COLABORADOR_STATUS_INATIVO: z.coerce.number().int().default(0),
  ALLOW_MULTIPLE_ACTIVE_LINKS: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ZAPSIGN_API_TOKEN: z.string().optional().default(""),
  ZAPSIGN_API_URL: z.string().optional().default("https://api.zapsign.com.br"),
  ZAPSIGN_USER_TOKEN: z.string().optional().default(""),
  ZAPSIGN_AGENTE_ID: z.string().optional().default(""),
  PDF_STORAGE_DIR: z.string().optional().default(""),
  ASAAS_API_KEY: z.string().optional().default(""),
  ASAAS_API_URL: z.string().optional().default("https://api.asaas.com"),
  ASAAS_WEBHOOK_TOKEN: z.string().optional().default(""),
  EMPRESAS_API_URL: z.string().optional().default(""),
  SERVICE_TOKEN: z.string().optional().default(""),
  MAILJET_API_KEY: z.string().optional().default(""),
  MAILJET_SECRET_KEY: z.string().optional().default(""),
  MAILJET_FROM: z.string().optional().default("documentos@dnawork.ai"),
  MAILJET_FROM_NAME: z.string().optional().default("DNA Work"),
  // Só "1" envia e-mail de verdade. "0" mantém a régua desligada.
  REGUA_ENVIO_REAL: z.string().optional().default("0"),
  // Só "1" arma o relógio das 08:00 em America/Sao_Paulo. "0" deixa o agendamento parado.
  REGUA_AGENDA: z.string().optional().default("0"),
  REGUA_INICIO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default("2026-11-10"),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
  NOTION_TOKEN: z.string().optional().default(""),
  NOTION_SYNC_DRY: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  LMS_ACCESS_TOKEN: z.string().optional().default(""),
  LMS_API_URL: z.string().optional().default("https://cursos.dnawork.ai"),
  // Triagem inteligente: resumo de currículo pela OpenAI (Luna). Sem chave, a análise responde 503 e a busca rápida segue igual.
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_API_URL: z.string().optional().default("https://api.openai.com/v1"),
  LUNA_MODEL: z.string().optional().default("gpt-6-luna"),
  LUNA_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(90_000),
  // Triagem inteligente: score profissional pelo JEV (TypeSafe). Sem URL e chave, as vagas aparecem como "avaliação indisponível".
  JEV_API_URL: z.string().optional().default(""),
  JEV_API_KEY: z.string().optional().default(""),
  JEV_MODEL: z.string().optional().default("jev-latest"),
  JEV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  JEV_CONCORRENCIA: z.coerce.number().int().min(1).max(10).default(3),
  JEV_LOTE: z.coerce.number().int().min(1).max(30).default(10),
  // MCP (serviço mcp-server). Desligado por padrão: com MCP_ENABLED fora de "1"/"true", nada abaixo é registrado.
  MCP_ENABLED: z.string().optional().transform((value) => value === "1" || value === "true"),
  // URL pública do gateway (ex.: https://mcp.dnawork.ai) e do painel (emissor OAuth). Só origem, sem caminho.
  MCP_PUBLIC_URL: z.string().optional().default(""),
  APP_PUBLIC_URL: z.string().optional().default(""),
  // Porta só da rede privada: rotas /internal/mcp/*. Nunca publicar no domínio.
  MCP_INTERNAL_PORT: z.coerce.number().int().positive().default(3334),
  MCP_INTERNAL_HOST: z.string().default("0.0.0.0"),
  // "id:segredo" separados por vírgula (o primeiro é o atual). Cada segredo tem 32+ caracteres. Permite rotação.
  MCP_GATEWAY_SECRETS: z.string().optional().default(""),
  MCP_HMAC_JANELA_S: z.coerce.number().int().min(5).max(300).default(60),
  // TLS/mTLS opcional no listener interno (caminhos de arquivo PEM).
  MCP_INTERNAL_TLS_CERT: z.string().optional().default(""),
  MCP_INTERNAL_TLS_KEY: z.string().optional().default(""),
  MCP_INTERNAL_TLS_CA: z.string().optional().default(""),
  // OAuth: DCR desligado por padrão; clientes previamente cadastrados em JSON (segredos só no ambiente).
  MCP_OAUTH_DCR: z.string().optional().transform((value) => value === "1" || value === "true"),
  MCP_OAUTH_CLIENTS: z.string().optional().default(""),
  MCP_OAUTH_REDIRECT_HOSTS: z.string().optional().default(""),
  MCP_OAUTH_COOKIE_SECRET: z.string().optional().default(""),
  // Limite por IP nos endpoints /oauth/token, /oauth/revoke e /oauth/register (por minuto).
  MCP_OAUTH_RATE_POR_MIN: z.coerce.number().int().min(1).max(10_000).default(30),
  MCP_ACCESS_TTL_S: z.coerce.number().int().min(60).max(86_400).default(3_600),
  MCP_REFRESH_TTL_S: z.coerce.number().int().min(3_600).max(7_776_000).default(2_592_000),
  MCP_RATE_USUARIO_POR_MIN: z.coerce.number().int().min(1).max(10_000).default(120),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  vagaStatusBloqueadas: number[];
};

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Variáveis de ambiente inválidas: ${fields}`);
  }
  if (!parsed.data.ADMIN_PASSWORD_HASH && !parsed.data.ADMIN_PASSWORD) {
    throw new Error("Defina ADMIN_PASSWORD_HASH ou ADMIN_PASSWORD.");
  }
  const vagaStatusBloqueadas = parsed.data.VAGA_STATUS_BLOQUEADAS.split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item));
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean),
    vagaStatusBloqueadas,
  };
}
