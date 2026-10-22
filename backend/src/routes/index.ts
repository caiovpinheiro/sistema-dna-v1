import { verify } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { many, one } from "../repositories/sql.js";
import { candidatoCreateSchema, candidatoListSchema, candidatoPatchSchema } from "../schemas/candidato.js";
import { contratacaoCreateSchema, contratacaoEncerrarSchema, contratacaoListSchema } from "../schemas/contratacao.js";
import { empresaCreateSchema, empresaListSchema, empresaPatchSchema } from "../schemas/empresa.js";
import { pageSchema } from "../schemas/common.js";
import { vagaCreateSchema, vagaListSchema, vagaPatchSchema } from "../schemas/vaga.js";
import type { CandidatoService } from "../services/candidato.service.js";
import type { ContratacaoService } from "../services/contratacao.service.js";
import type { DashboardService } from "../services/dashboard.service.js";
import type { EmpresaService } from "../services/empresa.service.js";
import { camposFromBody, type TceService } from "../services/tce.service.js";
import type { TermoService } from "../services/termo.service.js";
import { MANUAL_FIELDS } from "../lib/tce-fields.js";
import type { VagaService } from "../services/vaga.service.js";
import { sessionCookie } from "../plugins/auth.js";

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ success: true as const, data, meta });
const pageQuery = z.object(pageSchema);

type Services = {
  candidatos: CandidatoService;
  empresas: EmpresaService;
  vagas: VagaService;
  contratacoes: ContratacaoService;
  dashboard: DashboardService;
  termos: TermoService;
  tce: TceService;
};

function idempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !/^[A-Za-z0-9_.:-]{8,120}$/.test(value)) {
    throw new AppError(400, "IDEMPOTENCIA_OBRIGATORIA", "Informe o cabeçalho Idempotency-Key com 8 a 120 caracteres.");
  }
  return value;
}

export async function registerRoutes(app: FastifyInstance, config: AppConfig, services: Services, db: Pool): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get("/health", async () => ({ success: true, data: { status: "ok" }, meta: {} }));

  api.post("/api/v1/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: { tags: ["auth"], body: z.object({ email: z.string().trim().min(3), password: z.string().min(1) }) },
  }, async (request, reply) => {
    const body = request.body as { email: string; password: string };
    const email = body.email.trim().toLowerCase();
    const staff = await findStaff(db, email);
    const staffOk = staff?.ativo === true && await verify(staff.senha_hash, body.password);
    const bootstrapOk = !staff && email === config.ADMIN_EMAIL.toLowerCase() && await app.verifyAdminPassword(body.password);
    if (!staffOk && !bootstrapOk) throw new AppError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha inválidos.");
    const token = await reply.jwtSign({
      sub: staff && staffOk ? staff.id : "bootstrap-admin",
      email: staff && staffOk ? staff.email : config.ADMIN_EMAIL,
      role: "admin",
    });
    reply.setCookie("dnawork_session", token, sessionCookie(config));
    return ok({ email: staff && staffOk ? staff.email : config.ADMIN_EMAIL, role: "admin", nome: staff && staffOk ? staff.nome : "Administrador" });
  });

  api.get("/api/v1/auth/me", { schema: { tags: ["auth"] } }, async (request) => ok({
    email: request.user.email,
    role: request.user.role,
  }));

  api.post("/api/v1/auth/logout", { schema: { tags: ["auth"] } }, async (_request, reply) => {
    reply.clearCookie("dnawork_session", { path: "/" });
    return ok({ encerrada: true });
  });

  api.get("/api/v1/dashboard", { schema: { tags: ["dashboard"] } }, async () => ok(await services.dashboard.get()));

  api.get("/api/v1/modalidades", { schema: { tags: ["vagas"] } }, async () => {
    const rows = await many<{ id: number; descricao: string | null; descricaomenu: string | null; estudando: number | null }>(
      db,
      "SELECT id, descricao, descricaomenu, estudando FROM dna_work.modalidade_vaga ORDER BY id",
    );
    return ok(rows);
  });

  api.post("/api/v1/candidatos", { schema: { tags: ["candidatos"], body: candidatoCreateSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.candidatos.create(request.body)));
  });
  api.get("/api/v1/candidatos", { schema: { tags: ["candidatos"], querystring: candidatoListSchema } }, async (request) => {
    const result = await services.candidatos.list(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/candidatos/:id", { schema: { tags: ["candidatos"], params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    return ok(await services.candidatos.get(request.params.id));
  });
  api.patch("/api/v1/candidatos/:id", {
    schema: { tags: ["candidatos"], params: z.object({ id: z.string().min(1) }), body: candidatoPatchSchema },
  }, async (request) => ok(await services.candidatos.update(request.params.id, request.body)));
  api.get("/api/v1/candidatos/:id/contratacoes", {
    schema: { tags: ["candidatos"], params: z.object({ id: z.string().min(1) }), querystring: pageQuery },
  }, async (request) => {
    const result = await services.contratacoes.listByCandidato(request.params.id, request.query.page, request.query.pageSize);
    return ok(result.data, result.meta);
  });

  api.post("/api/v1/empresas", { schema: { tags: ["empresas"], body: empresaCreateSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.empresas.create(request.body)));
  });
  api.get("/api/v1/empresas", { schema: { tags: ["empresas"], querystring: empresaListSchema } }, async (request) => {
    const result = await services.empresas.list(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/empresas/:id", { schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    return ok(await services.empresas.get(request.params.id));
  });
  api.patch("/api/v1/empresas/:id", {
    schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }), body: empresaPatchSchema },
  }, async (request) => ok(await services.empresas.update(request.params.id, request.body)));
  api.get("/api/v1/empresas/:id/vagas", {
    schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }), querystring: pageQuery },
  }, async (request) => {
    await services.empresas.get(request.params.id);
    const result = await services.vagas.list({ ...request.query, id_empresa: request.params.id });
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/empresas/:id/contratacoes", {
    schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }), querystring: pageQuery },
  }, async (request) => {
    await services.empresas.get(request.params.id);
    const result = await services.contratacoes.listByEmpresa(request.params.id, request.query.page, request.query.pageSize);
    return ok(result.data, result.meta);
  });

  api.post("/api/v1/vagas", { schema: { tags: ["vagas"], body: vagaCreateSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.vagas.create(request.body)));
  });
  api.get("/api/v1/vagas", { schema: { tags: ["vagas"], querystring: vagaListSchema } }, async (request) => {
    const result = await services.vagas.list(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/vagas/:id", { schema: { tags: ["vagas"], params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    return ok(await services.vagas.get(request.params.id));
  });
  api.patch("/api/v1/vagas/:id", {
    schema: { tags: ["vagas"], params: z.object({ id: z.string().min(1) }), body: vagaPatchSchema },
  }, async (request) => ok(await services.vagas.update(request.params.id, request.body)));
  api.get("/api/v1/vagas/:id/contratacoes", {
    schema: { tags: ["vagas"], params: z.object({ id: z.string().min(1) }), querystring: pageQuery },
  }, async (request) => {
    const result = await services.contratacoes.listByVaga(request.params.id, request.query.page, request.query.pageSize);
    return ok(result.data, result.meta);
  });

  api.post("/api/v1/contratacoes", { schema: { tags: ["contratacoes"], body: contratacaoCreateSchema } }, async (request, reply) => {
    const result = await services.contratacoes.create(request.body, idempotencyKey(request.headers["idempotency-key"]));
    return reply.code(result.statusCode).send(result.body);
  });
  api.get("/api/v1/contratacoes", { schema: { tags: ["contratacoes"], querystring: contratacaoListSchema } }, async (request) => {
    const result = await services.contratacoes.list(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/contratacoes/:id", {
    schema: { tags: ["contratacoes"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.contratacoes.get(request.params.id)));
  api.post("/api/v1/contratacoes/:id/encerrar", {
    schema: {
      tags: ["contratacoes"],
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: contratacaoEncerrarSchema,
    },
  }, async (request) => ok(await services.contratacoes.encerrar(request.params.id, request.body)));

  api.get("/api/v1/termos", {
    schema: { tags: ["termos"], querystring: z.object({ status: z.enum(["gerado", "enviado", "assinado", "recusado", "cancelado"]).optional() }) },
  }, async (request) => ok(await services.termos.list(request.query.status)));
  api.get("/api/v1/termos/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.termos.get(request.params.id)));
  api.post("/api/v1/termos", {
    schema: { tags: ["termos"], body: z.object({ id_contratacao: z.number().int().positive() }) },
  }, async (request, reply) => reply.code(201).send(ok(await services.termos.criar(request.body.id_contratacao))));
  api.get("/api/v1/tce/empresas", { schema: { tags: ["termos"] } }, async () => ok(await services.tce.listarEmpresas()));
  api.get("/api/v1/tce/escolas", {
    schema: { tags: ["termos"], querystring: z.object({ q: z.string().max(120).optional() }) },
  }, async (request) => ok(await services.tce.buscarEscolas(request.query.q ?? "")));
  api.post("/api/v1/tce/gerar", {
    schema: {
      tags: ["termos"],
      body: z.object({
        empresa_id: z.string().uuid(),
        escola_id: z.string().max(255).optional().nullable(),
        concedente: z.object({
          razao_social: z.string().max(200).optional().default(""),
          cnpj: z.string().max(30).optional().default(""),
          endereco: z.string().max(300).optional().default(""),
          cep: z.string().max(20).optional().default(""),
          cidade: z.string().max(80).optional().default(""),
          estado: z.string().max(40).optional().default(""),
          email: z.string().max(160).optional().default(""),
          representante: z.string().max(160).optional().default(""),
        }),
        campos: z.record(z.string().max(4000)),
      }),
    },
  }, async (request, reply) => {
    const known = Object.fromEntries(MANUAL_FIELDS.map((key) => [key, request.body.campos[key] ?? ""]));
    const termo = await services.tce.gerar({
      empresaId: request.body.empresa_id,
      escolaId: request.body.escola_id || null,
      concedente: request.body.concedente,
      campos: camposFromBody(known),
    });
    return reply.code(201).send(ok(termo));
  });
  api.get("/api/v1/tce/:id/pdf", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request, reply) => {
    const pdf = await services.tce.lerPdf(request.params.id);
    return reply.type("application/pdf").header("Content-Disposition", "inline").send(pdf);
  });
  api.post("/api/v1/tce/:id/enviar", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.tce.enviar(request.params.id)));
  api.post("/api/v1/zapsign/webhook", async (request) => {
    const payload = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    return ok(await services.termos.receberWebhook(payload));
  });
}

type StaffUser = { id: string; nome: string; email: string; senha_hash: string; ativo: boolean };

async function findStaff(db: Pool, email: string): Promise<StaffUser | null> {
  try {
    return await one<StaffUser>(db, `
      SELECT id, nome, email, senha_hash, ativo
      FROM dna_work.app_usuario
      WHERE lower(email) = $1
    `, [email]);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

