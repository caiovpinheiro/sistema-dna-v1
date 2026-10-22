import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { jsonSchemaTransform, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import type { SchemaCapabilities } from "./db/capabilities.js";
import { AppError } from "./lib/errors.js";
import { registerAuth } from "./plugins/auth.js";
import { CandidatoRepository } from "./repositories/candidato.repository.js";
import { ContratacaoRepository } from "./repositories/contratacao.repository.js";
import { EmpresaRepository } from "./repositories/empresa.repository.js";
import { VagaRepository } from "./repositories/vaga.repository.js";
import { registerRoutes } from "./routes/index.js";
import { CandidatoService } from "./services/candidato.service.js";
import { ContratacaoService } from "./services/contratacao.service.js";
import { DashboardService } from "./services/dashboard.service.js";
import { EmpresaService } from "./services/empresa.service.js";
import { TceService } from "./services/tce.service.js";
import { TermoService } from "./services/termo.service.js";
import { VagaService } from "./services/vaga.service.js";

export type AppContext = {
  config: AppConfig;
  db: Pool;
  capabilities: SchemaCapabilities;
};

export async function buildApp(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.cpf", "req.body.chave_pix", "req.body.cnpj"],
    },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    const err = error as { message?: string; statusCode?: number; validation?: unknown };
    if (err.validation) {
      return reply.code(422).send({
        success: false,
        error: { code: "VALIDACAO", message: "Dados inválidos.", details: err.validation },
      });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({
        success: false,
        error: { code: "MUITAS_REQUISICOES", message: "Muitas tentativas. Aguarde um instante." },
      });
    }
    request.log.error({ message: err.message }, "erro interno");
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({
      success: false,
      error: { code: "ERRO_INTERNO", message: "Erro interno." },
    });
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: context.config.corsOrigins, credentials: true });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "DNAWORK API",
        description: "API administrativa da DNAWORK V1. Autenticação por cookie httpOnly.",
        version: "1.0.0",
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await registerAuth(app, context.config);

  const candidatos = new CandidatoRepository(context.config.CONTRATACAO_STATUS_ATIVO, context.config.CONTRATACAO_STATUS_ENCERRADO);
  const empresas = new EmpresaRepository();
  const vagas = new VagaRepository(context.config.CONTRATACAO_STATUS_ATIVO, context.config.vagaStatusBloqueadas);
  const contratacoes = new ContratacaoRepository();
  const termos = new TermoService(context.db, context.config);
  const services = {
    candidatos: new CandidatoService(context.db, candidatos),
    empresas: new EmpresaService(context.db, empresas),
    vagas: new VagaService(context.db, vagas, empresas, context.config, context.capabilities),
    contratacoes: new ContratacaoService(context.db, contratacoes, vagas, candidatos, context.config, context.capabilities),
    dashboard: new DashboardService(context.db, contratacoes, context.config, context.capabilities),
    termos,
    tce: new TceService(context.db, context.config, termos),
  };

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0];
    if (request.method === "OPTIONS") return;
    if (path === "/health" || path === "/api/v1/auth/login" || path === "/api/v1/zapsign/webhook" || path.startsWith("/docs")) return;
    if (path.startsWith("/api/")) await app.authenticate(request);
  });

  await registerRoutes(app, context.config, services, context.db);
  await serveFrontend(app);
  return app;
}

async function serveFrontend(app: FastifyInstance): Promise<void> {
  const frontendDist = process.env.FRONTEND_DIST;
  if (!frontendDist || !fs.existsSync(frontendDist)) return;
  await app.register(fastifyStatic, { root: path.resolve(frontendDist) });
  app.setNotFoundHandler((request, reply) => {
    const url = request.url.split("?")[0];
    if (request.method === "GET" && !url.startsWith("/api") && !url.startsWith("/docs")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      success: false,
      error: { code: "NAO_ENCONTRADO", message: "Rota não encontrada." },
    });
  });
}
