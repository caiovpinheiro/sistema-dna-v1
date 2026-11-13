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
import { processoCreateSchema, processoListSchema, processoMoverSchema } from "../schemas/processo.js";
import { vagaCreateSchema, vagaListSchema, vagaPatchSchema, vagaPrioridadeSchema } from "../schemas/vaga.js";
import { empresaCadastroSchema, grupoCreateSchema, modeloVagaSchema, vagaCadastroSchema } from "../schemas/cadastro.js";
import { documentoSchema } from "../schemas/documento-contrato.js";
import { gerarDocumento } from "../lib/documento-contrato.js";
import { notasSugeridas } from "../lib/nota-fiscal.js";
import { buildRescisaoMedioPdf } from "../lib/rescisao-medio-pdf.js";
import type { AsaasService } from "../services/asaas.service.js";
import type { ReguaService } from "../services/regua.service.js";
import type { CandidatoService } from "../services/candidato.service.js";
import type { ContratacaoService } from "../services/contratacao.service.js";
import type { DashboardService } from "../services/dashboard.service.js";
import type { MetricasService } from "../services/metricas.service.js";
import type { EmpresaService } from "../services/empresa.service.js";
import { camposFromBody, type TceService } from "../services/tce.service.js";
import type { TermoService } from "../services/termo.service.js";
import { MANUAL_FIELDS } from "../lib/tce-fields.js";
import { arquivoDoDocumento, candidatoDoTce, gravarDocumentosDoTce, listarDocumentos } from "../repositories/candidato-documento.repository.js";
import { valorDaEmpresa, valoresDoGrupo } from "../repositories/valor-empresa.repository.js";
import { origemComCache } from "../origem/cache.js";
import { webhookGanho } from "../origem/webhook-ganho.js";
import { webhookLeadCriado } from "../origem/webhook-lead-criado.js";
import { listarModelosEmail, salvarModeloEmail, excluirModeloEmail } from "../lib/email-modelo.js";
import type { ProcessoService } from "../services/processo.service.js";
import type { AcessoService } from "../services/acesso.service.js";
import type { VagaService } from "../services/vaga.service.js";
import { LegadoService } from "../services/legado.service.js";
import type { CadastroService } from "../services/cadastro.service.js";
import type { TriagemService } from "../services/triagem.service.js";
import type { CurriculoService } from "../services/curriculo.service.js";
import type { TriagemMatchingService } from "../services/triagem-matching.service.js";
import type { DossieService } from "../services/dossie.service.js";
import type { InstituicaoService } from "../services/instituicao.service.js";
import { prepararCurriculo } from "../lib/curriculo/arquivo.js";
import type { CargoService } from "../services/cargo.service.js";
import type { SyncCicloService } from "../services/sync-ciclo.service.js";
import { sessionCookie } from "../plugins/auth.js";

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ success: true as const, data, meta });
const pageQuery = z.object(pageSchema);

type Services = {
  candidatos: CandidatoService;
  empresas: EmpresaService;
  vagas: VagaService;
  contratacoes: ContratacaoService;
  processos: ProcessoService;
  dashboard: DashboardService;
  metricas: MetricasService;
  termos: TermoService;
  tce: TceService;
  asaas: AsaasService;
  regua: ReguaService;
  acesso: AcessoService;
  cadastro: CadastroService;
  triagem: TriagemService;
  curriculo: CurriculoService;
  matching: TriagemMatchingService;
  dossie: DossieService;
  instituicoes: InstituicaoService;
  cargos: CargoService;
  sync: SyncCicloService;
};

function idempotencyKey(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !/^[A-Za-z0-9_.:-]{8,120}$/.test(value)) {
    throw new AppError(400, "IDEMPOTENCIA_OBRIGATORIA", "Informe o cabeçalho Idempotency-Key com 8 a 120 caracteres.");
  }
  return value;
}

export async function registerRoutes(app: FastifyInstance, config: AppConfig, services: Services, db: Pool): Promise<void> {
  const guardarDocumentosDoTce = (log: { warn: (o: unknown, m: string) => void }, input: { idCandidato?: string | null; idContratacao?: number | null; campos: Record<string, string>; tceId: string }) =>
    guardarDocumentosDoTceCom(db, log, input);
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

  api.get("/api/v1/auth/me", { schema: { tags: ["auth"] } }, async (request) => {
    const sessao = await services.acesso.daSessao(request.user.sub, request.user.email);
    return ok({
      email: request.user.email,
      role: request.user.role,
      admin: sessao.admin,
      paginas: sessao.paginas,
    });
  });

  api.post("/api/v1/auth/logout", { schema: { tags: ["auth"] } }, async (_request, reply) => {
    reply.clearCookie("dnawork_session", { path: "/" });
    return ok({ encerrada: true });
  });

  // Origem dos candidatos: só lê tracker_leads/tracker_ganhos (Postgres) e o CRM; quem grava são os webhooks abaixo.
  api.get("/api/v1/dashboard/origem", {
    schema: { tags: ["dashboard"], querystring: z.object({ from: z.string().optional(), to: z.string().optional() }) },
  }, async (request, reply) => {
    const resultado = await origemComCache(db, request.query.from ?? null, request.query.to ?? null);
    return reply.code(resultado.status).send(resultado.body);
  });
  // Webhooks do CRM DNA e do n8n (públicos, como no app candidaturas).
  api.post("/api/v1/webhooks/lead-criado", async (request, reply) => {
    const resultado = await webhookLeadCriado(request.body ?? {});
    return reply.code(resultado.status).send(resultado.body);
  });
  api.post("/api/v1/webhooks/ganho", async (request, reply) => {
    const resultado = await webhookGanho(request.body ?? {});
    return reply.code(resultado.status).send(resultado.body);
  });
  api.get("/api/v1/dashboard", {
    schema: {
      tags: ["dashboard"],
      querystring: z.object({
        dias: z.coerce.number().int().min(1).max(366).optional(),
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    },
  }, async (request) => ok(await services.dashboard.get(request.query)));

  // Só administrador (bloqueio em app.ts). Só leitura de dna_work.conratacaovaga + vaga.
  api.get("/api/v1/metricas/permanencia-estagio", {
    schema: {
      tags: ["metricas"],
      querystring: z.object({
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        modo: z.enum(["inicio", "ativos"]).optional(),
      }),
    },
  }, async (request) => ok(await services.metricas.permanenciaEstagio(request.query)));

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
  api.get("/api/v1/candidatos/:id/documentos", {
    schema: { tags: ["candidatos"], params: z.object({ id: z.string().min(1) }) },
  }, async (request) => ok(await listarDocumentos(db, request.params.id)));
  api.get("/api/v1/candidatos/:id/documentos/:documento/arquivo", {
    schema: { tags: ["candidatos"], params: z.object({ id: z.string().min(1), documento: z.string().uuid() }) },
  }, async (request, reply) => {
    const arquivo = await arquivoDoDocumento(db, request.params.id, request.params.documento);
    if (!arquivo?.arquivo) throw new AppError(404, "ARQUIVO_NAO_ENCONTRADO", "Este documento não tem arquivo.");
    const nome = arquivo.arquivo_nome || "documento";
    return reply
      .type(arquivo.arquivo_tipo || "application/octet-stream")
      .header("Content-Disposition", `inline; filename="${nome.replace(/[^\w.\-]+/g, "_")}"`)
      .header("Cache-Control", "private, no-store")
      .send(arquivo.arquivo);
  });
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
  api.get("/api/v1/empresas/:id/cobranca", { schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }) } }, async (request) => {
    return ok(await valorDaEmpresa(db, request.params.id));
  });
  api.post("/api/v1/empresas/:id/acesso-portal", {
    schema: {
      tags: ["empresas"],
      params: z.object({ id: z.string().min(1) }),
      body: z.object({ email: z.string().trim().max(255).optional(), redefinir: z.boolean().optional() }),
    },
  }, async (request) => ok(await services.empresas.gerarAcessoPortal(request.params.id, request.body)));
  api.patch("/api/v1/empresas/:id", {
    schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }), body: empresaPatchSchema },
  }, async (request) => ok(await services.empresas.update(request.params.id, request.body)));
  api.get("/api/v1/empresas/:id/vagas", {
    schema: { tags: ["empresas"], params: z.object({ id: z.string().min(1) }), querystring: pageQuery.extend({ situacao: z.enum(["aberta", "pausada", "contratada", "fechada"]).optional() }) },
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
  api.get("/api/v1/vagas/modelos", {
    schema: {
      tags: ["vagas"],
      querystring: z.object({
        cargo: z.string().trim().optional(),
        tipo: z.enum(["estagio", "clt", "pj"]).optional(),
      }),
    },
  }, async (request) => ok(await services.cadastro.consultarModelos(request.query)));
  api.get("/api/v1/vagas/modelos/opcoes", { schema: { tags: ["vagas"] } }, async () => ok(await services.cadastro.opcoesModelos()));
  api.get("/api/v1/vagas/modelos/:vagaId", {
    schema: { tags: ["vagas"], params: z.object({ vagaId: z.string().uuid() }) },
  }, async (request) => ok(await services.cadastro.obterModelo(request.params.vagaId)));
  api.post("/api/v1/vagas/modelos", { schema: { tags: ["vagas"], body: modeloVagaSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.cadastro.criarModelo(request.body)));
  });
  api.put("/api/v1/vagas/modelos/:vagaId", {
    schema: { tags: ["vagas"], params: z.object({ vagaId: z.string().uuid() }), body: modeloVagaSchema },
  }, async (request) => ok(await services.cadastro.editarModelo(request.params.vagaId, request.body)));
  api.delete("/api/v1/vagas/modelos/:vagaId", {
    schema: { tags: ["vagas"], params: z.object({ vagaId: z.string().uuid() }) },
  }, async (request) => ok(await services.cadastro.apagarModelo(request.params.vagaId)));
  api.get("/api/v1/vagas/filtros", { schema: { tags: ["vagas"] } }, async () => ok(await services.vagas.opcoesFiltro()));
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
  api.put("/api/v1/vagas/:id/prioridade", {
    schema: { tags: ["vagas"], params: z.object({ id: z.string().min(1) }), body: vagaPrioridadeSchema },
  }, async (request) => ok(await services.vagas.definirPrioridade(request.params.id, request.body.prioridade)));
  api.get("/api/v1/vagas/:id/sugeridos", {
    schema: { tags: ["vagas"], params: z.object({ id: z.string().min(1) }) },
  }, async (request) => ok(await services.vagas.sugeridos(request.params.id)));
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
  api.get("/api/v1/contratacoes/:id/documentos", {
    schema: { tags: ["contratacoes"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.contratacoes.documentos(request.params.id)));
  api.post("/api/v1/contratacoes/:id/encerrar", {
    schema: {
      tags: ["contratacoes"],
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: contratacaoEncerrarSchema,
    },
  }, async (request) => ok(await services.contratacoes.encerrar(request.params.id, request.body)));
  api.get("/api/v1/contratacoes/:id/rescisao.pdf", {
    schema: { tags: ["contratacoes"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request, reply) => {
    const pdf = await services.contratacoes.pdfRescisao(request.params.id);
    return reply.type("application/pdf").header("Content-Disposition", "inline; filename=\"rescisao.pdf\"").send(pdf);
  });
  api.get("/api/v1/contratacoes/:id/assinatura", {
    schema: { tags: ["contratacoes"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.contratacoes.acompanharAssinatura(request.params.id)));
  api.post("/api/v1/contratacoes/:id/assinatura", {
    schema: { tags: ["contratacoes"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.contratacoes.solicitarAssinatura(request.params.id)));

  api.get("/api/v1/processos", { schema: { tags: ["processos"], querystring: processoListSchema } }, async (request) => {
    const result = await services.processos.list(request.query);
    return ok(result.data, result.meta);
  });
  api.post("/api/v1/processos", { schema: { tags: ["processos"], body: processoCreateSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.processos.create(request.body)));
  });
  api.get("/api/v1/processos/:id", {
    schema: { tags: ["processos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.processos.get(request.params.id)));
  api.post("/api/v1/processos/:id/etapa", {
    schema: { tags: ["processos"], params: z.object({ id: z.string().uuid() }), body: processoMoverSchema },
  }, async (request) => ok(await services.processos.mover(request.params.id, request.body)));

  api.get("/api/v1/termos", {
    schema: { tags: ["termos"], querystring: z.object({ status: z.enum(["gerado", "enviado", "assinado", "recusado", "cancelado"]).optional() }) },
  }, async (request) => ok(await services.termos.list(request.query.status)));
  api.get("/api/v1/termos/rescisao-medio", {
    schema: { tags: ["termos"], querystring: z.object({ q: z.string().max(120).optional() }) },
  }, async (request) => ok(await services.termos.estagiariosMedio(request.query.q ?? "")));
  api.get("/api/v1/termos/rescisao-medio/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.termos.estagiarioMedio(request.params.id)));
  api.post("/api/v1/termos/documentos", {
    schema: { tags: ["termos"], body: documentoSchema },
  }, async (request, reply) => {
    if (request.body.modelo === "rescisao_medio") {
      const pdf = await buildRescisaoMedioPdf(request.body);
      const nome = `Rescisão Estágio Ensino Médio - ${request.body.estagiario_nome}.pdf`;
      const ascii = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\- ]+/g, "");
      return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`)
        .send(pdf);
    }
    const documento = await gerarDocumento(request.body);
    const ascii = documento.filename.replace(/[^\w.\- ]+/g, "");
    return reply
      .type("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(documento.filename)}`)
      .send(documento.buffer);
  });
  api.get("/api/v1/termos/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.termos.get(request.params.id)));
  api.delete("/api/v1/termos/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => {
    await services.tce.excluir(request.params.id);
    return ok({ id: request.params.id });
  });
  api.get("/api/v1/tce/empresas", { schema: { tags: ["termos"] } }, async () => ok(await services.tce.listarEmpresas()));
  api.get("/api/v1/tce/escolas", {
    schema: { tags: ["termos"], querystring: z.object({ q: z.string().max(120).optional() }) },
  }, async (request) => ok(await services.tce.buscarEscolas(request.query.q ?? "")));
  api.get("/api/v1/tce/vagas", {
    schema: { tags: ["termos"], querystring: z.object({ q: z.string().trim().max(120).optional().default("") }) },
  }, async (request) => ok(await services.tce.buscarVagasEstagio(request.query.q)));
  api.get("/api/v1/tce/candidatos", {
    schema: { tags: ["termos"], querystring: z.object({ q: z.string().max(120).optional() }) },
  }, async (request) => ok(await services.tce.buscarCandidatos(request.query.q ?? "")));
  api.get("/api/v1/tce/candidatos/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().min(1).max(80) }) },
  }, async (request) => ok(await services.tce.candidatoParaTce(request.params.id)));
  api.get("/api/v1/tce/contratacoes/:id", {
    schema: { tags: ["termos"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await services.tce.contratacaoParaTce(request.params.id)));
  api.post("/api/v1/tce/gerar", {
    schema: {
      tags: ["termos"],
      body: z.object({
        empresa_id: z.string().uuid(),
        id_contratacao: z.number().int().positive().optional().nullable(),
        id_candidato: z.string().max(64).optional().nullable(),
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
      idContratacao: request.body.id_contratacao ?? null,
      concedente: request.body.concedente,
      campos: camposFromBody(known),
    });
    await guardarDocumentosDoTce(request.log, { idCandidato: request.body.id_candidato, idContratacao: request.body.id_contratacao, campos: known, tceId: String((termo as { id: string }).id) });
    return reply.code(201).send(ok(termo));
  });
  api.get("/api/v1/tce/:id/dados", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.tce.dados(request.params.id)));
  api.patch("/api/v1/tce/:id", {
    schema: {
      tags: ["termos"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        empresa_id: z.string().uuid().or(z.literal("")).optional().default(""),
        id_candidato: z.string().max(64).optional().nullable(),
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
  }, async (request) => {
    const known = Object.fromEntries(MANUAL_FIELDS.map((key) => [key, request.body.campos[key] ?? ""]));
    const atualizado = await services.tce.atualizar(request.params.id, {
      empresaId: request.body.empresa_id,
      escolaId: request.body.escola_id || null,
      concedente: request.body.concedente,
      campos: camposFromBody(known),
    });
    await guardarDocumentosDoTce(request.log, { idCandidato: request.body.id_candidato, campos: known, tceId: request.params.id });
    return ok(atualizado);
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
  api.post("/api/v1/tce/:id/email", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.tce.enviarDocumento(request.params.id)));
  api.post("/api/v1/tce/:id/email-assinatura", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.tce.enviarAssinaturas(request.params.id)));
  api.post("/api/v1/tce/:id/email-escola", {
    schema: { tags: ["termos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.tce.enviarAssinaturaEscola(request.params.id)));
  api.get("/api/v1/emails", { schema: { tags: ["emails"] } }, async () => ok(await listarModelosEmail(db)));
  api.patch("/api/v1/emails/:id", {
    schema: {
      tags: ["emails"],
      params: z.object({ id: z.coerce.number().int().positive() }),
      body: z.object({
        assunto: z.string().trim().min(1).max(300),
        texto: z.string().min(1).max(100_000),
        descricao: z.string().trim().min(1).max(120),
        vinculo: z.number().int().positive(),
      }),
    },
  }, async (request) => ok(await salvarModeloEmail(db, request.params.id, request.body.vinculo, request.body.descricao, request.body.assunto, request.body.texto)));
  api.delete("/api/v1/emails/vinculos/:id", {
    schema: { tags: ["emails"], params: z.object({ id: z.coerce.number().int().positive() }) },
  }, async (request) => ok(await excluirModeloEmail(db, request.params.id)));
  api.get("/api/v1/asaas/regua", {
    schema: { tags: ["asaas"], querystring: z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }) },
  }, async (request) => ok(await services.regua.listar(request.query.competencia)));
  api.post("/api/v1/asaas/regua/simular", {
    schema: { tags: ["asaas"], body: z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) },
  }, async (request) => ok(await services.regua.simular(request.body.competencia, request.body.data)));
  api.get("/api/v1/asaas/regua/:id/relatorio", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      querystring: z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }),
    },
  }, async (request) => ok(await services.regua.relatorio(request.params.id, request.query.competencia)));
  api.post("/api/v1/asaas/regua/envios/:id", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ status: z.enum(["enviado", "escalar", "encaminhado"]) }),
    },
  }, async (request) => ok(await services.regua.registrarEnvio(request.params.id, request.user.email, request.body.status)));
  api.post("/api/v1/asaas/regua/:id/relatorio/email", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ competencia: z.string().regex(/^\d{4}-\d{2}$/) }),
    },
  }, async (request) => ok(await services.regua.enviarRelatorio(request.params.id, request.body.competencia, request.user.email)));
  api.post("/api/v1/asaas/regua/:id/comprovante", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    },
  }, async (request) => ok(await services.regua.registrarComprovante(request.params.id, request.body.data)));
  api.post("/api/v1/asaas/regua/:id/comprovante/validar", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.regua.validarComprovante(request.params.id, request.user.email)));
  api.post("/api/v1/asaas/cobrancas", {
    schema: {
      tags: ["asaas"],
      body: z.object({
        id_empresa: z.string().min(1),
        valor: z.number().positive(),
        vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        descricao: z.string().trim().min(3).max(200),
        forma: z.enum(["UNDEFINED", "BOLETO", "PIX", "CREDIT_CARD"]).default("UNDEFINED"),
      }),
    },
  }, async (request, reply) => reply.code(201).send(ok(await services.asaas.criar({
    idEmpresa: request.body.id_empresa,
    valor: request.body.valor,
    vencimento: request.body.vencimento,
    descricao: request.body.descricao,
    forma: request.body.forma,
  }))));
  api.get("/api/v1/asaas/cobrancas", {
    schema: {
      tags: ["asaas"],
      querystring: z.object({
        situacao: z.enum(["aberta", "paga", "cancelada"]).optional(),
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        id_empresa: z.string().optional(),
      }),
    },
  }, async (request) => ok(await services.asaas.listar({
    situacao: request.query.situacao,
    de: request.query.de,
    ate: request.query.ate,
    idEmpresa: request.query.id_empresa,
  })));
  api.post("/api/v1/asaas/cobrancas/:id/email", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.asaas.enviarFatura(request.params.id)));
  api.post("/api/v1/asaas/cobrancas/:id/sincronizar", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => {
    const cobranca = await services.asaas.sincronizar(request.params.id);
    if (cobranca?.situacao === "paga") await services.regua.encerrarPorCobrancaId(cobranca.id, cobranca.data_pagamento);
    return ok(cobranca);
  });
  api.post("/api/v1/asaas/cobrancas/:id/receber", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valor: z.number().positive().optional() }),
    },
  }, async (request) => ok(await services.asaas.receber(request.params.id, request.body.data, request.body.valor)));
  api.delete("/api/v1/asaas/cobrancas/:id", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.asaas.excluir(request.params.id)));
  api.post("/api/v1/asaas/cobrancas/:id/nota", {
    schema: {
      tags: ["asaas"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        tipo: z.string().trim().min(1).max(40),
        valor: z.number().positive(),
        codigo_servico: z.string().trim().min(1).max(40),
        iss: z.number().min(0).max(100),
        descricao: z.string().trim().min(3).max(500),
      }),
    },
  }, async (request) => ok(await services.asaas.emitirNota(request.params.id, {
    tipo: request.body.tipo,
    valor: request.body.valor,
    codigoServico: request.body.codigo_servico,
    iss: request.body.iss,
    descricao: request.body.descricao,
  })));
  api.post("/api/v1/asaas/notas/:id/pdf", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.asaas.baixarNota(request.params.id)));
  api.post("/api/v1/asaas/notas/:id/cancelar", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.asaas.cancelarNota(request.params.id)));
  // Disparo manual do sync: vagas abertas e Notion (só administrador, pelo prefixo /configuracoes). Ignora o slot já rodado.
  api.post("/api/v1/configuracoes/sync", {
    schema: { tags: ["configuracoes"], querystring: z.object({ dry: z.enum(["0", "1", "true", "false"]).optional() }) },
  }, async (request) => {
    const dry = request.query.dry === "1" || request.query.dry === "true" || config.NOTION_SYNC_DRY;
    return ok(await services.sync.executar(dry, "manual"));
  });
  api.get("/api/v1/configuracoes/acessos", { schema: { tags: ["configuracoes"] } }, async () => ok(await services.acesso.listar()));
  api.patch("/api/v1/configuracoes/usuarios/:id", {
    schema: {
      tags: ["configuracoes"],
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ ativo: z.boolean(), paginas: z.array(z.string()), senha: z.string().trim().min(8).max(80).optional() }),
    },
  }, async (request) => ok(await services.acesso.salvar(request.params.id, request.body)));
  api.post("/api/v1/configuracoes/usuarios", {
    schema: {
      tags: ["configuracoes"],
      body: z.object({
        nome: z.string({ required_error: "Informe o nome." }).trim().min(2, "Informe o nome.").max(120),
        email: z.string({ required_error: "Informe o e-mail." }).trim().email("Informe um e-mail válido.").max(180),
        senha: z.string({ required_error: "Informe a senha." }).trim().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(80),
        paginas: z.array(z.string()).default([]),
      }),
    },
  }, async (request, reply) => reply.code(201).send(ok(await services.acesso.criar(request.body))));
  api.delete("/api/v1/configuracoes/usuarios/:id", {
    schema: { tags: ["configuracoes"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.acesso.apagar(request.params.id, request.user)));

  const legado = new LegadoService(db);
  const pagina = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) };
  api.get("/api/v1/faturamento", { schema: { tags: ["faturamento"], querystring: z.object({ ...pagina, empresa: z.string().optional(), fechamento: z.string().optional(), mes: z.string().optional(), ano: z.string().optional(), status: z.string().optional() }) } }, async (request) => {
    const result = await legado.faturamento(request.query);
    const conferencia = await legado.faturasAbertas();
    let asaas: { valor: number; quantidade: number } | null = null;
    try {
      asaas = await services.asaas.aReceber();
    } catch {
      asaas = null;
    }
    return ok(result.data, { ...result.meta, asaas, conferencia });
  });
  api.post("/api/v1/faturamento/boletos", {
    schema: { tags: ["faturamento"], body: z.object({ mes: z.string().regex(/^\d{1,2}$/), ano: z.string().regex(/^\d{4}$/) }) },
  }, async (request) => ok(await services.asaas.boletosDoMes(request.body.mes, request.body.ano)));
  api.get("/api/v1/asaas/cobrancas/:id/nota", {
    schema: { tags: ["asaas"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => {
    const cobranca = await services.asaas.resumoNota(request.params.id);
    const competencia = cobranca.descricao.match(/^Faturamento\s+(\d{1,2})\/(\d{4})$/);
    if (!competencia?.[1] || !competencia[2]) return ok(notasSugeridas(cobranca.valor, { estagio: 0, clt: 0 }));
    return ok(await legado.sugerirNotas(cobranca.id_empresa, competencia[1], competencia[2], cobranca.valor));
  });
  api.get("/api/v1/faturamento/relatorio", {
    schema: { tags: ["faturamento"], querystring: z.object({ empresa: z.string().min(1), mes: z.string(), ano: z.string() }) },
  }, async (request) => ok(await legado.relatorioEmpresa(request.query.empresa, request.query.mes, request.query.ano)));
  api.post("/api/v1/faturamento/relatorios", {
    schema: { tags: ["faturamento"], body: z.object({
      empresas: z.array(z.string().min(1)).max(200).optional(),
      todas: z.boolean().optional(),
      mes: z.string(),
      ano: z.string(),
      status: z.string().optional(),
      empresa: z.string().optional(),
      itens: z.array(z.object({
        nome: z.string().max(200).nullable().optional(),
        cargo: z.string().max(200).nullable().optional(),
        modalidade: z.string().max(80).nullable().optional(),
        situacao: z.string().trim().min(1).max(40),
        valor: z.number().finite().nonnegative().max(1_000_000),
      })).max(400).optional(),
    }) },
  }, async (request) => {
    let ids = request.body.empresas ?? [];
    if (request.body.todas) {
      const primeira = await legado.faturamento({ mes: request.body.mes, ano: request.body.ano, status: request.body.status, empresa: request.body.empresa, page: 1, pageSize: 100 });
      ids = primeira.data.itens.map((item) => item.id_empresa);
      if (primeira.meta.total > 100) {
        const segunda = await legado.faturamento({ mes: request.body.mes, ano: request.body.ano, status: request.body.status, empresa: request.body.empresa, page: 2, pageSize: 100 });
        ids = [...ids, ...segunda.data.itens.map((item) => item.id_empresa)];
      }
    }
    if (!ids.length) throw new AppError(422, "SEM_EMPRESAS", "Nenhuma empresa selecionada.");
    const ajuste = request.body.itens && ids.length === 1 && ids[0]
      ? {
          idEmpresa: ids[0],
          itens: request.body.itens.map((item) => ({
            nome: item.nome ?? null,
            cargo: item.cargo ?? null,
            modalidade: item.modalidade ?? null,
            situacao: item.situacao,
            valor: item.valor,
          })),
        }
      : null;
    return ok(await legado.enviarRelatorios(config, ids, request.body.mes, request.body.ano, (input) => services.asaas.boletoDoFaturamento(input), ajuste));
  });
  api.get("/api/v1/procfy/excel", {
    schema: { tags: ["procfy"], querystring: z.object({ de: z.string().optional(), ate: z.string().optional(), status: z.string().optional(), tipoData: z.string().optional(), sistema: z.string().optional() }) },
  }, async (request, reply) => {
    const html = await legado.planilhaProcfy(request.query);
    return reply.type("application/vnd.ms-excel; charset=utf-8").header("Content-Disposition", "attachment; filename=\"Faturas.xls\"").send(html);
  });
  api.get("/api/v1/procfy/fatura/:id", {
    schema: { tags: ["procfy"], params: z.object({ id: z.string().min(1) }) },
  }, async (request) => ok(await legado.procfyFatura(request.params.id)));
  api.get("/api/v1/procfy", { schema: { tags: ["procfy"], querystring: z.object({ ...pagina, de: z.string().optional(), ate: z.string().optional(), status: z.string().optional(), tipoData: z.string().optional(), sistema: z.string().optional(), exportar: z.enum(["1"]).optional() }) } }, async (request) => {
    const result = await legado.procfy({ ...request.query, exportar: request.query.exportar === "1" });
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/comissao/empresas", { schema: { tags: ["comissao"], querystring: z.object({ ...pagina, empresa: z.string().optional(), consultor: z.string().optional(), mes: z.string().optional(), ano: z.string().optional(), status: z.string().optional() }) } }, async (request) => {
    const result = await legado.comissaoEmpresas(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/comissao", { schema: { tags: ["comissao"], querystring: z.object({ ...pagina, empresa: z.string().optional(), consultor: z.string().optional(), mes: z.string().optional(), ano: z.string().optional(), status: z.string().optional() }) } }, async (request) => {
    const result = await legado.comissao(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/holerite", { schema: { tags: ["holerite"], querystring: z.object({ ...pagina, empresa: z.string().optional(), mes: z.string().optional(), ano: z.string().optional() }) } }, async (request) => {
    const result = await legado.holerite(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/documentos-pendentes", { schema: { tags: ["documentos"], querystring: z.object({ ...pagina, pageSize: z.coerce.number().int().min(1).max(100).default(20), modalidade: z.string().optional(), empresa: z.string().optional(), documento: z.string().optional(), candidato: z.string().optional(), de: z.string().optional(), ate: z.string().optional() }) } }, async (request) => {
    const result = await legado.documentos(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/modelos", { schema: { tags: ["vagas"], querystring: z.object({ ...pagina, nome: z.string().optional(), cargo: z.string().optional(), modalidade: z.string().optional() }) } }, async (request) => {
    const result = await legado.modelos(request.query);
    return ok(result.data, result.meta);
  });
  api.get("/api/v1/modelos/:id", { schema: { tags: ["vagas"], params: z.object({ id: z.coerce.number().int().positive() }) } }, async (request) => {
    const modelo = await legado.modelo(request.params.id);
    if (!modelo) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo de vaga não encontrado.");
    return ok(modelo);
  });
  const textoCurto = z.string().trim().max(180).optional();
  // Gravar exige a página "instituicoes-nova" (regra própria em lib/paginas.ts); listar aceita as duas.
  api.post("/api/v1/instituicoes/nova", {
    schema: {
      tags: ["instituicoes"],
      body: z.object({
        tipo_ensino: z.enum(["Ensino Médio", "Ensino Superior", "Ensino Supletivo", "Ensino Técnico"], { message: "Escolha o tipo de ensino." }),
        tipo_instituicao: z.enum(["", "Particular", "Pública"]).optional(),
        cnpj_inep: z.string().trim().max(30).optional(),
        ie_im: z.string().trim().max(30).optional(),
        mantenedora: textoCurto,
        razao_social: z.string().trim().min(3, "A razão social precisa ter pelo menos 3 letras.").max(180, "A razão social pode ter até 180 letras."),
        nome_fantasia: textoCurto,
        diretor: textoCurto,
        diretor_email: z.string().trim().max(180).refine((valor) => !valor || z.string().email().safeParse(valor).success, "E-mail do diretor inválido.").optional(),
        diretor_cpf: z.string().trim().max(20).optional(),
        diretor_rg: z.string().trim().max(30).optional(),
        representante_legal: textoCurto,
        representante_cpf: z.string().trim().max(20).optional(),
        representante_cargo: textoCurto,
        representante_email: z.string().trim().max(180).refine((valor) => !valor || z.string().email().safeParse(valor).success, "E-mail do representante inválido.").optional(),
        telefone: z.string().trim().max(30).optional(),
        telefone2: z.string().trim().max(30).optional(),
        email: z.string().trim().max(180).refine((valor) => !valor || z.string().email().safeParse(valor).success, "E-mail da instituição inválido.").optional(),
        cep: z.string().trim().max(12).optional(),
        logradouro: textoCurto,
        numero: z.string().trim().max(20).optional(),
        complemento: z.string().trim().max(80).optional(),
        bairro: z.string().trim().max(80).optional(),
        cidade: z.string().trim().max(80).optional(),
        uf: z.string().trim().max(2).optional(),
        latitude: z.string().trim().refine((valor) => !valor || (Number.isFinite(Number(valor.replace(",", "."))) && Math.abs(Number(valor.replace(",", "."))) <= 90), "Latitude inválida.").transform((valor) => valor.replace(",", ".")).optional(),
        longitude: z.string().trim().refine((valor) => !valor || (Number.isFinite(Number(valor.replace(",", "."))) && Math.abs(Number(valor.replace(",", "."))) <= 180), "Longitude inválida.").transform((valor) => valor.replace(",", ".")).optional(),
      }),
    },
  }, async (request, reply) => reply.code(201).send(ok(await services.instituicoes.criar(request.body))));
  api.get("/api/v1/instituicoes", { schema: { tags: ["instituicoes"], querystring: z.object({ ...pagina, pageSize: z.coerce.number().int().min(1).max(100).default(20), q: z.string().optional(), ensino: z.string().optional(), conveniada: z.string().optional(), cidade: z.string().optional(), uf: z.string().optional() }) } }, async (request) => {
    const result = await legado.instituicoes(request.query);
    return ok(result.data, result.meta);
  });

  api.post("/api/v1/asaas/webhook", async (request, reply) => {
    const esperado = config.ASAAS_WEBHOOK_TOKEN;
    const recebido = request.headers["asaas-access-token"];
    if (esperado && recebido !== esperado) {
      return reply.code(401).send({ success: false, error: { code: "NAO_AUTORIZADO", message: "Webhook recusado." } });
    }
    const payload = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const resultado = await services.asaas.receberWebhook(payload);
    const payment = payload.payment as { id?: string; status?: string; paymentDate?: string | null } | undefined;
    const status = String(payment?.status ?? "").toUpperCase();
    if (resultado.atualizado && payment?.id && (status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH")) {
      await services.regua.encerrarPorPaymentId(payment.id, payment.paymentDate ?? null);
    }
    return ok(resultado);
  });
  api.get("/api/v1/grupos", { schema: { tags: ["grupos"] } }, async () => ok(await services.cadastro.listarGrupos()));
  api.get("/api/v1/grupos/:id", {
    schema: { tags: ["grupos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await services.cadastro.obterGrupo(request.params.id)));
  api.get("/api/v1/grupos/:id/cobranca", {
    schema: { tags: ["grupos"], params: z.object({ id: z.string().uuid() }) },
  }, async (request) => ok(await valoresDoGrupo(db, request.params.id)));
  api.post("/api/v1/grupos", { schema: { tags: ["grupos"], body: grupoCreateSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.cadastro.criarGrupo(request.body)));
  });
  api.get("/api/v1/cargos", { schema: { tags: ["vagas"] } }, async () => ok(await services.cargos.listar()));
  api.get("/api/v1/grupos-empresas/empresas", { schema: { tags: ["grupos"] } }, async () => ok(await services.cadastro.listarEmpresas()));
  api.post("/api/v1/grupos-empresas/empresas", { schema: { tags: ["grupos"], body: empresaCadastroSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.cadastro.criarEmpresa(request.body)));
  });
  api.get("/api/v1/grupos-empresas/vagas", {
    schema: { tags: ["grupos"] },
  }, async () => {
    const modelos = await services.cadastro.listarModelos();
    return { success: true, modelos, data: modelos };
  });
  api.post("/api/v1/grupos-empresas/vagas", { schema: { tags: ["grupos"], body: vagaCadastroSchema } }, async (request, reply) => {
    return reply.code(201).send(ok(await services.cadastro.criarVaga(request.body, request.user.email)));
  });

  api.post("/api/v1/triagem/vagas", {
    schema: {
      tags: ["triagem"],
      body: z.object({
        cep: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(8, "Informe um CEP com 8 dígitos.")),
        raioKm: z.coerce.number().min(1).max(100).default(10),
        tipos: z.array(z.enum(["CLT", "Estágio"])).min(1, "Escolha CLT, Estágio ou os dois."),
        sexo: z.enum(["M", "F"]).optional(),
        idade: z.coerce.number().int().min(1).max(120).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      }),
    },
  }, async (request) => ok(await services.triagem.buscar(request.body)));
  api.get("/api/v1/triagem/empresas-pendentes", { schema: { tags: ["triagem"] } }, async () => ok(await services.triagem.empresasPendentes()));

  // Triagem inteligente. Rotas separadas da busca rápida; nenhuma grava candidato, mexe no CRM ou envia mensagem.
  api.get("/api/v1/triagem/ia/status", {
    schema: { tags: ["triagem"], querystring: z.object({ verificar: z.enum(["0", "1"]).optional() }) },
  }, async (request) => ok({
    luna: {
      configurada: services.curriculo.configurada,
      modelo: services.curriculo.modelo,
      ...(request.query.verificar === "1" ? await services.curriculo.verificarModelo() : {}),
    },
    jev: services.matching.estadoJev(),
  }));
  api.post("/api/v1/triagem/curriculo", {
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      tags: ["triagem"],
      body: z.object({
        arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1).max(7_200_000) }).optional(),
        texto: z.string().trim().min(30, "Cole um texto com pelo menos 30 caracteres.").max(30_000).optional(),
      }).refine((body) => Boolean(body.arquivo) !== Boolean(body.texto), "Envie um arquivo ou um texto."),
    },
  }, async (request) => {
    const preparado = request.body.arquivo ? await prepararCurriculo(request.body.arquivo) : { tipo: "texto" as const, texto: request.body.texto! };
    return ok(await services.curriculo.analisar(preparado));
  });
  const turnoSchema = z.enum(["manha", "tarde", "noite"]).or(z.literal("")).optional().default("");
  api.post("/api/v1/triagem/compatibilidade", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      tags: ["triagem"],
      body: z.object({
        perfil: z.object({
          escolaridade: z.enum(["medio_incompleto", "medio_completo", "cursando_medio", "cursando_superior", "superior_completo"]).or(z.literal("")).optional().default(""),
          turnoEstudo: turnoSchema,
          tempoExperiencia: z.string().trim().max(200).optional().default(""),
          habilidades: z.string().trim().max(2000).optional().default(""),
          turno: turnoSchema,
          curriculo: z.string().trim().max(12_000).optional().default(""),
        }).refine((perfil) => perfil.escolaridade !== "cursando_medio" || perfil.turnoEstudo !== "", {
          message: "Informe o turno em que a pessoa estuda.",
          path: ["turnoEstudo"],
        }),
        vagaIds: z.array(z.string().trim().min(1).max(64)).min(1).max(30),
      }),
    },
  }, async (request) => ok(await services.matching.avaliar(request.body)));

  // Gerador de dossiês (Triagem). Lê vagas, candidatos_dados e o CRM; só grava no CRM quando o operador salva a nota.
  api.get("/api/v1/triagem/dossie/vagas", { schema: { tags: ["triagem"] } }, async () => ok(await services.dossie.listarVagas()));
  api.get("/api/v1/triagem/dossie/status", { schema: { tags: ["triagem"] } }, async () => ok({ configurada: services.dossie.configurada, modelo: services.dossie.modelo }));
  api.get("/api/v1/triagem/dossie/candidato", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    schema: {
      tags: ["triagem"],
      querystring: z.object({
        telefone: z.string().trim().max(40).optional(),
        dealId: z.string().trim().max(64).optional(),
      }).refine((query) => Boolean(query.telefone || query.dealId), "Informe o telefone ou o id do negócio."),
    },
  }, async (request) => ok(await services.dossie.buscarCandidato(request.query)));
  api.post("/api/v1/triagem/dossie", {
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      tags: ["triagem"],
      body: z.object({
        vagaId: z.string().trim().min(1, "Escolha a vaga.").max(64),
        dealId: z.string().trim().max(64).optional(),
        telefone: z.string().trim().max(40).optional(),
        manual: z.object({
          nome: z.string().trim().max(200).optional(),
          idade: z.string().trim().max(10).optional(),
          escolaridade: z.string().trim().max(200).optional(),
          turno: z.string().trim().max(60).optional(),
          bairroCidade: z.string().trim().max(200).optional(),
        }).optional(),
        arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1).max(7_200_000) }).optional(),
        texto: z.string().trim().min(30, "Cole um texto com pelo menos 30 caracteres.").max(30_000).optional(),
      }).refine((body) => !(body.arquivo && body.texto), "Envie um arquivo ou um texto, não os dois."),
    },
  }, async (request) => {
    const { arquivo, texto, ...resto } = request.body;
    const curriculo = arquivo ? await prepararCurriculo(arquivo) : texto ? { tipo: "texto" as const, texto } : undefined;
    return ok(await services.dossie.gerar({ ...resto, dealId: resto.dealId || undefined, curriculo }));
  });
  api.post("/api/v1/triagem/dossie/nota", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    schema: {
      tags: ["triagem"],
      body: z.object({ dealId: z.string().trim().min(1).max(64), conteudo: z.string().trim().min(1).max(20_000) }),
    },
  }, async (request) => ok(await services.dossie.salvarNota(request.body.dealId, request.body.conteudo)));

  api.post("/api/v1/zapsign/webhook", async (request) => {
    const payload = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const termo = await services.termos.receberWebhook(payload);
    const rescisao = await services.contratacoes.receberAssinatura(payload);
    return ok({ ...termo, rescisao });
  });
}

type StaffUser = { id: string; nome: string; email: string; senha_hash: string; ativo: boolean };

/** Documentos do candidato a partir do TCE. Falha aqui não impede o TCE: só fica no log. */
async function guardarDocumentosDoTceCom(db: Pool, log: { warn: (o: unknown, m: string) => void }, input: { idCandidato?: string | null; idContratacao?: number | null; campos: Record<string, string>; tceId: string }) {
  try {
    const idCandidato = await candidatoDoTce(db, { idCandidato: input.idCandidato, idContratacao: input.idContratacao, cpf: input.campos.cpf });
    if (!idCandidato) {
      log.warn({ tce: input.tceId }, "TCE sem candidato cadastrado: documentos não gravados");
      return;
    }
    await gravarDocumentosDoTce(db, idCandidato, input.campos, input.tceId);
  } catch (error) {
    log.warn({ tce: input.tceId, erro: error instanceof Error ? error.message : String(error) }, "falha ao gravar os documentos do TCE");
  }
}

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

