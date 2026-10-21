import { onlyDigits } from "../lib/normalize.js";
import type { EmpresaCreate, EmpresaListQuery, EmpresaPatch } from "../schemas/empresa.js";
import { many, one, sortClause, type Db } from "./sql.js";

export type EmpresaRow = {
  id_empresa: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  status: number | null;
  responsavel: string | null;
  tipo_empresa: number | null;
  matriz: string | null;
  ie: string | null;
  site: string | null;
  obs: string | null;
  data_adicao: Date | string | null;
};

const COLUMNS = `
  id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, celular, cep, logradouro,
  numero, complemento, bairro, cidade, uf, status, responsavel, tipo_empresa, matriz, ie, site, obs, data_adicao
`;

const SORTS: Record<string, string> = {
  razao_social: "razao_social",
  nome_fantasia: "nome_fantasia",
  cidade: "cidade",
  cnpj: "cnpj",
};

export class EmpresaRepository {
  findById(db: Db, id: string): Promise<EmpresaRow | null> {
    return one<EmpresaRow>(db, `SELECT ${COLUMNS} FROM dna_work.empresa WHERE id_empresa = $1`, [id]);
  }

  findByCnpj(db: Db, cnpj: string, exceptId?: string): Promise<{ id_empresa: string } | null> {
    return one(db, `
      SELECT id_empresa
      FROM dna_work.empresa
      WHERE regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $1
        AND ($2::varchar IS NULL OR id_empresa <> $2)
      LIMIT 1
    `, [cnpj, exceptId ?? null]);
  }

  async insert(db: Db, input: EmpresaCreate, id: string): Promise<void> {
    await db.query(`
      INSERT INTO dna_work.empresa (
        id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, celular, cep,
        logradouro, numero, complemento, bairro, cidade, uf, status, responsavel,
        tipo_empresa, matriz, ie, site, obs, data_adicao
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        $9,$10,$11,$12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21, now()
      )
    `, [
      id, input.razao_social, input.nome_fantasia ?? null, input.cnpj, input.email.toLowerCase(),
      input.telefone ?? null, input.celular ?? null, input.cep ?? null, input.logradouro ?? null,
      input.numero ?? null, input.complemento ?? null, input.bairro ?? null, input.cidade ?? null,
      input.uf ?? null, input.status ?? 1, input.responsavel ?? null, input.tipo_empresa ?? null,
      input.matriz ?? null, input.ie ?? null, input.site ?? null, input.obs ?? null,
    ]);
  }

  async update(db: Db, id: string, input: EmpresaPatch): Promise<void> {
    const map: Record<string, unknown> = { ...input };
    if (typeof map.email === "string") map.email = map.email.toLowerCase();
    const entries = Object.entries(map).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([key], index) => `${key} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id);
    await db.query(`UPDATE dna_work.empresa SET ${sets.join(", ")} WHERE id_empresa = $${entries.length + 1}`, values);
  }

  async list(db: Db, query: EmpresaListQuery): Promise<{ rows: EmpresaRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.q) {
      const digits = onlyDigits(query.q);
      params.push(`%${query.q}%`, query.q);
      const like = `$${params.length - 1}`;
      const exact = `$${params.length}`;
      const parts = [`razao_social ILIKE ${like}`, `nome_fantasia ILIKE ${like}`, `id_empresa = ${exact}`];
      if (digits) {
        params.push(digits);
        parts.push(`regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $${params.length}`);
      }
      where.push(`(${parts.join(" OR ")})`);
    }
    if (query.razao_social) add("razao_social ILIKE $#", `%${query.razao_social}%`);
    if (query.nome_fantasia) add("nome_fantasia ILIKE $#", `%${query.nome_fantasia}%`);
    if (query.cnpj) add("regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = $#", onlyDigits(query.cnpj));
    if (query.cidade) add("cidade ILIKE $#", `%${query.cidade}%`);
    if (query.uf) add("upper(uf) = $#", query.uf.toUpperCase());
    if (query.status !== undefined) add("status = $#", query.status);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = sortClause(query.sort, query.order, SORTS, "razao_social");
    const totalRow = await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM dna_work.empresa ${clause}`, params);
    const rows = await many<EmpresaRow>(db, `
      SELECT ${COLUMNS} FROM dna_work.empresa
      ${clause}
      ORDER BY ${order} NULLS LAST, id_empresa
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }
}
