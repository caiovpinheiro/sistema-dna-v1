import type pg from "pg";

export type SchemaCapabilities = {
  quantidadePosicoes: boolean;
  colaboradorContratacao: boolean;
  idempotencia: boolean;
  sequence: boolean;
  missing: string[];
};

export async function loadCapabilities(pool: pg.Pool): Promise<SchemaCapabilities> {
  const columns = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'dna_work'
      AND (
        (table_name = 'vaga' AND column_name = 'quantidade_posicoes')
        OR (table_name = 'colaborador' AND column_name = 'id_contratacao')
        OR (table_name = 'api_idempotencia' AND column_name = 'chave')
      )
  `);
  const found = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const sequence = await pool.query<{ seq: string | null }>(
    "SELECT to_regclass('dna_work.conratacaovaga_id_contratacao_seq') AS seq",
  );
  const capabilities = {
    quantidadePosicoes: found.has("vaga.quantidade_posicoes"),
    colaboradorContratacao: found.has("colaborador.id_contratacao"),
    idempotencia: found.has("api_idempotencia.chave"),
    sequence: Boolean(sequence.rows[0]?.seq),
    missing: [] as string[],
  };
  if (!capabilities.quantidadePosicoes) capabilities.missing.push("001_vaga_quantidade_posicoes");
  if (!capabilities.sequence) capabilities.missing.push("002_conratacaovaga_sequence");
  if (!capabilities.colaboradorContratacao) capabilities.missing.push("003_colaborador_id_contratacao");
  if (!capabilities.idempotencia) capabilities.missing.push("004_api_idempotencia");
  return capabilities;
}
