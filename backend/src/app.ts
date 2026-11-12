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
import { CurriculoService } from "./services/curriculo.service.js";
import { TriagemMatchingService } from "./services/triagem-matching.service.js";
import { criarTransporteJev } from "./lib/jev/jev.js";
import { CargoService } from "./services/cargo.service.js";
import { normalizarAtendimento } from "./lib/atendimento.js";
import { iniciarAgendaRegua } from "./lib/regua-agenda.js";
import { atendimentoSchema } from "./schemas/processo.js";
import { NotionSyncService } from "./services/notion-sync.service.js";
import { VagasAbertasSyncService } from "./services/vagas-abertas-sync.service.js";
import { SyncCicloService } from "./services/sync-ciclo.service.js";
import { CargosSyncService } from "./services/cargos-sync.service.js";
import { agendarPorSlot } from "./lib/agenda-sync.js";
import { usarBancoTracker } from "./origem/tracker-db.js";
import { criarAcessoLms } from "./lib/lms-acesso.js";
import { z } from "zod";

export type AppContext = {
  config: AppConfig;
  db: Pool;
  capabilities: SchemaCapabilities;
  mysql?: MysqlPool | null;
  /** Só o server.ts liga: roda o sync (vagas abertas + Notion) nos slots 00, 06, 12 e 18 de São Paulo. */
  agendarSyncNotion?: boolean;
};

export async function buildApp(context: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : {
      level: "info",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.cpf", "req.body.chave_pix", "req.body.cnpj", "res.body.data.password"],
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

  usarBancoTracker(context.db);
  const candidatos = new CandidatoRepository(context.config.CONTRATACAO_STATUS_ATIVO, context.config.CONTRATACAO_STATUS_ENCERRADO);
  const empresas = new EmpresaRepository();
  const vagas = new VagaRepository(context.config.CONTRATACAO_STATUS_ATIVO, context.config.vagaStatusBloqueadas);
  const contratacoes = new ContratacaoRepository();
  const processos = new ProcessoService(context.db, new ProcessoRepository(), vagas, candidatos, empresas);
  const termos = new TermoService(context.db, context.config);
  const cargos = new CargoService(context.db, context.config);
  const services = {
    candidatos: new CandidatoService(context.db, candidatos),
    empresas: new EmpresaService(context.db, empresas),
    vagas: new VagaService(context.db, vagas, empresas, context.config, context.capabilities, context.mysql ?? null),
    contratacoes: new ContratacaoService(context.db, contratacoes, vagas, candidatos, context.config, context.capabilities, processos),
    processos,
    dashboard: new DashboardService(context.db, contratacoes, context.config),
    termos,
    tce: new TceService(context.db, context.config, termos),
    asaas: new AsaasService(context.db, context.config),
    regua: new ReguaService(context.db, context.config),
    acesso: new AcessoService(context.db, context.config),
    cadastro: new CadastroService(context.db, context.mysql ?? null, context.config, cargos),
    cargos,
    triagem: new TriagemService(context.db, context.mysql ?? null, context.config),
    curriculo: new CurriculoService(context.config),
    matching: new TriagemMatchingService(context.db, context.config, criarTransporteJev(context.config)),
    sync: new SyncCicloService(
      new VagasAbertasSyncService(context.db, context.mysql ?? null, context.config, app.log),
      new CargosSyncService(context.db, context.config, cargos, app.log),
      new NotionSyncService(context.db, context.mysql ?? null, context.config, app.log),
      app.log,
    ),
  };

  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0];
    if (request.method === "OPTIONS") return;
    if (path === "/health" || path === "/api/v1/auth/login" || path === "/api/v1/zapsign/webhook" || path === "/api/v1/asaas/webhook" || path === "/api/v1/webhooks/lead-criado" || path === "/api/v1/webhooks/ganho" || path === "/api/v1/servico/ping" || path === "/api/v1/servico/empresas" || path === "/api/v1/servico/processos" || path === "/api/v1/servico/candidatos" || path.startsWith("/docs")) return;
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
  app.withTypeProvider<ZodTypeProvider>().post("/api/v1/candidatos/:id/acesso-lms", {
    schema: {
      tags: ["candidatos"],
      params: z.object({ id: z.string().min(1) }),
      body: z.object({
        trails: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
        password: z.string().trim().max(72).optional(),
        resetPassword: z.boolean().optional(),
      }),
    },
  }, async (request) => {
    const ficha = await services.candidatos.get(request.params.id);
    return {
      success: true as const,
      data: await criarAcessoLms({
        token: context.config.LMS_ACCESS_TOKEN,
        baseUrl: context.config.LMS_API_URL,
        name: ficha.nome ?? "",
        email: ficha.email ?? "",
        password: request.body.password,
        resetPassword: request.body.resetPassword,
      }),
      meta: {},
    };
  });
  const agendaRegua = iniciarAgendaRegua({
    ativo: context.config.REGUA_AGENDA === "1",
    envioReal: context.config.REGUA_ENVIO_REAL === "1",
    executar: (hoje) => services.regua.executarReal(hoje),
    erro: (error) => app.log.error({ erro: error instanceof Error ? error.message : String(error) }, "regua: ciclo falhou"),
  });
  app.addHook("onClose", async () => agendaRegua.parar());
  if (context.agendarSyncNotion) {
    const parar = agendarPorSlot(
      (slot) => services.sync.executar(context.config.NOTION_SYNC_DRY, slot),
      (error) => app.log.error({ erro: error instanceof Error ? error.message : String(error) }, "sync: ciclo falhou"),
    );
    app.addHook("onClose", async () => parar());
  }
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
  app.get("/api/v1/servico/candidatos", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    const query = request.query as { telefone?: string; celular?: string; cpf?: string; dealId?: string; deal_id?: string };
    try {
      const data = await services.processos.buscarCandidato({
        telefone: query.telefone || query.celular,
        cpf: query.cpf,
        dealId: query.dealId || query.deal_id,
      });
      return { success: true, data, meta: {} };
    } catch (error) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      }
      throw error;
    }
  });
  app.post("/api/v1/servico/candidatos", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    const corpo = atendimentoSchema.safeParse(normalizarAtendimento(request.body));
    if (!corpo.success) {
      return reply.code(422).send({ success: false, error: { code: "VALIDACAO", message: corpo.error.issues[0]?.message ?? "Dados inválidos.", details: corpo.error.issues } });
    }
    try {
      const data = await services.processos.criarCandidato(corpo.data);
      return reply.code(data.criado ? 201 : 200).send({ success: true, data, meta: {} });
    } catch (error) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      }
      throw error;
    }
  });
  app.patch("/api/v1/servico/candidatos", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    const corpo = atendimentoSchema.safeParse(normalizarAtendimento(request.body));
    if (!corpo.success) {
      return reply.code(422).send({ success: false, error: { code: "VALIDACAO", message: corpo.error.issues[0]?.message ?? "Dados inválidos.", details: corpo.error.issues } });
    }
    try {
      const data = await services.processos.atualizarCandidato(corpo.data);
      return { success: true, data, meta: {} };
    } catch (error) {
      if (error instanceof AppError) {
        return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, details: error.details } });
      }
      throw error;
    }
  });
  app.post("/api/v1/servico/processos", async (request, reply) => {
    if (!tokenDoServico(request.headers["x-service-token"], context.config.SERVICE_TOKEN)) {
      return reply.code(401).send({ success: false, error: { code: "SERVICO_NEGADO", message: "Serviço não autorizado." } });
    }
    const corpo = atendimentoSchema.safeParse(normalizarAtendimento(request.body));
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
