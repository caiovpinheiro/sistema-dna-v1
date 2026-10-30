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
  atendimento: Record<string, string> | null;
  empresa_nome?: string | null;
};

const COLUMNS = `
  c.id_candidato, c.nome, c.cpf, c.rg, c.rg_expedidor, c.datanascimento, c.datacadastro,
  c.ultimaalteracao, c.telefonefixo, c.celular, c.email, c.logradouro, c.numero, c.complemento,
  c.bairro, c.cidade, c.estado, c.cep, c.escola, c.nome_escola, c.modalidadecurso, c.curso,
  c.periodo, c.semestre, c.ctps, c.sexo, c.estadocivil, c.obs, c.id_empresa, c.colaborador,
  c.contador, c.banco, c.agencia, c.numero_conta, c.nome_conta, c.tipo_chave_pix, c.chave_pix, c.pcd,
  c.atendimento
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
    return one<CandidatoRow>(db, `
      SELECT ${COLUMNS}, coalesce(emp.nome_fantasia, emp.razao_social) AS empresa_nome
      FROM dna_work.candidato c
      LEFT JOIN dna_work.empresa emp ON emp.id_empresa = c.id_empresa
      WHERE c.id_candidato = $1
    `, [id]);
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
        colaborador, banco, agencia, numero_conta, nome_conta, tipo_chave_pix, chave_pix, pcd, id_empresa
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$7,
        $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
        $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
        0,$28,$29,$30,$31,$32,$33,$34,$35
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
      input.id_empresa ?? null,
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
    if (query.vinculo === "dna") where.push("nullif(btrim(c.id_empresa), '') IS NULL");
    if (query.vinculo === "empresa") where.push("nullif(btrim(c.id_empresa), '') IS NOT NULL");
    if (query.cadastro_de) add("c.datacadastro >= $#", isoToLegacy(query.cadastro_de));
    if (query.cadastro_ate) add("c.datacadastro <= $#", isoToLegacy(query.cadastro_ate));

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = sortClause(query.sort, query.order, SORTS, "c.nome");
    const totalRow = await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM dna_work.candidato c ${clause}`, params);
    const rows = await many<CandidatoRow>(db, `
      SELECT ${COLUMNS}, coalesce(emp.nome_fantasia, emp.razao_social) AS empresa_nome
      FROM dna_work.candidato c
      LEFT JOIN dna_work.empresa emp ON emp.id_empresa = c.id_empresa
      ${clause}
      ORDER BY ${order} NULLS LAST, c.id_candidato
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }

  async curriculo(db: Db, row: CandidatoRow) {
    const tem = await colunas(db, ["candidato", "instituicao", "instituicao_convenio", "flex", "exp_proficional", "con_candidato", "conhecimentos", "resultado_disc", "emcaminhamento", "vaga", "empresa"]);
    const extra = await this.campoExtra(db, row.id_candidato, tem);
    const instituicao = await this.instituicao(db, row.escola, tem);
    const experiencias = tem("exp_proficional", "id_canditado")
      ? await many<{ cargo: string | null; empresa: string | null; atribuicoes: string | null }>(db, `SELECT cargo, empresa, atribuicoes FROM dna_work.exp_proficional WHERE id_canditado = $1`, [row.id_candidato])
      : [];
    const conhecimentos = tem("con_candidato", "id_candidato") && tem("con_candidato", "id_conhecimento") && tem("conhecimentos", "descricao") && tem("conhecimentos", "id")
      ? await many<{ descricao: string | null; nivel: string | null }>(db, `
          SELECT k.descricao, ${tem("con_candidato", "nivel") ? "cc.nivel::text" : "NULL::text"} AS nivel
          FROM dna_work.con_candidato cc
          LEFT JOIN dna_work.conhecimentos k ON k.id::text = cc.id_conhecimento::text
          WHERE cc.id_candidato = $1
        `, [row.id_candidato])
      : [];
    const disc = tem("resultado_disc", "categoria")
      ? (await one<{ categoria: string | null }>(db, `SELECT categoria FROM dna_work.resultado_disc WHERE id_candidato = $1 ${tem("resultado_disc", "id") ? "ORDER BY id DESC" : ""} LIMIT 1`, [row.id_candidato]))?.categoria ?? null
      : null;
    const entrevistas = tem("emcaminhamento", "id_candidato")
      ? (await one<{ total: number }>(db, `SELECT count(*)::int AS total FROM dna_work.emcaminhamento WHERE id_candidato = $1`, [row.id_candidato]))?.total ?? 0
      : 0;
    const vagas = await this.vagasSugeridas(db, row, tem);
    return {
      objetivo: extra.objetivo ?? null,
      ultimo_cargo: experiencias.find((item) => item.cargo)?.cargo ?? null,
      ano_escolar: extra.ano_escolar ?? null,
      terminoestudo: extra.terminoestudo ?? null,
      origem: extra.indicacao || extra.fonte_busca || null,
      escolaridade: extra.escolaridade ?? null,
      instituicao,
      experiencias,
      conhecimentos,
      disc,
      entrevistas,
      vagas,
    };
  }

  private async campoExtra(db: Db, id: string, tem: TemColuna) {
    const campos = ["objetivo", "ano_escolar", "terminoestudo", "indicacao", "fonte_busca"].filter((coluna) => tem("candidato", coluna));
    const escolaridade = tem("flex", "valor") && tem("candidato", "modalidadecurso")
      ? `(SELECT f.valor FROM dna_work.flex f WHERE f.id_flex::text = c.modalidadecurso ${tem("flex", "tipo") ? "AND f.tipo::text = '2'" : ""} LIMIT 1) AS escolaridade`
      : "NULL::text AS escolaridade";
    return await one<{ objetivo: string | null; ano_escolar: string | null; terminoestudo: string | null; indicacao: string | null; fonte_busca: string | null; escolaridade: string | null }>(db, `
      SELECT ${campos.length ? campos.map((coluna) => `c.${coluna}::text AS ${coluna}`).join(", ") + "," : ""} ${escolaridade}
      FROM dna_work.candidato c WHERE c.id_candidato = $1
    `, [id]) ?? { objetivo: null, ano_escolar: null, terminoestudo: null, indicacao: null, fonte_busca: null, escolaridade: null };
  }

  private async instituicao(db: Db, escola: string | null, tem: TemColuna) {
    if (!escola || !tem("instituicao", "id_instiduicao")) return null;
    const convenio = tem("instituicao_convenio", "id_intituicao")
      ? `(SELECT c.convenio::text FROM dna_work.instituicao_convenio c WHERE c.id_intituicao = i.id_instiduicao ORDER BY c.id_convenio DESC LIMIT 1) AS conveniada`
      : "NULL::text AS conveniada";
    return one<{ razao_social: string | null; nome_fantasia: string | null; parece: string | null; conveniada: string | null }>(db, `
      SELECT i.razao_social, i.nome_fantasia, ${tem("instituicao", "parece") ? "i.parece::text" : "NULL::text"} AS parece, ${convenio}
      FROM dna_work.instituicao i WHERE i.id_instiduicao = $1
    `, [escola]);
  }

  private async vagasSugeridas(db: Db, row: CandidatoRow, tem: TemColuna) {
    if (!tem("vaga", "cargo")) return [];
    const filtros = ["COALESCE(v.status, 0) = 0"];
    const params: unknown[] = [];
    if (row.cidade?.trim()) {
      params.push(row.cidade.trim());
      filtros.push(`e.cidade ILIKE $${params.length}`);
    }
    if (row.modalidadecurso && tem("vaga", "escolaridade")) {
      params.push(row.modalidadecurso);
      filtros.push(`v.escolaridade::text = $${params.length}`);
    }
    return many<{ id_vaga: string; cargo: string | null; empresa: string | null }>(db, `
      SELECT v.id_vaga, v.cargo, COALESCE(e.nome_fantasia, e.razao_social) AS empresa
      FROM dna_work.vaga v
      LEFT JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
      WHERE ${filtros.join(" AND ")}
      ORDER BY v.dataabertura DESC NULLS LAST
      LIMIT 8
    `, params);
  }
}

type TemColuna = (tabela: string, coluna: string) => boolean;

async function colunas(db: Db, tabelas: string[]) {
  const rows = await many<{ table_name: string; column_name: string }>(db, `
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'dna_work' AND table_name = ANY($1::text[])
  `, [tabelas]);
  const mapa = new Map<string, Set<string>>();
  for (const item of rows) {
    const conjunto = mapa.get(item.table_name) ?? new Set<string>();
    conjunto.add(item.column_name);
    mapa.set(item.table_name, conjunto);
  }
  return (tabela: string, coluna: string) => mapa.get(tabela)?.has(coluna) ?? false;
}
