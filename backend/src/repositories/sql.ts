import type { Pool, PoolClient } from "pg";
import { AppError } from "../lib/errors.js";

export type Db = Pool | PoolClient;

export async function many<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows as T[];
}

export async function one<T>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await many<T>(db, text, params);
  return rows[0] ?? null;
}

export const REGIME_SQL = `translate(lower(coalesce(m.descricao, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')`;

export function sortClause(sort: string | undefined, order: "asc" | "desc", allowed: Record<string, string>, fallback: string): string {
  if (sort && !allowed[sort]) {
    throw new AppError(400, "ORDENACAO_INVALIDA", "Ordenação não permitida.");
  }
  const column = (sort && allowed[sort]) || fallback;
  return `${column} ${order === "desc" ? "DESC" : "ASC"}`;
}
