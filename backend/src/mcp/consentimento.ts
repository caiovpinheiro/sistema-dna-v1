import type { FastifyInstance, FastifyRequest } from "fastify";
import type Provider from "oidc-provider";
import type { Pool } from "pg";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { redirectPermitido, slugDoRecurso, type McpConfig } from "./config.js";
import type { AcessoService } from "../services/acesso.service.js";
import { ESCOPOS_SUPORTADOS } from "./oauth.js";
import { carregarContexto, motivoDaNegativa } from "./politica.js";
import type { RegistroFerramentas } from "./registro.js";
import { agoraEmSegundos } from "./util.js";

const ok = <T>(data: T) => ({ success: true as const, data, meta: {} });

type Pedido = { client_id?: string; resource?: string | string[]; redirect_uri?: string; scope?: string; mcp_escopo_padrao?: string };

/**
 * Tela de consentimento (a página React vem na Fase 4): estas duas rotas usam a sessão do painel (cookie).
 * Quem aprova é o usuário logado agora; o bootstrap-admin, sem linha em app_usuario, nunca passa.
 */
export function registrarConsentimento(app: FastifyInstance, deps: { db: Pool; provider: Provider; mcp: McpConfig; acesso: AcessoService; registro: RegistroFerramentas }): void {
  const { db, provider, mcp, acesso, registro } = deps;

  async function usuarioReal(request: FastifyRequest) {
    const { rows } = await db.query<{ id: string; nome: string; email: string }>(
      "SELECT id::text AS id, nome, email FROM dna_work.app_usuario WHERE id::text = $1 AND ativo = true",
      [request.user.sub],
    );
    return rows[0] ?? null; // sub "bootstrap-admin" não existe na tabela
  }

  async function carregar(request: FastifyRequest, uid: string) {
    const interacao = await provider.Interaction.find(uid);
    if (!interacao) throw new AppError(404, "PEDIDO_NAO_ENCONTRADO", "Pedido de autorização expirado ou inexistente.");
    const params = (interacao.params ?? {}) as Pedido;
    const recurso = Array.isArray(params.resource) ? params.resource[0] : params.resource;
    const slug = recurso ? slugDoRecurso(mcp, recurso) : null;
    const [usuario, cliente, integracao] = await Promise.all([
      usuarioReal(request),
      params.client_id ? provider.Client.find(params.client_id).catch(() => undefined) : undefined,
      slug
        ? db.query<{ id: string; nome: string; descricao: string | null; finalidade: string | null }>(
          "SELECT id, nome, descricao, finalidade FROM dna_work.mcp_integracao WHERE slug = $1 AND ativa = true", [slug],
        ).then((resultado) => resultado.rows[0] ?? null)
        : null,
    ]);
    // Escopos: só os suportados são concedidos; os demais são ignorados (nunca viram mcp:read). O padrão só vale quando o cliente omitiu `scope`.
    const solicitados = (params.scope ?? "").split(/\s+/).filter(Boolean);
    const escopos = {
      solicitados,
      concedidos: solicitados.filter((e) => ESCOPOS_SUPORTADOS.includes(e)),
      ignorados: solicitados.filter((e) => !ESCOPOS_SUPORTADOS.includes(e)),
      padraoAplicado: params.mcp_escopo_padrao === "1",
    };
    let motivo: string | null = null;
    if (!escopos.concedidos.length) motivo = "O aplicativo não solicitou nenhum escopo suportado.";
    else if (!usuario) motivo = "Somente usuários cadastrados e ativos do painel podem autorizar.";
    else if (!cliente) motivo = "Aplicativo desconhecido.";
    else if (!integracao || !recurso) motivo = "Integração inexistente ou desativada.";
    else if (!(cliente.redirectUris ?? []).every((uri) => redirectPermitido(mcp, uri))) motivo = "Endereço de retorno do aplicativo não permitido.";
    else {
      const { rows } = await db.query(
        "SELECT 1 FROM dna_work.mcp_integracao_usuario WHERE id_integracao = $1 AND id_usuario::text = $2",
        [integracao.id, usuario!.id],
      );
      if (!rows.length) motivo = "Você não foi autorizado nesta integração. Peça ao administrador.";
    }
    return { interacao, params, recurso, usuario, cliente, integracao, motivo, escopos };
  }

  app.get("/api/v1/mcp/interacao/:uid", { schema: { params: z.object({ uid: z.string().min(8).max(128) }) } }, async (request) => {
    const { uid } = request.params as { uid: string };
    const pedido = await carregar(request, uid);
    // O que ESTE usuário realmente poderá fazer (a autorização nunca amplia o que a administração concedeu).
    let modulos: Array<{ id: string; ferramentas: string[] }> = [];
    let abrangencia: string | null = null;
    let contato = false;
    if (pedido.usuario && pedido.integracao && !pedido.motivo) {
      const slug = slugDoRecurso(mcp, pedido.recurso!)!;
      const r = await carregarContexto(db, acesso, { usuarioId: pedido.usuario.id, slug, escopos: pedido.escopos.concedidos });
      if (r.ok) {
        const efetivas = registro.listar().filter((f) => motivoDaNegativa(r.contexto, f) === null);
        const porModulo = new Map<string, string[]>();
        for (const f of efetivas) porModulo.set(f.modulo, [...(porModulo.get(f.modulo) ?? []), f.titulo]);
        modulos = [...porModulo].map(([id, ferramentas]) => ({ id, ferramentas }));
        abrangencia = r.contexto.abrangencia;
        contato = r.contexto.permissoes.has("candidatos:contato");
      }
    }
    return ok({
      pode: pedido.motivo === null,
      motivo: pedido.motivo,
      aplicativo: pedido.cliente ? { id: pedido.cliente.clientId, nome: pedido.cliente.clientName ?? pedido.cliente.clientId } : null,
      integracao: pedido.integracao ? { nome: pedido.integracao.nome, descricao: pedido.integracao.descricao, finalidade: pedido.integracao.finalidade } : null,
      modulos, abrangencia, contato,
      privacidade: [
        "O assistente só consulta: não cria, altera nem apaga nada no painel.",
        "Ele enxerga apenas o que a administração liberou e o que o seu acesso no painel permite; autorizar não amplia isso.",
        "CPF, RG, documentos, dados bancários e endereço completo nunca são enviados.",
        "Cada consulta fica registrada (quem, quando e qual ferramenta), sem o conteúdo dos dados.",
        "Você pode revogar o acesso a qualquer momento pedindo ao administrador.",
      ],
      acesso: "Somente leitura, com as mesmas permissões que você tem no painel.",
      escopos: pedido.escopos,
      usuario: pedido.usuario ? { nome: pedido.usuario.nome } : null,
    });
  });

  app.post("/api/v1/mcp/interacao/:uid/decisao", {
    schema: { params: z.object({ uid: z.string().min(8).max(128) }), body: z.object({ aprovar: z.boolean() }) },
  }, async (request) => {
    // CSRF: o navegador sempre manda Origin em POST; precisa ser o do painel.
    const origem = request.headers.origin;
    if (origem !== mcp.appUrl) throw new AppError(403, "ORIGEM_INVALIDA", "Origem não permitida.");
    const { uid } = request.params as { uid: string };
    const { aprovar } = request.body as { aprovar: boolean };
    const pedido = await carregar(request, uid);
    const retomar = `${mcp.appUrl}/oauth/authorize/${uid}`;
    if (!aprovar) {
      pedido.interacao.result = { error: "access_denied", error_description: "O usuário negou o acesso." };
      await pedido.interacao.save(pedido.interacao.exp - agoraEmSegundos());
      return ok({ redirectTo: retomar });
    }
    if (pedido.motivo || !pedido.usuario || !pedido.recurso || !pedido.params.client_id) {
      throw new AppError(403, "AUTORIZACAO_NEGADA", pedido.motivo ?? "Autorização negada.");
    }
    const concessao = new provider.Grant({ accountId: pedido.usuario.id, clientId: pedido.params.client_id });
    concessao.addResourceScope(pedido.recurso, pedido.escopos.concedidos.join(" "));
    const grantId = await concessao.save();
    pedido.interacao.result = { login: { accountId: pedido.usuario.id, remember: false }, consent: { grantId } };
    await pedido.interacao.save(pedido.interacao.exp - agoraEmSegundos());
    return ok({ redirectTo: retomar });
  });
}
