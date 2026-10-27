import { legacyToday } from "../lib/dates.js";
import { formatMoneyLegacy, parseMoney } from "../lib/money.js";
import type { VagaCreate, VagaListQuery, VagaPatch } from "../schemas/vaga.js";
import { many, one, sortClause, type Db } from "./sql.js";

export type VagaRow = {
  id_vaga: string;
  id_empresa: string | null;
  cargo: string | null;
  tipo_vaga: number | null;
  salario: string | null;
  status: number | null;
  comparador: string | null;
  dataabertura: string | null;
  publicar: number | null;
  carga_horaria: string | null;
  obs: string | null;
  quantidade_posicoes: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  modalidade: string | null;
  ocupadas: number;
};

function vazioEntrevista() {
  return { total: 0, confirmou: 0, negou: 0, sem_resposta: 0, recusados: 0 };
}

const SORTS: Record<string, string> = {
  cargo: "v.cargo",
  dataabertura: "v.dataabertura",
  status: "v.status",
};

export class VagaRepository {
  constructor(
    private readonly statusAtivo: number,
    private readonly statusBloqueadas: number[],
  ) {}

  private select(extraWhere = ""): string {
    return `
      SELECT v.id_vaga, v.id_empresa, v.cargo, v.tipo_vaga, v.salario, v.status, v.comparador,
             v.dataabertura, v.publicar, v.carga_horaria, v.obs, v.quantidade_posicoes,
             e.razao_social, e.nome_fantasia, m.descricao AS modalidade,
             COALESCE(o.ocupadas, 0)::int AS ocupadas
      FROM dna_work.vaga v
      LEFT JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      LEFT JOIN (
        SELECT id_vaga, count(*)::int AS ocupadas
        FROM dna_work.conratacaovaga
        WHERE status = $1
        GROUP BY id_vaga
      ) o ON o.id_vaga = v.id_vaga
      ${extraWhere}
    `;
  }

  findById(db: Db, id: string): Promise<VagaRow | null> {
    return one<VagaRow>(db, `${this.select("WHERE v.id_vaga = $2")}`, [this.statusAtivo, id]);
  }

  async ficha(db: Db, id: string, comparador: string | null) {
    const texto = await one<{
      codigo: string | null;
      km: string | null;
      atribuicaoes: string | null;
      atribu_contrato: string | null;
      requisitos_desejaveis: string | null;
      destaque: string | null;
      quantidade: number;
    }>(db, `
      SELECT v.codigo, v.km::text AS km, v.atribuicaoes, v.atribu_contrato, v.requisitos_desejaveis, v.destaque,
             CASE WHEN coalesce(v.comparador, '') = '' THEN 0
                  ELSE (SELECT count(*)::int FROM dna_work.vaga x WHERE x.comparador = v.comparador)
             END AS quantidade
      FROM dna_work.vaga v
      WHERE v.id_vaga = $1
    `, [id]);
    const comp = comparador ?? "";
    const entrevistas = comp ? await this.entrevistas(db, comp) : vazioEntrevista();
    const agente = comp && await this.tabela(db, "chamado_emtrevista")
      ? (await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM dna_work.chamado_emtrevista WHERE comparador = $1`, [comp]))?.total ?? 0
      : 0;
    const contratados = comp
      ? (await one<{ total: number }>(db, `
          SELECT count(*)::int AS total FROM dna_work.conratacaovaga WHERE comparador = $1 AND status = $2
        `, [comp, this.statusAtivo]))?.total ?? 0
      : 0;
    const inscritos = comp ? await this.inscritos(db, comp) : 0;
    return {
      codigo: texto?.codigo ?? null,
      km: texto?.km ?? null,
      atribuicaoes: texto?.atribuicaoes ?? null,
      atribu_contrato: texto?.atribu_contrato ?? null,
      requisitos_desejaveis: texto?.requisitos_desejaveis ?? null,
      destaque: texto?.destaque ?? null,
      quantidade: texto?.quantidade ?? 0,
      inscritos,
      entrevistas_agente: agente,
      contratados,
      ...entrevistas,
    };
  }

  private async tabela(db: Db, nome: string) {
    const row = await one<{ ok: string | null }>(db, "SELECT to_regclass($1) AS ok", [`dna_work.${nome}`]);
    return row?.ok != null;
  }

  private async entrevistas(db: Db, comparador: string) {
    if (!await this.tabela(db, "emcaminhamento")) return vazioEntrevista();
    const row = await one<{ total: number; confirmou: number; negou: number; sem_resposta: number; recusados: number }>(db, `
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE aceite = 'S' AND coalesce(reprovado, '') <> 'S')::int AS confirmou,
             count(*) FILTER (WHERE aceite = 'N' AND coalesce(reprovado, '') <> 'S')::int AS negou,
             count(*) FILTER (WHERE coalesce(reprovado, '') <> 'S' AND coalesce(aceite, '') = '')::int AS sem_resposta,
             count(*) FILTER (WHERE reprovado = 'S')::int AS recusados
      FROM (
        SELECT DISTINCT ON (id_candidato) aceite, reprovado
        FROM dna_work.emcaminhamento
        WHERE comparador = $1
        ORDER BY id_candidato
      ) lista
    `, [comparador]);
    return row ?? vazioEntrevista();
  }

  private async inscritos(db: Db, comparador: string) {
    const partes: string[] = [];
    if (await this.tabela(db, "selecionado_vaga")) partes.push("SELECT id_candidato::text AS id FROM dna_work.selecionado_vaga WHERE comparador = $1");
    if (await this.tabela(db, "candidatura")) partes.push("SELECT id_candidato::text AS id FROM dna_work.candidatura WHERE comparador = $1");
    if (await this.tabela(db, "candidatos_incluidos_vaga")) partes.push("SELECT id_candidato::text AS id FROM dna_work.candidatos_incluidos_vaga WHERE conparador = $1");
    if (await this.tabela(db, "emcaminhamento")) partes.push("SELECT id_candidato::text AS id FROM dna_work.emcaminhamento WHERE comparador = $1");
    if (await this.tabela(db, "chamado_emtrevista")) partes.push("SELECT id_candidato::text AS id FROM dna_work.chamado_emtrevista WHERE comparador = $1");
    if (!partes.length) return 0;
    const row = await one<{ total: number }>(db, `SELECT count(DISTINCT id)::int AS total FROM (${partes.join(" UNION ")}) pessoas`, [comparador]);
    return row?.total ?? 0;
  }

  async lockById(db: Db, id: string): Promise<VagaRow | null> {
    const locked = await one<{ id_vaga: string }>(db, `
      SELECT id_vaga FROM dna_work.vaga WHERE id_vaga = $1 FOR UPDATE
    `, [id]);
    if (!locked) return null;
    return this.findById(db, id);
  }

  async insert(db: Db, input: VagaCreate, id: string): Promise<void> {
    await db.query(`
      INSERT INTO dna_work.vaga (
        id_vaga, id_empresa, cargo, tipo_vaga, salario, status, comparador, dataabertura,
        publicar, carga_horaria, obs, quantidade_posicoes, data_adicao,
        km, atribuicaoes, atribu_contrato, requisitos_desejaveis, destaque
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), $13,$14,$15,$16,$17)
    `, [
      id,
      input.id_empresa,
      input.cargo,
      input.tipo_vaga,
      input.salario ? formatMoneyLegacy(parseMoney(input.salario)) : null,
      input.status ?? 0,
      String(Math.floor(Date.now() / 1000)),
      legacyToday(),
      input.publicar ?? 0,
      input.carga_horaria ?? null,
      input.obs ?? null,
      input.quantidade_posicoes,
      input.km ?? null,
      input.atribuicaoes ?? null,
      input.atribu_contrato ?? null,
      input.requisitos_desejaveis ?? null,
      input.destaque ?? null,
    ]);
  }

  async update(db: Db, id: string, input: VagaPatch, salario: string | undefined): Promise<void> {
    const map: Record<string, unknown> = {
      cargo: input.cargo,
      tipo_vaga: input.tipo_vaga,
      quantidade_posicoes: input.quantidade_posicoes,
      status: input.status,
      publicar: input.publicar,
      carga_horaria: input.carga_horaria,
      obs: input.obs,
      salario,
    };
    const entries = Object.entries(map).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([key], index) => `${key} = $${index + 1}`);
    const values = entries.map(([, value]) => value);
    values.push(id);
    await db.query(`UPDATE dna_work.vaga SET ${sets.join(", ")} WHERE id_vaga = $${entries.length + 1}`, values);
  }

  async setStatus(db: Db, id: string, status: number): Promise<void> {
    await db.query("UPDATE dna_work.vaga SET status = $2 WHERE id_vaga = $1", [id, status]);
  }

  async list(db: Db, query: VagaListQuery): Promise<{ rows: VagaRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [this.statusAtivo];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.id_empresa) add("v.id_empresa = $#", query.id_empresa);
    if (query.cargo) add("v.cargo ILIKE $#", `%${query.cargo}%`);
    if (query.tipo_vaga) add("v.tipo_vaga = $#", query.tipo_vaga);
    if (query.q) add("(v.cargo ILIKE $# OR e.nome_fantasia ILIKE $# OR e.razao_social ILIKE $#)", `%${query.q}%`);
    if (query.situacao) {
      params.push(this.statusBloqueadas);
      const blocked = `$${params.length}::int[]`;
      const blockedExpr = `COALESCE(v.status, -1) = ANY(${blocked})`;
      const cheia = "v.quantidade_posicoes IS NOT NULL AND COALESCE(o.ocupadas, 0) >= v.quantidade_posicoes";
      if (query.situacao === "encerrada") where.push(blockedExpr);
      if (query.situacao === "capacidade_pendente") where.push(`v.quantidade_posicoes IS NULL AND NOT (${blockedExpr})`);
      if (query.situacao === "preenchida") where.push(`${cheia} AND NOT (${blockedExpr})`);
      if (query.situacao === "aberta") {
        where.push(`v.quantidade_posicoes IS NOT NULL AND COALESCE(o.ocupadas, 0) < v.quantidade_posicoes AND NOT (${blockedExpr})`);
      }
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = sortClause(query.sort ?? "dataabertura", query.sort ? query.order : "desc", SORTS, "v.dataabertura");
    const from = `
      FROM dna_work.vaga v
      LEFT JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      LEFT JOIN (
        SELECT id_vaga, count(*)::int AS ocupadas
        FROM dna_work.conratacaovaga
        WHERE status = $1
        GROUP BY id_vaga
      ) o ON o.id_vaga = v.id_vaga
      ${clause}
    `;
    const totalRow = await one<{ total: number }>(db, `SELECT count(*)::int AS total ${from}`, params);
    const rows = await many<VagaRow>(db, `
      SELECT v.id_vaga, v.id_empresa, v.cargo, v.tipo_vaga, v.salario, v.status, v.comparador,
             v.dataabertura, v.publicar, v.carga_horaria, v.obs, v.quantidade_posicoes,
             e.razao_social, e.nome_fantasia, m.descricao AS modalidade,
             COALESCE(o.ocupadas, 0)::int AS ocupadas
      ${from}
      ORDER BY ${order}, v.id_vaga
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }
}
