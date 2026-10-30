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
import type { MysqlPool } from "./db/mysql.js";
import type { AppConfig } from "./config.js";
import type { SchemaCapabilities } from "./db/capabilities.js";
import { AppError } from "./lib/errors.js";
import { paginasDaApi } from "./lib/paginas.js";
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
import { AsaasService } from "./services/asaas.service.js";
import { ReguaService } from "./services/regua.service.js";
import { TceService } from "./services/tce.service.js";
import { TermoService } from "./services/termo.service.js";
import { ProcessoService } from "./services/processo.service.js";
import { ProcessoRepository } from "./repositories/processo.repository.js";
import { AcessoService } from "./services/acesso.service.js";
import { VagaService } from "./services/vaga.service.js";
import { CadastroService } from "./services/cadastro.service.js";
import { TriagemService } from "./services/triagem.service.js";
import { atendimentoSchema } from "./schemas/processo.js";

export type AppContext = {
  config: AppConfig;
  db: Pool;
  capabilities: SchemaCapabilities;
  mysql?: MysqlPool | null;
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
      const lista = err.validation as Array<{ message?: string }>;
      const primeira = lista.find((item) => item?.message)?.message;
      return reply.code(422).send({
        success: false,
        error: { code: "VALIDACAO", message: primeira || "Dados inválidos.", details: err.validation },
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
  const processos = new ProcessoService(context.db, new ProcessoRepository(), vagas, candidatos, empresas);
  const termos = new TermoService(context.db, context.config);
  const services = {
    candidatos: new CandidatoService(context.db, candidatos),
    empresas: new EmpresaService(context.db, empresas),
    vagas: new VagaService(context.db, vagas, empresas, context.config, context.capabilities),
    contratacoes: new ContratacaoService(context.db, contratacoes, vagas, candidatos, context.config, context.capabilities, processos),
    processos,
    dashboard: new DashboardService(context.db, contratacoes, context.config),
    termos,
    tce: new TceService(context.db, context.config, termos),
    asaas: new AsaasService(context.db, context.config),
    regua: new ReguaService(context.db, context.config),
    acesso: new AcessoService(context.db, context.config),
    cadastro: new CadastroService(context.db, context.mysql ?? null, context.config),
    triagem: new TriagemService(context.mysql ?? null, context.config),
  };

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0];
    if (request.method === "OPTIONS") return;
    if (path === "/health" || path === "/api/v1/auth/login" || path === "/api/v1/zapsign/webhook" || path === "/api/v1/asaas/webhook" || path === "/api/v1/servico/ping" || path === "/api/v1/servico/empresas" || path === "/api/v1/servico/processos" || path.startsWith("/docs")) return;
    if (path.startsWith("/api/")) await app.authenticate(request);
    if (!path.startsWith("/api/v1/") || path.startsWith("/api/v1/auth/")) return;
    const sessao = await services.acesso.daSessao(request.user.sub, request.user.email);
    if (path.startsWith("/api/v1/configuracoes")) {
      if (!sessao.admin) throw new AppError(403, "ACESSO_NEGADO", "Somente o administrador configura os acessos.");
      return;
    }
    if (!sessao.admin && !sessao.ativo) throw new AppError(403, "SEM_ACESSO", "Seu acesso está desativado.");
    const necessarias = paginasDaApi(path);
    if (necessarias.length && !sessao.admin && !necessarias.some((pagina) => sessao.paginas.includes(pagina))) {
      throw new AppError(403, "PAGINA_NEGADA", "Você não tem acesso a esta página.");
    }
  });

  await registerRoutes(app, context.config, services, context.db);
  const { pingServico, tokenDoServico } = await import("./lib/servico.js");
  app.get("/api/v1/servico/ping", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    return { success: true, data: { servico: "interno" } };
  });
  app.get("/api/v1/servico/empresas", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    if (!context.config.EMPRESAS_API_URL) {
      return reply.code(503).send({ success: false, error: { code: "SERVICO_NAO_CONFIGURADO", message: "EMPRESAS_API_URL não está definido." } });
    }
    const empresas = await pingServico(context.config.EMPRESAS_API_URL, context.config.SERVICE_TOKEN);
    return { success: true, data: empresas };
  });
  app.post("/api/v1/servico/processos", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    const corpo = atendimentoSchema.safeParse(request.body);
    if (!corpo.success) {
      return reply.code(422).send({ success: false, error: { code: "VALIDACAO", message: corpo.error.issues[0]?.message ?? "Dados inválidos.", details: corpo.error.issues } });
    }
    try {
      const data = await services.processos.receberAtendimento(corpo.data);
      return reply.code(data.criado ? 201 : 200).send({ success: true, data, meta: {} });
    } catch (error) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      }
      throw error;
    }
  });
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
