import { isoToLegacy } from "../lib/dates.js";
import type { ContratacaoListQuery } from "../schemas/contratacao.js";
import { many, one, REGIME_SQL, sortClause, type Db } from "./sql.js";

export type ContratacaoRow = {
  id_contratacao: number;
  id_vaga: string | null;
  id_candidato: string | null;
  id_empresa: string | null;
  data_contratacao: string | null;
  data_demicao: string | null;
  status: number | null;
  contador: number | null;
  comparador: string | null;
  datainicio: string | null;
  datafim: string | null;
  ferias: number | null;
  id_supervisor: number | null;
  id_responsavel_agente: number | null;
  candidato_nome: string | null;
  candidato_cpf: string | null;
  empresa_razao: string | null;
  empresa_fantasia: string | null;
  cargo: string | null;
  salario: string | null;
  tipo_vaga: number | null;
  modalidade: string | null;
  carga_horaria: string | null;
};

const SELECT = `
  SELECT cv.id_contratacao, cv.id_vaga, cv.id_candidato, cv.id_empresa, cv.data_contratacao,
         cv.data_demicao, cv.status, cv.contador, cv.comparador, cv.datainicio, cv.datafim,
         cv.ferias, cv.id_supervisor, cv.id_responsavel_agente,
         c.nome AS candidato_nome, c.cpf AS candidato_cpf,
         e.razao_social AS empresa_razao, e.nome_fantasia AS empresa_fantasia,
         v.cargo, v.salario, v.tipo_vaga, v.carga_horaria, m.descricao AS modalidade
  FROM dna_work.conratacaovaga cv
  LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
  LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
  LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
  LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
`;

const SORTS: Record<string, string> = {
  data_inicio: "cv.datainicio",
  candidato: "c.nome",
  empresa: "e.razao_social",
  status: "cv.status",
  id: "cv.id_contratacao",
};

export class ContratacaoRepository {
  findById(db: Db, id: number): Promise<ContratacaoRow | null> {
    return one<ContratacaoRow>(db, `${SELECT} WHERE cv.id_contratacao = $1`, [id]);
  }

  async lockById(db: Db, id: number): Promise<ContratacaoRow | null> {
    const locked = await one<{ id_contratacao: number }>(db, `
      SELECT id_contratacao FROM dna_work.conratacaovaga WHERE id_contratacao = $1 FOR UPDATE
    `, [id]);
    if (!locked) return null;
    return this.findById(db, id);
  }

  countActiveByVaga(db: Db, idVaga: string, statusAtivo: number): Promise<{ total: number }> {
    return one<{ total: number }>(db, `
      SELECT count(*)::int AS total
      FROM dna_work.conratacaovaga
      WHERE id_vaga = $1 AND status = $2
    `, [idVaga, statusAtivo]).then((row) => row ?? { total: 0 });
  }

  findActiveDuplicate(db: Db, idVaga: string, idCandidato: string, statusAtivo: number) {
    return one<{ id_contratacao: number }>(db, `
      SELECT id_contratacao
      FROM dna_work.conratacaovaga
      WHERE id_vaga = $1 AND id_candidato = $2 AND status = $3
      LIMIT 1
    `, [idVaga, idCandidato, statusAtivo]);
  }

  findOtherActive(db: Db, idCandidato: string, statusAtivo: number) {
    return one<{ id_contratacao: number; id_empresa: string | null }>(db, `
      SELECT id_contratacao, id_empresa
      FROM dna_work.conratacaovaga
      WHERE id_candidato = $1 AND status = $2
      LIMIT 1
    `, [idCandidato, statusAtivo]);
  }

  async insert(db: Db, values: {
    idVaga: string;
    idCandidato: string;
    idEmpresa: string;
    dataContratacao: string;
    dataInicio: string;
    dataFim: string | null;
    status: number;
    contador: number | null;
    comparador: string | null;
  }): Promise<number> {
    const row = await one<{ id_contratacao: number }>(db, `
      INSERT INTO dna_work.conratacaovaga (
        id_contratacao, id_vaga, id_candidato, id_empresa, data_contratacao, status,
        contador, comparador, datainicio, datafim
      ) VALUES (
        nextval('dna_work.conratacaovaga_id_contratacao_seq'),
        $1,$2,$3,$4,$5,$6,$7,$8,$9
      )
      RETURNING id_contratacao
    `, [
      values.idVaga, values.idCandidato, values.idEmpresa, values.dataContratacao,
      values.status, values.contador, values.comparador, values.dataInicio, values.dataFim,
    ]);
    return row!.id_contratacao;
  }

  async encerrar(db: Db, id: number, status: number, dataDemissao: string): Promise<void> {
    await db.query(`
      UPDATE dna_work.conratacaovaga
      SET status = $2,
          data_demicao = $3::varchar,
          datafim = COALESCE(NULLIF(btrim(datafim), ''), $3::varchar)
      WHERE id_contratacao = $1
    `, [id, status, dataDemissao]);
  }

  async insertColaborador(db: Db, values: {
    idColaborador: string;
    idCandidato: string;
    idEmpresa: string;
    dataInicio: string;
    cargo: string | null;
    tipoVaga: number | null;
    salario: string | null;
    cargaHoraria: string | null;
    dataCadastro: string;
    status: number;
    idContratacao: number;
  }): Promise<void> {
    await db.query(`
      INSERT INTO dna_work.colaborador (
        id_colaborador, id_candidato, id_empresa, data_inicio, cargo, tipo_vaga, salario,
        carga_horaria, data_cadastro, status_colaborador, id_contratacao
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      values.idColaborador, values.idCandidato, values.idEmpresa, values.dataInicio,
      values.cargo, values.tipoVaga, values.salario, values.cargaHoraria, values.dataCadastro,
      values.status, values.idContratacao,
    ]);
  }

  async encerrarColaborador(db: Db, idContratacao: number, status: number): Promise<void> {
    await db.query(`
      UPDATE dna_work.colaborador
      SET status_colaborador = $2
      WHERE id_contratacao = $1
    `, [idContratacao, status]);
  }

  async atualizarFlagCandidato(db: Db, idCandidato: string, idEmpresa: string | null, ativo: boolean, hoje: string): Promise<void> {
    if (ativo && idEmpresa) {
      await db.query(`
        UPDATE dna_work.candidato
        SET colaborador = 1, id_empresa = $2, ultimaalteracao = $3
        WHERE id_candidato = $1
      `, [idCandidato, idEmpresa, hoje]);
      return;
    }
    await db.query(`
      UPDATE dna_work.candidato
      SET colaborador = 0, ultimaalteracao = $2
      WHERE id_candidato = $1
    `, [idCandidato, hoje]);
  }

  async list(db: Db, query: ContratacaoListQuery): Promise<{ rows: ContratacaoRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.q) {
      params.push(`%${query.q}%`);
      const like = `$${params.length}`;
      const digits = query.q.replace(/\D/g, "");
      const parts = [`c.nome ILIKE ${like}`, `e.razao_social ILIKE ${like}`, `v.cargo ILIKE ${like}`];
      if (digits.length >= 3) {
        params.push(digits);
        parts.push(`regexp_replace(coalesce(c.cpf, ''), '\\D', '', 'g') = $${params.length}`);
      }
      where.push(`(${parts.join(" OR ")})`);
    }
    if (query.id_empresa) add("cv.id_empresa = $#", query.id_empresa);
    if (query.id_vaga) add("cv.id_vaga = $#", query.id_vaga);
    if (query.id_candidato) add("cv.id_candidato = $#", query.id_candidato);
    if (query.status !== undefined) add("cv.status = $#", query.status);
    if (query.regime) {
      params.push(`%${query.regime}%`);
      where.push(`${REGIME_SQL} LIKE $${params.length}`);
    }
    const periodo = `replace(coalesce(nullif(btrim(cv.datainicio), ''), nullif(btrim(cv.data_contratacao), '')), '-', '/')`;
    if (query.inicio_de) add(`${periodo} >= $#`, isoToLegacy(query.inicio_de));
    if (query.inicio_ate) add(`${periodo} <= $#`, isoToLegacy(query.inicio_ate));
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = query.sort
      ? sortClause(query.sort, query.order, SORTS, "cv.id_contratacao")
      : "cv.id_contratacao DESC";
    const totalRow = await one<{ total: number }>(db, `
      SELECT count(*)::int AS total
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      ${clause}
    `, params);
    const rows = await many<ContratacaoRow>(db, `
      ${SELECT}
      ${clause}
      ORDER BY ${order}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }

  async recent(db: Db, limit: number): Promise<ContratacaoRow[]> {
    return many<ContratacaoRow>(db, `${SELECT} ORDER BY
      CASE WHEN cv.data_contratacao ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN to_date(left(cv.data_contratacao, 10), 'YYYY/MM/DD') END DESC NULLS LAST,
      CASE WHEN cv.datainicio ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN to_date(left(cv.datainicio, 10), 'YYYY/MM/DD') END DESC NULLS LAST,
      cv.id_contratacao DESC
      LIMIT $1`, [limit]);
  }
}
