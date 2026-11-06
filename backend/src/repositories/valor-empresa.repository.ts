import type { Pool } from "pg";

/** Condições de cobrança do contrato de cada empresa (public.valor_empresas). */
export type ValorEmpresa = {
  id_empresa: string;
  cnpj: string;
  nome: string;
  razao_social: string | null;
  tipo: string | null;
  cadastro: string | null;
  servicos: string[];
  clt_modelo: string;
  clt_valor: string | null;
  clt_taxa: string | null;
  clt_calculo: string | null;
  clt_status: string;
  est_modelo: string;
  est_mensal: string | null;
  est_rs: string | null;
  est_taxa: string | null;
  est_calculo: string | null;
  est_status: string;
  ciclo: string | null;
  fechamento_dia: number | null;
  vencimento_dia: number | null;
  notas: string[];
  alertas: string[];
  documentos: string[];
  atualizado_em: string;
};

const CAMPOS = `id_empresa, cnpj, nome, razao_social, tipo, cadastro, servicos, clt_modelo, clt_valor::text, clt_taxa, clt_calculo, clt_status,
  est_modelo, est_mensal::text, est_rs::text, est_taxa, est_calculo, est_status, ciclo, fechamento_dia, vencimento_dia,
  notas, alertas, documentos, atualizado_em::text`;

export async function valorDaEmpresa(db: Pool, idEmpresa: string): Promise<ValorEmpresa | null> {
  const { rows } = await db.query<ValorEmpresa>(`SELECT ${CAMPOS} FROM public.valor_empresas WHERE id_empresa = $1`, [idEmpresa]);
  return rows[0] ?? null;
}

/** As empresas do grupo, com as condições de cobrança quando existem (cobranca = null quando não há contrato cadastrado). */
export async function valoresDoGrupo(db: Pool, grupoId: string) {
  const { rows } = await db.query<{ id: string; nome: string; cnpj: string | null }>(
    `SELECT e.id::text AS id, coalesce(nullif(btrim(e.nome_fantasia), ''), e.razao_social) AS nome, e.cnpj
     FROM public.empresa e WHERE e.grupo_id = $1 ORDER BY 2`,
    [grupoId],
  );
  if (!rows.length) return [];
  const valores = await db.query<ValorEmpresa>(`SELECT ${CAMPOS} FROM public.valor_empresas WHERE id_empresa = ANY($1::text[])`, [rows.map((row) => row.id)]);
  const porId = new Map(valores.rows.map((row) => [row.id_empresa, row]));
  return rows.map((row) => ({ id_empresa: row.id, nome: row.nome, cnpj: row.cnpj, cobranca: porId.get(row.id) ?? null }));
}
