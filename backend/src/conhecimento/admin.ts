import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MODULOS_CONHECIMENTO, STATUS_ARTIGO, conteudoSchema, metaSchema, type ConhecimentoService } from "./conhecimento.service.js";

const ok = <T>(data: T, meta: Record<string, unknown> = {}) => ({ success: true as const, data, meta });
const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/, "Use letras minúsculas, números e hífens.");
const id = z.string().trim().min(2).max(120);

/** Formato de importação em lote (docs/mcp/conhecimento.md). Sempre entra como rascunho. */
export const itemImportacaoSchema = z.object({ id: slug, meta: metaSchema, conteudo: conteudoSchema });

/**
 * Gestão da base de conhecimento. O prefixo /api/v1/configuracoes já exige administrador efetivo (hook do app.ts):
 * nesta fase só administradores editam. Papéis editoriais (coordenador/gestor) ficam preparados em conhecimento_editor.
 */
export function registrarAdminConhecimento(app: FastifyInstance, svc: ConhecimentoService) {
  const base = "/api/v1/configuracoes/conhecimento";
  const quem = (r: FastifyRequest) => ({ usuario: r.user?.sub ?? null });
  const P = (r: FastifyRequest) => r.params as { id: string; versao?: string };

  app.get(`${base}/opcoes`, async () => ok({ status: STATUS_ARTIGO, modulos: MODULOS_CONHECIMENTO }));
  app.get(`${base}/categorias`, async () => ok(await svc.listarCategorias()));
  app.post(`${base}/categorias`, { schema: { body: z.object({ slug: z.string().trim().min(2).max(80), nome: z.string().trim().min(2).max(120), descricao: z.string().trim().max(500).nullable().optional(), ordem: z.number().int().min(0).max(1000).optional() }) } },
    async (r) => ok(await svc.criarCategoria(quem(r), r.body as never)));
  app.patch(`${base}/categorias/:id`, { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ nome: z.string().trim().min(2).max(120).optional(), descricao: z.string().trim().max(500).nullable().optional(), ordem: z.number().int().min(0).max(1000).optional(), ativa: z.boolean().optional() }) } },
    async (r) => ok(await svc.editarCategoria(quem(r), P(r).id, r.body as never)));

  app.get(`${base}/artigos`, {
    schema: { querystring: z.object({ q: z.string().max(120).optional(), categoria: z.string().max(80).optional(), modulo: z.string().max(40).optional(), status: z.enum(STATUS_ARTIGO).optional(), desatualizados: z.enum(["1", "true"]).optional(), pagina: z.coerce.number().int().min(1).max(1000).default(1), limite: z.coerce.number().int().min(1).max(100).default(25) }) },
  }, async (r) => { const q = r.query as Record<string, any>; return ok(await svc.listarArtigos({ ...q, desatualizados: Boolean(q.desatualizados) } as never)); });
  app.post(`${base}/artigos`, { schema: { body: z.object({ id: slug, meta: metaSchema, conteudo: conteudoSchema }) } },
    async (r) => { const b = r.body as z.infer<typeof itemImportacaoSchema>; const novo = await svc.criarArtigo(quem(r), { slug: b.id, meta: b.meta, conteudo: b.conteudo }); return ok(await svc.detalhe(novo)); });
  app.get(`${base}/artigos/:id`, { schema: { params: z.object({ id }) } }, async (r) => ok(await svc.detalhe(P(r).id)));
  app.put(`${base}/artigos/:id/rascunho`, { schema: { params: z.object({ id }), body: conteudoSchema } }, async (r) => ok(await svc.salvarRascunho(quem(r), P(r).id, r.body as never)));
  app.patch(`${base}/artigos/:id`, { schema: { params: z.object({ id }), body: metaSchema.partial() } }, async (r) => ok(await svc.editarMeta(quem(r), P(r).id, r.body as never)));
  app.post(`${base}/artigos/:id/publicar`, { schema: { params: z.object({ id }), body: z.object({ versao: z.number().int().min(1).optional() }) } },
    async (r) => ok(await svc.publicar(quem(r), P(r).id, (r.body as { versao?: number }).versao)));
  app.post(`${base}/artigos/:id/arquivar`, { schema: { params: z.object({ id }) } }, async (r) => ok(await svc.arquivar(quem(r), P(r).id)));
  app.post(`${base}/artigos/:id/reativar`, { schema: { params: z.object({ id }) } }, async (r) => ok(await svc.reativar(quem(r), P(r).id)));
  app.post(`${base}/artigos/:id/duplicar`, { schema: { params: z.object({ id }), body: z.object({ id: slug }) } }, async (r) => ok(await svc.duplicar(quem(r), P(r).id, (r.body as { id: string }).id)));
  app.get(`${base}/artigos/:id/versoes`, { schema: { params: z.object({ id }) } }, async (r) => ok(await svc.versoes(P(r).id)));
  app.get(`${base}/artigos/:id/versoes/:versao`, { schema: { params: z.object({ id, versao: z.coerce.number().int().min(1) }) } }, async (r) => ok(await svc.versao(P(r).id, Number(P(r).versao))));
  app.post(`${base}/artigos/:id/versoes/:versao/restaurar`, { schema: { params: z.object({ id, versao: z.coerce.number().int().min(1) }) } }, async (r) => ok(await svc.restaurar(quem(r), P(r).id, Number(P(r).versao))));
  app.get(`${base}/auditoria`, { schema: { querystring: z.object({ artigo: id.optional(), pagina: z.coerce.number().int().min(1).max(1000).default(1), limite: z.coerce.number().int().min(1).max(100).default(30) }) } },
    async (r) => ok(await svc.auditoria(r.query as never)));
  /** Prévia da busca como um colaborador veria (só publicado). */
  app.get(`${base}/busca`, { schema: { querystring: z.object({ texto: z.string().trim().min(2).max(300), paginas: z.string().max(400).optional(), admin: z.enum(["0", "1"]).optional() }) } }, async (r) => {
    const q = r.query as { texto: string; paginas?: string; admin?: string };
    const leitor = { admin: q.admin !== "0", paginas: (q.paginas ?? "").split(",").filter(Boolean), integracao: null };
    return ok(await svc.buscar(leitor, { texto: q.texto, pagina: 1, limite: 10 }));
  });
  app.post(`${base}/importar`, { bodyLimit: 5 * 1024 * 1024, schema: { body: z.object({ simular: z.boolean().default(true), artigos: z.array(itemImportacaoSchema).min(1).max(500) }) } }, async (r) => {
    const b = r.body as { simular: boolean; artigos: Array<z.infer<typeof itemImportacaoSchema>> };
    return ok(await svc.importar(quem(r), b.artigos.map((a) => ({ slug: a.id, meta: a.meta, conteudo: a.conteudo })), b.simular));
  });
}
