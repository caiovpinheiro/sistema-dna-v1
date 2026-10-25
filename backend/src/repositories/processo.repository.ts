import { randomUUID } from "node:crypto";
import type { Etapa, Origem } from "../lib/processo.js";
import type { ProcessoListQuery } from "../schemas/processo.js";
import { many, one, type Db } from "./sql.js";

export type ProcessoRow = {
  id: string;
  id_candidato: string;
  candidato_nome: string | null;
  id_empresa: string;
  empresa_nome: string | null;
  id_vaga: string;
  cargo: string | null;
  origem: Origem;
  data_recebimento: string;
  data_encaminhamento: string | null;
  etapa: Etapa;
  id_contratacao: number | null;
  criado_em: string;
};

export type MovimentoRow = {
  id: string;
  etapa: Etapa;
  observacao: string | null;
  criado_em: string;
};

const SELECT = `
  SELECT p.id, p.id_candidato, c.nome AS candidato_nome, p.id_empresa,
         coalesce(e.nome_fantasia, e.razao_social) AS empresa_nome,
         p.id_vaga, v.cargo, p.origem,
         to_char(p.data_recebimento, 'YYYY-MM-DD') AS data_recebimento,
         to_char(p.data_encaminhamento, 'YYYY-MM-DD') AS data_encaminhamento,
         p.etapa, p.id_contratacao,
         to_char(p.criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS criado_em
  FROM dna_work.processo_seletivo p
  LEFT JOIN dna_work.candidato c ON c.id_candidato = p.id_candidato
  LEFT JOIN dna_work.empresa e ON e.id_empresa = p.id_empresa
  LEFT JOIN dna_work.vaga v ON v.id_vaga = p.id_vaga
`;

export class ProcessoRepository {
  async insert(db: Db, input: {
    idCandidato: string;
    idEmpresa: string;
    idVaga: string;
    origem: Origem;
    dataRecebimento: string;
    dataEncaminhamento: string | null;
    etapa: Etapa;
    observacao: string | null;
  }): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO dna_work.processo_seletivo
        (id, id_candidato, id_empresa, id_vaga, origem, data_recebimento, data_encaminhamento, etapa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, input.idCandidato, input.idEmpresa, input.idVaga, input.origem, input.dataRecebimento, input.dataEncaminhamento, input.etapa],
    );
    await this.movimento(db, id, input.etapa, input.observacao);
    return id;
  }

  async movimento(db: Db, idProcesso: string, etapa: Etapa, observacao: string | null): Promise<void> {
    await db.query(
      "INSERT INTO dna_work.processo_movimento (id, id_processo, etapa, observacao) VALUES ($1, $2, $3, $4)",
      [randomUUID(), idProcesso, etapa, observacao],
    );
  }

  async findById(db: Db, id: string): Promise<ProcessoRow | null> {
    return one<ProcessoRow>(db, `${SELECT} WHERE p.id = $1`, [id]);
  }

  async historico(db: Db, id: string): Promise<MovimentoRow[]> {
    return many<MovimentoRow>(db, `
      SELECT id, etapa, observacao,
             to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS criado_em
      FROM dna_work.processo_movimento
      WHERE id_processo = $1
      ORDER BY criado_em
    `, [id]);
  }

  async list(db: Db, query: ProcessoListQuery): Promise<{ rows: ProcessoRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.origem) add("p.origem = $#", query.origem);
    if (query.etapa) add("p.etapa = $#", query.etapa);
    if (query.id_empresa) add("p.id_empresa = $#", query.id_empresa);
    if (query.id_vaga) add("p.id_vaga = $#", query.id_vaga);
    if (query.id_candidato) add("p.id_candidato = $#", query.id_candidato);
    if (query.nome) add("c.nome ILIKE $#", `%${query.nome}%`);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = await one<{ total: number }>(db, `SELECT count(*)::int AS total ${SELECT.slice(SELECT.indexOf("FROM"))} ${clause}`, params);
    params.push(query.pageSize, (query.page - 1) * query.pageSize);
    const rows = await many<ProcessoRow>(
      db,
      `${SELECT} ${clause} ORDER BY p.criado_em DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows, total: total?.total ?? 0 };
  }

  async mover(db: Db, id: string, etapa: Etapa, dataEncaminhamento: string | null): Promise<void> {
    await db.query(
      `UPDATE dna_work.processo_seletivo
       SET etapa = $2, data_encaminhamento = COALESCE(data_encaminhamento, $3::date)
       WHERE id = $1`,
      [id, etapa, dataEncaminhamento],
    );
  }

  async aberto(db: Db, idCandidato: string, idVaga: string): Promise<{ id: string; etapa: Etapa } | null> {
    return one(db, `
      SELECT id, etapa
      FROM dna_work.processo_seletivo
      WHERE id_candidato = $1 AND id_vaga = $2
        AND etapa NOT IN ('contratado', 'reprovado', 'desistente')
      ORDER BY criado_em DESC
      LIMIT 1
    `, [idCandidato, idVaga]);
  }

  async vincular(db: Db, id: string, idContratacao: number): Promise<void> {
    await db.query(
      "UPDATE dna_work.processo_seletivo SET etapa = 'contratado', id_contratacao = $2 WHERE id = $1",
      [id, idContratacao],
    );
    await this.movimento(db, id, "contratado", "Contratação vinculada.");
  }
}
