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

type ContextoVaga = {
  tipo_vaga: number | null;
  cargo: string | null;
  id_empresa: string | null;
  comparador: string | null;
  escolaridade?: string | null;
  periodo?: string | null;
  km?: string | null;
  sexo?: string | null;
  idade?: string | null;
  idadeate?: string | null;
  cidade?: string | null;
  lat?: string | null;
  lng?: string | null;
};

type SugeridoBruto = {
  id_candidato: string;
  nome: string | null;
  datanascimento: string | null;
  celular: string | null;
  email: string | null;
  curso: string | null;
  escolaridade: string | null;
  periodo: string | null;
  terminoestudo: string | null;
  cidade: string | null;
  bairro: string | null;
  km: number | string | null;
};

export type Sugerido = SugeridoBruto & { experiencias: string[]; ja_trabalhou: boolean };
export type ExEmpregado = { id_candidato: string; nome: string | null; celular: string | null; cargo: string | null; inicio: string | null; saida: string | null };

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
    const bloqueadasSql = (this.statusBloqueadas.length ? this.statusBloqueadas : [-1]).join(",");
    const blockedExpr = `COALESCE(v.status, -1) = ANY(ARRAY[${bloqueadasSql}]::int[])`;
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replaceAll("$#", `$${params.length}`));
    };
    if (query.id_empresa) add("v.id_empresa = $#", query.id_empresa);
    if (query.cargo) add("v.cargo ILIKE $#", `%${query.cargo}%`);
    if (query.tipo_vaga) add("v.tipo_vaga = $#", query.tipo_vaga);
    if (query.q) add("(v.cargo ILIKE $# OR e.nome_fantasia ILIKE $# OR e.razao_social ILIKE $#)", `%${query.q}%`);
    if (query.situacao) {
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
      ORDER BY CASE WHEN v.cargo ILIKE 'teste%' AND ${blockedExpr} THEN 1 ELSE 0 END, ${order} NULLS LAST, v.id_vaga
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { rows, total: totalRow?.total ?? 0 };
  }

  async sugeridos(db: Db, id: string) {
    const tem = await this.colunas(db, ["vaga", "candidato", "empresa", "exp_proficional", "cargos_candidato", "conratacaovaga", "flex"]);
    const vazio = { total: 0, candidatos: [] as Sugerido[], jaTrabalhou: [] as ExEmpregado[] };
    if (!tem("candidato", "id_candidato") || !tem("candidato", "nome") || !tem("vaga", "cargo")) return vazio;
    const extras = ["escolaridade", "periodo", "km", "sexo", "idade", "idadeate"].filter((coluna) => tem("vaga", coluna));
    const empresa = ["cidade", "lat", "lng"].filter((coluna) => tem("empresa", coluna));
    const contexto = await one<ContextoVaga>(db, `
      SELECT v.tipo_vaga, v.cargo, v.id_empresa, v.comparador
             ${extras.map((coluna) => `, v.${coluna}::text AS ${coluna}`).join("")}
             ${empresa.map((coluna) => `, e.${coluna}::text AS ${coluna}`).join("")}
      FROM dna_work.vaga v
      LEFT JOIN dna_work.empresa e ON e.id_empresa = v.id_empresa
      WHERE v.id_vaga = $1
    `, [id]);
    if (!contexto) return vazio;
    const candidatos = await this.buscarSugeridos(db, contexto, tem);
    const jaTrabalhou = await this.buscarQuemTrabalhou(db, contexto, tem);
    return { total: candidatos.total, candidatos: candidatos.rows, jaTrabalhou };
  }

  private async buscarSugeridos(db: Db, vaga: ContextoVaga, tem: (tabela: string, coluna: string) => boolean) {
    if (!tem("candidato", "lat") || !tem("candidato", "lng")) return { total: 0, rows: [] as Sugerido[] };
    const params: unknown[] = [];
    const add = (valor: unknown) => {
      params.push(valor);
      return `$${params.length}`;
    };
    const filtros = ["(c.colaborador IS NULL OR c.colaborador::text IN ('0', ''))"];
    if (tem("conratacaovaga", "contador") && tem("candidato", "contador")) {
      filtros.push(`NOT EXISTS (SELECT 1 FROM dna_work.conratacaovaga ativo WHERE ativo.contador = c.contador AND ativo.status::text = '1')`);
    }
    const km = Number(String(vaga.km ?? "").replace(",", "."));
    const lat = Number(vaga.lat);
    const lng = Number(vaga.lng);
    const latParam = add(Number.isFinite(lat) ? lat : 0);
    const lngParam = add(Number.isFinite(lng) ? lng : 0);
    const distancia = this.distancia(latParam, lngParam);
    if (Number.isFinite(km) && km > 0 && Number.isFinite(lat) && Number.isFinite(lng)) {
      filtros.push(`CASE WHEN c.lat ~ '^-?[0-9]+([.][0-9]+)?$' AND c.lng ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${distancia} ELSE 999999 END <= ${add(km)}`);
    } else if (vaga.cidade) {
      filtros.push(`c.cidade ILIKE ${add(vaga.cidade)}`);
    }
    if (Number(vaga.tipo_vaga) === 1) {
      if (vaga.escolaridade && tem("candidato", "modalidadecurso")) filtros.push(`c.modalidadecurso = ${add(vaga.escolaridade)}`);
      if (tem("candidato", "terminoestudo")) filtros.push(`replace(coalesce(c.terminoestudo, ''), '-', '/') > ${add(legacyToday())}`);
    } else {
      const cargo = add(`%${vaga.cargo ?? ""}%`);
      const cargos: string[] = [];
      if (tem("candidato", "objetivo")) cargos.push(`c.objetivo ILIKE ${cargo}`);
      if (tem("cargos_candidato", "cargo")) cargos.push(`EXISTS (SELECT 1 FROM dna_work.cargos_candidato cc WHERE cc.id_candidato = c.id_candidato AND cc.cargo ILIKE ${cargo})`);
      if (tem("exp_proficional", "cargo")) cargos.push(`EXISTS (SELECT 1 FROM dna_work.exp_proficional ex WHERE ex.id_canditado = c.id_candidato AND ex.cargo ILIKE ${cargo})`);
      if (cargos.length) filtros.push(`(${cargos.join(" OR ")})`);
      if (vaga.sexo && vaga.sexo !== "I" && tem("candidato", "sexo")) filtros.push(`c.sexo = ${add(vaga.sexo)}`);
      const minima = Number(vaga.idade);
      const maxima = Number(vaga.idadeate);
      if (minima > 0 && tem("candidato", "datanascimento")) filtros.push(`replace(coalesce(c.datanascimento, ''), '-', '/') <= ${add(this.dataMenosAnos(minima))}`);
      if (maxima > 0 && tem("candidato", "datanascimento")) filtros.push(`replace(coalesce(c.datanascimento, ''), '-', '/') >= ${add(this.dataMenosAnos(maxima))}`);
    }
    const podeFlex = tem("flex", "valor") && tem("candidato", "modalidadecurso");
    const escolaridade = podeFlex ? "f.valor" : tem("candidato", "curso") ? "c.curso" : "NULL";
    const joinFlex = podeFlex ? `LEFT JOIN dna_work.flex f ON f.id_flex::text = c.modalidadecurso${tem("flex", "tipo") ? " AND f.tipo::text = '2'" : ""}` : "";
    const where = filtros.join(" AND ");
    const total = await one<{ total: number }>(db, `
      SELECT count(DISTINCT c.id_candidato)::int AS total
      FROM dna_work.candidato c
      ${joinFlex}
      WHERE ${where}
    `, params);
    const distanciaLista = this.distancia("$1", "$2");
    const rows = await many<SugeridoBruto>(db, `
      SELECT c.id_candidato, c.nome, c.datanascimento, c.celular,
             ${tem("candidato", "email") ? "c.email" : "NULL::text AS email"},
             ${tem("candidato", "curso") ? "c.curso" : "NULL::text AS curso"},
             ${escolaridade} AS escolaridade,
             ${tem("candidato", "periodo") ? "c.periodo" : "NULL::text AS periodo"},
             ${tem("candidato", "terminoestudo") ? "c.terminoestudo" : "NULL::text AS terminoestudo"},
             c.cidade, c.bairro,
             CASE WHEN c.lat ~ '^-?[0-9]+([.][0-9]+)?$' AND c.lng ~ '^-?[0-9]+([.][0-9]+)?$'
                  THEN round(${distanciaLista}::numeric, 2) ELSE NULL END AS km
      FROM dna_work.candidato c
      ${joinFlex}
      WHERE ${where}
      ORDER BY km NULLS LAST, c.nome
      LIMIT 50
    `, params);
    const ids = rows.map((row) => row.id_candidato);
    const experiencias = await this.experiencias(db, ids, tem);
    const passados = await this.passados(db, ids, tem);
    return {
      total: total?.total ?? 0,
      rows: rows.map((row) => ({
        ...row,
        km: row.km == null ? null : Number(row.km),
        experiencias: experiencias.get(row.id_candidato) ?? [],
        ja_trabalhou: (experiencias.get(row.id_candidato)?.length ?? 0) > 0 || passados.has(row.id_candidato),
      })),
    };
  }

  private async buscarQuemTrabalhou(db: Db, vaga: ContextoVaga, tem: (tabela: string, coluna: string) => boolean) {
    if (!vaga.id_empresa || !tem("conratacaovaga", "id_empresa") || !tem("conratacaovaga", "id_candidato") || !tem("conratacaovaga", "datainicio") || !tem("conratacaovaga", "data_demicao") || !tem("conratacaovaga", "status")) return [];
    return many<ExEmpregado>(db, `
      SELECT DISTINCT ON (c.id_candidato)
             c.id_candidato, c.nome, c.celular, vg.cargo,
             cv.datainicio AS inicio, cv.data_demicao AS saida
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.vaga vg ON vg.id_vaga = cv.id_vaga
      WHERE cv.id_empresa = $1
        AND ($2 = '' OR vg.cargo ILIKE $2)
        AND cv.status::text <> '1'
      ORDER BY c.id_candidato, cv.data_demicao DESC NULLS LAST
      LIMIT 20
    `, [vaga.id_empresa, vaga.cargo ? `%${vaga.cargo}%` : ""]);
  }

  private async experiencias(db: Db, ids: string[], tem: (tabela: string, coluna: string) => boolean) {
    const mapa = new Map<string, string[]>();
    if (!ids.length || !tem("exp_proficional", "id_canditado")) return mapa;
    const rows = await many<{ id_canditado: string; cargo: string | null; empresa: string | null }>(db, `
      SELECT id_canditado, cargo, empresa FROM dna_work.exp_proficional WHERE id_canditado = ANY($1)
    `, [ids]);
    for (const row of rows) {
      const texto = [row.cargo, row.empresa].filter(Boolean).join(" na ");
      if (!texto) continue;
      const lista = mapa.get(row.id_canditado) ?? [];
      lista.push(texto);
      mapa.set(row.id_canditado, lista);
    }
    return mapa;
  }

  private async passados(db: Db, ids: string[], tem: (tabela: string, coluna: string) => boolean) {
    if (!ids.length || !tem("conratacaovaga", "id_candidato")) return new Set<string>();
    const rows = await many<{ id_candidato: string }>(db, `
      SELECT DISTINCT id_candidato FROM dna_work.conratacaovaga
      WHERE id_candidato = ANY($1) AND status::text <> '1'
    `, [ids]);
    return new Set(rows.map((row) => row.id_candidato));
  }

  private distancia(lat: string, lng: string) {
    return `(6371 * acos(LEAST(1::float8, GREATEST(-1::float8,
      cos(radians(${lat}::float8)) * cos(radians(c.lat::float8)) * cos(radians(${lng}::float8) - radians(c.lng::float8))
      + sin(radians(${lat}::float8)) * sin(radians(c.lat::float8))
    ))))`;
  }

  private dataMenosAnos(anos: number) {
    const data = new Date();
    data.setFullYear(data.getFullYear() - anos);
    return legacyToday(data);
  }

  private async colunas(db: Db, tabelas: string[]) {
    const rows = await many<{ table_name: string; column_name: string }>(db, `
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'dna_work' AND table_name = ANY($1::text[])
    `, [tabelas]);
    const mapa = new Map<string, Set<string>>();
    for (const row of rows) {
      const conjunto = mapa.get(row.table_name) ?? new Set<string>();
      conjunto.add(row.column_name);
      mapa.set(row.table_name, conjunto);
    }
    return (tabela: string, coluna: string) => mapa.get(tabela)?.has(coluna) ?? false;
  }
}
