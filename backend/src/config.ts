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
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(""),
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
  DNA_WORK_DB_HOST: z.string().optional().default(""),
  DNA_WORK_DB_PORT: z.coerce.number().int().positive().default(3306),
  DNA_WORK_DB_USER: z.string().optional().default(""),
  DNA_WORK_DB_PASS: z.string().optional().default(""),
  DNA_WORK_DB_NAME: z.string().optional().default(""),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(""),
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

