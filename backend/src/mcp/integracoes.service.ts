import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import type { McpConfig } from "./config.js";
import { recursoDaIntegracao } from "./config.js";
import type { RegistroFerramentas } from "./registro.js";

const SLUG = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

/**
 * Gestão das integrações MCP (a aba do painel chega na Fase 4; as rotas admin usarão este service).
 * Tudo nasce desligado: integração sem ferramenta e sem usuário não entrega nada (deny-by-default).
 */
export class IntegracoesMcpService {
  constructor(private readonly db: Pool, private readonly mcp: McpConfig, private readonly registro: RegistroFerramentas) {}

  async criar(input: { slug: string; nome: string; descricao?: string; instrucoes?: string }) {
    if (!SLUG.test(input.slug)) throw new AppError(422, "SLUG_INVALIDO", "Use letras minúsculas, números e hífens (2 a 60 caracteres).");
    const id = randomUUID();
    try {
      await this.db.query(
        "INSERT INTO dna_work.mcp_integracao (id, slug, nome, descricao, instrucoes, ativa) VALUES ($1, $2, $3, $4, $5, false)",
        [id, input.slug, input.nome.trim(), input.descricao ?? null, input.instrucoes ?? null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new AppError(409, "SLUG_EM_USO", "Já existe uma integração com esse identificador.");
      throw error;
    }
    return { id, slug: input.slug, url: recursoDaIntegracao(this.mcp, input.slug), ativa: false };
  }

  async definirAtiva(id: string, ativa: boolean) {
    const { rowCount } = await this.db.query("UPDATE dna_work.mcp_integracao SET ativa = $2, atualizado_em = now() WHERE id = $1", [id, ativa]);
    if (!rowCount) throw new AppError(404, "INTEGRACAO_NAO_ENCONTRADA", "Integração não encontrada.");
    if (!ativa) await this.revogar({ integracaoId: id });
  }

  /** Substitui o conjunto de ferramentas da integração. Nome fora do registro é recusado. */
  async definirFerramentas(id: string, nomes: string[]) {
    const validos = new Set(this.registro.nomes());
    const desconhecidas = nomes.filter((nome) => !validos.has(nome));
    if (desconhecidas.length) throw new AppError(422, "FERRAMENTA_DESCONHECIDA", `Ferramenta inexistente: ${desconhecidas.join(", ")}.`);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM dna_work.mcp_integracao_ferramenta WHERE id_integracao = $1", [id]);
      for (const nome of new Set(nomes)) {
        await client.query("INSERT INTO dna_work.mcp_integracao_ferramenta (id_integracao, ferramenta) VALUES ($1, $2)", [id, nome]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async vincularUsuario(idIntegracao: string, idUsuario: string, opcoes: { ferramentas?: string[] | null; permissoes?: string[] } = {}) {
    await this.db.query(
      `INSERT INTO dna_work.mcp_integracao_usuario (id_integracao, id_usuario, ferramentas, permissoes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_integracao, id_usuario) DO UPDATE SET ferramentas = EXCLUDED.ferramentas, permissoes = EXCLUDED.permissoes`,
      [idIntegracao, idUsuario, opcoes.ferramentas ?? null, opcoes.permissoes ?? []],
    );
  }

  async desvincularUsuario(idIntegracao: string, idUsuario: string) {
    await this.db.query("DELETE FROM dna_work.mcp_integracao_usuario WHERE id_integracao = $1 AND id_usuario = $2", [idIntegracao, idUsuario]);
    await this.revogar({ usuarioId: idUsuario, integracaoId: idIntegracao });
  }

  /**
   * Revoga autorizações OAuth (grants, tokens, códigos e sessões). Vale na próxima chamada, também em conexões abertas.
   * Por usuário, por integração, ou o cruzamento dos dois.
   */
  async revogar(filtro: { usuarioId?: string; integracaoId?: string }) {
    const condicoes = ["tipo = 'Grant'"];
    const params: unknown[] = [];
    if (filtro.usuarioId) {
      params.push(filtro.usuarioId);
      condicoes.push(`payload ->> 'accountId' = $${params.length}`);
    }
    if (filtro.integracaoId) {
      const { rows } = await this.db.query<{ slug: string }>("SELECT slug FROM dna_work.mcp_integracao WHERE id = $1", [filtro.integracaoId]);
      if (!rows[0]) return { revogados: 0 };
      params.push(recursoDaIntegracao(this.mcp, rows[0].slug));
      condicoes.push(`payload -> 'resources' ? $${params.length}`);
    }
    const { rows: concessoes } = await this.db.query<{ id: string }>(
      `SELECT id FROM dna_work.mcp_oauth_registro WHERE ${condicoes.join(" AND ")}`, params,
    );
    const ids = concessoes.map((linha) => linha.id);
    if (ids.length) {
      await this.db.query("DELETE FROM dna_work.mcp_oauth_registro WHERE grant_id = ANY($1::text[]) OR (tipo = 'Grant' AND id = ANY($1::text[]))", [ids]);
    }
    return { revogados: ids.length };
  }
}
