import type { Adapter, AdapterPayload } from "oidc-provider";
import { errors } from "oidc-provider";
import type { Pool } from "pg";
import { sha256Hex } from "./util.js";

/** Tipos cujo identificador é um segredo (código, tokens, sessão): só o hash vai para o banco. */
const TIPOS_COM_HASH = new Set(["AccessToken", "RefreshToken", "AuthorizationCode", "Session", "ReplayDetection"]);
const TABELA = "dna_work.mcp_oauth_registro";

/**
 * Adaptador PostgreSQL do oidc-provider. Pontos de segurança:
 * - segredos guardados só como SHA-256 (e o `jti`, que é o próprio token, é removido do payload);
 * - `consume` é um UPDATE condicional atômico: de duas requisições concorrentes com o mesmo código ou
 *   refresh token, só uma ganha; a outra recebe invalid_grant e o grant inteiro é revogado.
 */
export class AdaptadorPg implements Adapter {
  constructor(private readonly db: Pool, private readonly tipo: string) {}

  private chave(id: string): string {
    return TIPOS_COM_HASH.has(this.tipo) ? sha256Hex(id) : id;
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const guardado = { ...payload };
    if (TIPOS_COM_HASH.has(this.tipo)) delete (guardado as { jti?: string }).jti;
    await this.db.query(
      `INSERT INTO ${TABELA} (tipo, id, payload, grant_id, uid, user_code, expira_em)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, CASE WHEN $7::text IS NULL THEN NULL ELSE now() + ($7 || ' seconds')::interval END)
       ON CONFLICT (tipo, id) DO UPDATE
         SET payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id, uid = EXCLUDED.uid,
             user_code = EXCLUDED.user_code, expira_em = EXCLUDED.expira_em`,
      [this.tipo, this.chave(id), JSON.stringify(guardado), payload.grantId ?? null, payload.uid ?? null, payload.userCode ?? null, Number.isFinite(expiresIn) && expiresIn > 0 ? String(Math.floor(expiresIn)) : null], // cliente registrado (DCR) não expira
    );
    // Limpeza oportunista de registros vencidos (evita um agendador só para isso).
    if (Math.random() < 0.02) {
      void this.db.query(`DELETE FROM ${TABELA} WHERE expira_em < now() - interval '1 day'`).catch(() => undefined);
    }
  }

  private montar(id: string | null, linha: { payload: AdapterPayload; consumido_em: Date | null }): AdapterPayload {
    const resultado: AdapterPayload = { ...linha.payload };
    if (id && TIPOS_COM_HASH.has(this.tipo)) resultado.jti = id;
    if (linha.consumido_em) resultado.consumed = Math.floor(linha.consumido_em.getTime() / 1000);
    return resultado;
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const { rows } = await this.db.query<{ payload: AdapterPayload; consumido_em: Date | null }>(
      `SELECT payload, consumido_em FROM ${TABELA} WHERE tipo = $1 AND id = $2 AND (expira_em IS NULL OR expira_em > now())`,
      [this.tipo, this.chave(id)],
    );
    return rows[0] ? this.montar(id, rows[0]) : undefined;
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const { rows } = await this.db.query<{ id: string; payload: AdapterPayload; consumido_em: Date | null }>(
      `SELECT id, payload, consumido_em FROM ${TABELA} WHERE tipo = $1 AND uid = $2 AND (expira_em IS NULL OR expira_em > now())`,
      [this.tipo, uid],
    );
    return rows[0] ? this.montar(null, rows[0]) : undefined;
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const { rows } = await this.db.query<{ payload: AdapterPayload; consumido_em: Date | null }>(
      `SELECT payload, consumido_em FROM ${TABELA} WHERE tipo = $1 AND user_code = $2 AND (expira_em IS NULL OR expira_em > now())`,
      [this.tipo, userCode],
    );
    return rows[0] ? this.montar(null, rows[0]) : undefined;
  }

  async destroy(id: string): Promise<void> {
    await this.db.query(`DELETE FROM ${TABELA} WHERE tipo = $1 AND id = $2`, [this.tipo, this.chave(id)]);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.db.query(`DELETE FROM ${TABELA} WHERE grant_id = $1`, [grantId]);
  }

  async consume(id: string): Promise<void> {
    const { rows } = await this.db.query<{ grant_id: string | null }>(
      `UPDATE ${TABELA} SET consumido_em = now()
       WHERE tipo = $1 AND id = $2 AND consumido_em IS NULL AND (expira_em IS NULL OR expira_em > now())
       RETURNING grant_id`,
      [this.tipo, this.chave(id)],
    );
    if (rows.length) return;
    // Perdeu a corrida (ou reuso): revoga tudo que nasceu desse grant e recusa.
    const { rows: existente } = await this.db.query<{ grant_id: string | null }>(
      `SELECT grant_id FROM ${TABELA} WHERE tipo = $1 AND id = $2`,
      [this.tipo, this.chave(id)],
    );
    const grant = existente[0]?.grant_id;
    if (grant) {
      await this.revokeByGrantId(grant);
      await this.db.query(`DELETE FROM ${TABELA} WHERE tipo = 'Grant' AND id = $1`, [grant]);
    }
    throw new errors.InvalidGrant(`${this.tipo === "RefreshToken" ? "refresh token" : "authorization code"} already consumed`);
  }
}
