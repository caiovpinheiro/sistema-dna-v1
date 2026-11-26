import type { Pool } from "pg";

/**
 * Consome o nonce de forma atômica: a chave primária (chave, nonce) garante que, mesmo com várias réplicas
 * recebendo a mesma requisição ao mesmo tempo, só um INSERT vence. Quem perde é replay.
 */
export async function consumirNonce(db: Pool, chave: string, nonce: string, ttlSegundos: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO dna_work.mcp_nonce (chave, nonce, expira_em) VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (chave, nonce) DO NOTHING`,
    [chave, nonce, String(ttlSegundos)],
  );
  if (Math.random() < 0.02) {
    void db.query("DELETE FROM dna_work.mcp_nonce WHERE expira_em < now()").catch(() => undefined);
  }
  return rowCount === 1;
}

export type ResultadoLimite = { permitido: boolean; restante: number; reiniciaEmSegundos: number };

/** Contador por janela fixa, compartilhado entre réplicas (UPSERT atômico). */
export async function consumirLimite(db: Pool, chave: string, maximo: number, janelaSegundos = 60): Promise<ResultadoLimite> {
  const agora = Math.floor(Date.now() / 1000);
  const janela = Math.floor(agora / janelaSegundos);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO dna_work.mcp_limite (chave, janela, n) VALUES ($1, $2, 1)
     ON CONFLICT (chave, janela) DO UPDATE SET n = dna_work.mcp_limite.n + 1
     RETURNING n`,
    [chave.slice(0, 200), janela],
  );
  if (Math.random() < 0.02) {
    void db.query("DELETE FROM dna_work.mcp_limite WHERE janela < $1", [janela - 5]).catch(() => undefined);
  }
  const n = rows[0]?.n ?? 1;
  return { permitido: n <= maximo, restante: Math.max(0, maximo - n), reiniciaEmSegundos: (janela + 1) * janelaSegundos - agora };
}

export type EventoAuditoria = {
  idUsuario?: string | null;
  idIntegracao?: string | null;
  slug?: string | null;
  operacao: string;
  ferramenta?: string | null;
  resultado: "ok" | "erro" | "negado" | "invalido" | "limite";
  codigo?: string | null;
  duracaoMs?: number | null;
  requestId?: string | null;
  cliente?: string | null;
};

/**
 * Grava a auditoria. Sem tokens, sem argumentos e sem dados de candidatos.
 * Lança em caso de falha: quem chama decide se isso impede a resposta (a execução de ferramentas impede).
 */
export async function auditar(db: Pool, evento: EventoAuditoria): Promise<void> {
  await db.query(
    `INSERT INTO dna_work.mcp_auditoria (id_usuario, id_integracao, slug, operacao, ferramenta, resultado, codigo, duracao_ms, request_id, cliente)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      evento.idUsuario ?? null, evento.idIntegracao ?? null, evento.slug?.slice(0, 60) ?? null, evento.operacao.slice(0, 30),
      evento.ferramenta?.slice(0, 80) ?? null, evento.resultado, evento.codigo?.slice(0, 80) ?? null,
      evento.duracaoMs ?? null, evento.requestId?.slice(0, 80) ?? null, evento.cliente?.slice(0, 300) ?? null,
    ],
  );
}

/** Tentativas sem identidade (assinatura inválida etc.): auditadas, mas com teto por minuto para não encher a tabela. */
export async function auditarTentativa(db: Pool, evento: EventoAuditoria, tetoPorMinuto = 60): Promise<void> {
  const limite = await consumirLimite(db, "auditoria-tentativas", tetoPorMinuto);
  if (limite.permitido) await auditar(db, evento);
}
