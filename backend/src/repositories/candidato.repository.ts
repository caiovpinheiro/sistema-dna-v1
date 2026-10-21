import { isoToLegacy, legacyToday } from "../lib/dates.js";
import { onlyDigits } from "../lib/normalize.js";
import type { CandidatoCreate, CandidatoListQuery, CandidatoPatch } from "../schemas/candidato.js";
import { many, one, REGIME_SQL, sortClause, type Db } from "./sql.js";

export type CandidatoRow = {
  id_candidato: string;
  nome: string | null;
  cpf: string | null;
  rg: string | null;
  rg_expedidor: string | null;
  datanascimento: string | null;
  datacadastro: string | null;
  ultimaalteracao: string | null;
  telefonefixo: string | null;
  celular: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  escola: string | null;
  nome_escola: string | null;
  modalidadecurso: string | null;
  curso: string | null;
  periodo: string | null;
  semestre: string | null;
  ctps: string | null;
  sexo: string | null;
  estadocivil: string | null;
  obs: string | null;
  id_empresa: string | null;
  colaborador: number | null;
  contador: number | null;
  banco: string | null;
  agencia: string | null;
  numero_conta: string | null;
  nome_conta: string | null;
  tipo_chave_pix: string | null;
  chave_pix: string | null;
  pcd: string | null;
};

const COLUMNS = `
  c.id_candidato, c.nome, c.cpf, c.rg, c.rg_expedidor, c.datanascimento, c.datacadastro,
  c.ultimaalteracao, c.telefonefixo, c.celular, c.email, c.logradouro, c.numero, c.complemento,
  c.bairro, c.cidade, c.estado, c.cep, c.escola, c.nome_escola, c.modalidadecurso, c.curso,
  c.periodo, c.semestre, c.ctps, c.sexo, c.estadocivil, c.obs, c.id_empresa, c.colaborador,
  c.contador, c.banco, c.agencia, c.numero_conta, c.nome_conta, c.tipo_chave_pix, c.chave_pix, c.pcd
`;

const SORTS: Record<string, string> = {
  nome: "c.nome",
  datacadastro: "c.datacadastro",
  cidade: "c.cidade",
  email: "c.email",
};

export class CandidatoRepository {
  constructor(private readonly statusAtivo: number, private readonly statusEncerrado: number) {}

  findById(db: Db, id: string): Promise<CandidatoRow | null> {
    return one<CandidatoRow>(db, `SELECT ${COLUMNS} FROM dna_work.candidato c WHERE c.id_candidato = $1`, [id]);
  }

  findByCpf(db: Db, cpf: string, exceptId?: string): Promise<{ id_candidato: string } | null> {
    return one(db, `
      SELECT id_candidato
      FROM dna_work.candidato
      WHERE regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = $1
        AND ($2::varchar IS NULL OR id_candidato <> $2)
      LIMIT 1
    `, [cpf, exceptId ?? null]);
  }

  async insert(db: Db, input: CandidatoCreate, id: string): Promise<void> {
    const today = legacyToday();
    await db.query(`
      INSERT INTO dna_work.candidato (
        id_candidato, nome, cpf, rg, rg_expedidor, datanascimento, datacadastro, ultimaalteracao,
        telefonefixo, celular, email, logradouro, numero, complemento, bairro, cidade, estado, cep,
        escola, nome_escola, modalidadecurso, curso, periodo, semestre, ctps, sexo, estadocivil, obs,
        colaborador, banco, agencia, numero_conta, nome_conta, tipo_chave_pix, chave_pix, pcd
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
        0,$28,$29,$30,$31,$32,$33,$34
      )
    `, [
      id, input.nome, input.cpf, input.rg ?? null, input.rg_expedidor ?? null,
      input.datanascimento ? isoToLegacy(input.datanascimento) : null, today,
      input.telefonefixo ?? null, input.celular ?? null, input.email.toLowerCase(),
      input.logradouro ?? null, input.numero ?? null, input.complemento ?? null,
      input.bairro ?? null, input.cidade ?? null, input.estado ?? null, input.cep ?? null,
      input.escola ?? null, input.nome_escola ?? null, input.modalidadecurso ?? null,
      input.curso ?? null, input.periodo ?? null, input.semestre ?? null, input.ctps ?? null,
      input.sexo ?? null, input.estadocivil ?? null, input.obs ?? null,
      input.banco ?? null, input.agencia ?? null, input.numero_conta ?? null,
      input.nome_conta ?? null, input.tipo_chave_pix ?? null, input.chave_pix ?? null, input.pcd ?? null,
    ]);
  }

  async update(db: Db, id: string, input: CandidatoPatch): Promise<void> {
    const map: Record<string, unknown> = { ...input };
    if (typeof map.datanascimento === "string") map.datanascimento = isoToLegacy(map.datanascimento);
    if (typeof map.email === "string") map.email = map.email.toLowerCase();
    const entries = Object.entries(map).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([key], index) => `${key} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(legacyToday(), id);
    await db.query(`
      UPDATE dna_work.candidato
      SET ${sets.join(", ")}, ultimaalteracao = $${entries.length + 1}
      WHERE id_candidato = $${entries.length + 2}
    `, values);
  }

  async list(db: Db, query: CandidatoListQuery): Promise<{ rows: CandidatoRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.nome) add("c.nome ILIKE $#", `%${query.nome}%`);
    if (query.cpf) add("regexp_replace(coalesce(c.cpf, ''), '\\D', '', 'g') = $#", onlyDigits(query.cpf));
    if (query.email) add("c.email ILIKE $#", `%${query.email}%`);
    if (query.telefone) {
      const digits = onlyDigits(query.telefone);
      add(`(
        regexp_replace(coalesce(c.celular, ''), '\\D', '', 'g') LIKE '%' || $# || '%'
        OR regexp_replace(coalesce(c.telefonefixo, ''), '\\D', '', 'g') LIKE '%' || $# || '%'
      )`, digits);
    }
    if (query.cidade) add("c.cidade ILIKE $#", `%${query.cidade}%`);
    if (query.uf) add("upper(c.estado) = $#", query.uf.toUpperCase());
    if (query.id_empresa) {
      add(`(
        c.id_empresa = $#
        OR EXISTS (
          SELECT 1 FROM dna_work.conratacaovaga cv
          WHERE cv.id_candidato = c.id_candidato AND cv.id_empresa = $#
        )
      )`, query.id_empresa);
    }
    if (query.regime) {
      params.push(this.statusAtivo, `%${query.regime}%`);
      const statusRef = `$${params.length - 1}`;
      const regimeRef = `$${params.length}`;
      where.push(`EXISTS (
        SELECT 1 FROM dna_work.conratacaovaga cv
        JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
        JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
        WHERE cv.id_candidato = c.id_candidato
          AND cv.status = ${statusRef}
          AND ${REGIME_SQL} LIKE ${regimeRef}
      )`);
    }
    if (query.situacao === "ativo") {
      add(`EXISTS (SELECT 1 FROM dna_work.conratacaovaga cv WHERE cv.id_candidato = c.id_candidato AND cv.status = $#)`, this.statusAtivo);
    }
    if (query.situacao === "encerrado") {
      params.push(this.statusEncerrado, this.statusAtivo);
      where.push(`EXISTS (SELECT 1 FROM dna_work.conratacaovaga cv WHERE cv.id_candidato = c.id_candidato AND cv.status = $${params.length - 1})
        AND NOT EXISTS (SELECT 1 FROM dna_work.conratacaovaga cv WHERE cv.id_candidato = c.id_candidato AND cv.status = $${params.length})`);
    }
    if (query.situacao === "sem_vinculo") {
      where.push("NOT EXISTS (SELECT 1 FROM dna_work.conratacaovaga cv WHERE cv.id_candidato = c.id_candidato)");
    }
    if (query.cadastro_de) add("c.datacadastro >= $#", isoToLegacy(query.cadastro_de));
    if (query.cadastro_ate) add("c.datacadastro <= $#", isoToLegacy(query.cadastro_ate));

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = sortClause(query.sort, query.order, SORTS, "c.nome");
    const totalRow = await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM dna_work.candidato c ${clause}`, params);
    const rows = await many<CandidatoRow>(db, `
      SELECT ${COLUMNS}
      FROM dna_work.candidato c
      ${clause}
      ORDER BY ${order} NULLS LAST, c.id_candidato
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }
}
