import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";

const CHAVE_TRAVA = 7_042_026; // pg_advisory_lock: uma réplica por vez
const LOTE = 5000;

export type ResultadoManutencao = {
  executada: boolean;
  nonces: number; limites: number; oauth: number; auditoria: number;
};

async function apagarEmLotes(db: Pool, tabela: string, condicao: string, params: unknown[] = []): Promise<number> {
  let total = 0;
  for (;;) {
    const { rowCount } = await db.query(
      `DELETE FROM ${tabela} WHERE ctid IN (SELECT ctid FROM ${tabela} WHERE ${condicao} LIMIT ${LOTE})`, params,
    );
    total += rowCount ?? 0;
    if (!rowCount || rowCount < LOTE) return total;
  }
}

/**
 * Limpeza da política de retenção:
 * - nonces vencidos (já não protegem nada: fora da janela do HMAC o timestamp já recusa);
 * - contadores de rate limit de janelas antigas;
 * - registros OAuth vencidos há mais de MCP_OAUTH_RETENCAO_DIAS (códigos, tokens, sessões, interações, grants);
 *   a chave de assinatura e registros sem validade (clientes) nunca são apagados;
 * - auditoria mais antiga que MCP_AUDITORIA_RETENCAO_DIAS (mínimo 30 dias; 0 = nunca apagar).
 * Usa trava no banco: com várias réplicas, só uma executa.
 */
export async function executarManutencao(db: Pool, config: Pick<AppConfig, "MCP_AUDITORIA_RETENCAO_DIAS" | "MCP_OAUTH_RETENCAO_DIAS">): Promise<ResultadoManutencao> {
  const cliente = await db.connect();
  try {
    const { rows } = await cliente.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [CHAVE_TRAVA]);
    if (!rows[0]?.ok) return { executada: false, nonces: 0, limites: 0, oauth: 0, auditoria: 0 };
    try {
      const nonces = await apagarEmLotes(db, "dna_work.mcp_nonce", "expira_em < now()");
      const limites = await apagarEmLotes(db, "dna_work.mcp_limite", "janela < floor(extract(epoch from now()) / 60) - 1440");
      const oauth = await apagarEmLotes(
        db, "dna_work.mcp_oauth_registro",
        "tipo <> 'ChaveAssinatura' AND expira_em IS NOT NULL AND expira_em < now() - ($1 || ' days')::interval", [String(config.MCP_OAUTH_RETENCAO_DIAS)],
      );
      const dias = config.MCP_AUDITORIA_RETENCAO_DIAS;
      const auditoria = dias === 0 ? 0 : await apagarEmLotes(db, "dna_work.mcp_auditoria", "ocorrido_em < now() - ($1 || ' days')::interval", [String(Math.max(30, dias))]);
      return { executada: true, nonces, limites, oauth, auditoria };
    } finally {
      await cliente.query("SELECT pg_advisory_unlock($1)", [CHAVE_TRAVA]);
    }
  } finally {
    cliente.release();
  }
}

/** Agenda a manutenção (desligada com MCP_MANUTENCAO_INTERVALO_MIN=0). Devolve a função que para o agendamento. */
export function agendarManutencao(db: Pool, config: AppConfig, log: Pick<FastifyBaseLogger, "info" | "error">): () => void {
  const minutos = config.MCP_MANUTENCAO_INTERVALO_MIN;
  if (!minutos) return () => undefined;
  const rodar = () => {
    executarManutencao(db, config).then((r) => { if (r.executada) log.info(r, "mcp: manutenção concluída"); }).catch((e: unknown) => log.error({ mensagem: e instanceof Error ? e.message : String(e) }, "mcp: manutenção falhou"));
  };
  const primeira = setTimeout(rodar, 60_000);
  const periodica = setInterval(rodar, minutos * 60_000);
  primeira.unref(); periodica.unref();
  return () => { clearTimeout(primeira); clearInterval(periodica); };
}
