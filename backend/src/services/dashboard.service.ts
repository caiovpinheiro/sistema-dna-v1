import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { DATA_LEGADO, VAGA_ABERTA, intervaloDe } from "../lib/dashboard-periodo.js";
import { taxaConversao } from "../lib/processo.js";
import { ContratacaoRepository } from "../repositories/contratacao.repository.js";
import { one } from "../repositories/sql.js";
import { presentContratacao } from "./presenters.js";

type Contagem = { atual: number; anterior: number };
type Filtro = { dias?: number; de?: string; ate?: string };

const CONTRATACAO = DATA_LEGADO("cv.data_contratacao");
const CADASTRO_CANDIDATO = "c.data_adicao::date";
const CADASTRO_VAGA = `COALESCE(${DATA_LEGADO("v.dataabertura")}, v.data_adicao::date)`;
const ENCAMINHAMENTO = DATA_LEGADO("e.data");

/** Telefone no formato de public.tracker_* (55 + DDD + número), igual a origem/phone.ts normalizePhone; inválido vira NULL. */
const TELEFONE = (coluna: string) => {
  const digitos = `regexp_replace(regexp_replace(coalesce(${coluna}, ''), '\\D', '', 'g'), '^0', '')`;
  return `CASE WHEN length(${digitos}) IN (10, 11) THEN '55' || ${digitos}
               WHEN length(${digitos}) IN (12, 13) AND ${digitos} LIKE '55%' THEN ${digitos} END`;
};

export type OrigemDasContratacoes = {
  dnawork: number;
  empresa: number;
  nao_identificado: number;
  por_criterio: { processo_da_contratacao: number; processo_do_candidato: number; atendimento: number; campanha: number };
};

/**
 * Origem de cada contratação do período, nesta ordem:
 * 1. processo seletivo ligado à contratação (id_contratacao);
 * 2. o processo seletivo mais recente do mesmo candidato, em qualquer vaga (contratação feita fora do processo,
 *    em outra vaga/unidade, ou vinda do sistema antigo);
 * 3. atendimento do candidato marcado "captado_por: dnawork" (candidato que entrou pelo CRM da DNA);
 * 4. telefone do candidato em public.tracker_leads ou public.tracker_ganhos (campanhas e CRM da DNA).
 * Os casos 3 e 4 contam como "Captado pela DNAWORK". Sem nenhum deles, "Não identificado".
 * candidato.id_empresa não serve: a contratação grava nele a empresa contratante.
 */
export async function contratacoesPorOrigem(
  db: Pool | PoolClient,
  inicio: string,
  fim: string,
  esquemas: { dnaWork: string; publico: string } = { dnaWork: "dna_work", publico: "public" },
): Promise<OrigemDasContratacoes> {
  const d = esquemas.dnaWork;
  const p = esquemas.publico;
  const { rows } = await db.query<OrigemDasContratacoes["por_criterio"] & { dnawork: number; empresa: number; nao_identificado: number }>(`
    WITH contratos AS (
      SELECT cv.id_contratacao, cv.id_candidato::text AS id_candidato, c.atendimento->>'captado_por' AS captado,
             ${TELEFONE("c.celular")} AS tel1, ${TELEFONE("c.telefonefixo")} AS tel2
      FROM ${d}.conratacaovaga cv
      LEFT JOIN ${d}.candidato c ON c.id_candidato::text = cv.id_candidato::text
      WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date
    ), classe AS (
      SELECT k.*,
        (SELECT ps.origem FROM ${d}.processo_seletivo ps
          WHERE ps.id_contratacao = k.id_contratacao AND ps.origem IN ('dnawork', 'empresa')
          ORDER BY ps.criado_em DESC LIMIT 1) AS pela_contratacao,
        (SELECT ps.origem FROM ${d}.processo_seletivo ps
          WHERE ps.id_candidato::text = k.id_candidato AND ps.origem IN ('dnawork', 'empresa')
          ORDER BY ps.criado_em DESC LIMIT 1) AS pelo_candidato,
        (EXISTS (SELECT 1 FROM ${p}.tracker_leads t WHERE t.telefone_normalizado IN (k.tel1, k.tel2))
          OR EXISTS (SELECT 1 FROM ${p}.tracker_ganhos t WHERE t.telefone_normalizado IN (k.tel1, k.tel2))) AS campanha
      FROM contratos k
    ), final AS (
      SELECT *,
        CASE WHEN pela_contratacao IS NOT NULL THEN 'processo_da_contratacao'
             WHEN pelo_candidato IS NOT NULL THEN 'processo_do_candidato'
             WHEN captado = 'dnawork' THEN 'atendimento'
             WHEN campanha THEN 'campanha' END AS criterio,
        COALESCE(pela_contratacao, pelo_candidato, CASE WHEN captado = 'dnawork' OR campanha THEN 'dnawork' END) AS origem
      FROM classe
    )
    SELECT
      count(*) FILTER (WHERE origem = 'dnawork')::int AS dnawork,
      count(*) FILTER (WHERE origem = 'empresa')::int AS empresa,
      count(*) FILTER (WHERE origem IS NULL)::int AS nao_identificado,
      count(*) FILTER (WHERE criterio = 'processo_da_contratacao')::int AS processo_da_contratacao,
      count(*) FILTER (WHERE criterio = 'processo_do_candidato')::int AS processo_do_candidato,
      count(*) FILTER (WHERE criterio = 'atendimento')::int AS atendimento,
      count(*) FILTER (WHERE criterio = 'campanha')::int AS campanha
    FROM final
  `, [inicio, fim]);
  const r = rows[0] ?? { dnawork: 0, empresa: 0, nao_identificado: 0, processo_da_contratacao: 0, processo_do_candidato: 0, atendimento: 0, campanha: 0 };
  return {
    dnawork: r.dnawork,
    empresa: r.empresa,
    nao_identificado: r.nao_identificado,
    por_criterio: { processo_da_contratacao: r.processo_da_contratacao, processo_do_candidato: r.processo_do_candidato, atendimento: r.atendimento, campanha: r.campanha },
  };
}

export class DashboardService {
  constructor(
    private readonly db: Pool,
    private readonly contratacoes: ContratacaoRepository,
    private readonly config: AppConfig,
  ) {}

  async get(filtro: Filtro = {}) {
    let periodo;
    try {
      periodo = intervaloDe(filtro);
    } catch {
      throw new AppError(422, "INTERVALO_INVALIDO", "Informe 1 a 366 dias ou um intervalo de datas válido.");
    }
    const ativo = this.config.CONTRATACAO_STATUS_ATIVO;
    const [base, fluxo, anterior, serie, regimes, ranking, recentes, posicoes, origemAtual, origemAnterior, serieOrigem, porOrigem] = await Promise.all([
      this.base(ativo),
      this.fluxo(periodo.inicio, periodo.fim),
      this.fluxo(periodo.anteriorInicio, periodo.anteriorFim),
      this.serie(periodo.inicio, periodo.fim),
      this.regimes(periodo.inicio, periodo.fim),
      this.ranking(periodo.inicio, periodo.fim),
      this.contratacoes.recent(this.db, 8),
      this.posicoes(ativo),
      this.origem(periodo.inicio, periodo.fim),
      this.origem(periodo.anteriorInicio, periodo.anteriorFim),
      this.serieOrigem(periodo.inicio, periodo.fim),
      contratacoesPorOrigem(this.db, periodo.inicio, periodo.fim),
    ]);
    const semCapacidade = posicoes.abertas - posicoes.com_capacidade;
    return {
      periodo,
      candidatos_base: base.candidatos,
      candidatos_sem_data: base.sem_data,
      empresas_base: base.empresas,
      vagas_abertas_agora: base.abertas,
      contratacoes_ativas_agora: base.ativas,
      posicoes: {
        disponivel: posicoes.com_capacidade > 0,
        total: posicoes.com_capacidade > 0 ? posicoes.disponiveis : null,
        com_capacidade: posicoes.com_capacidade,
        sem_capacidade: semCapacidade,
        motivo: posicoes.com_capacidade > 0
          ? null
          : "Nenhuma vaga aberta tem a quantidade de posições preenchida. Defina a capacidade na vaga para calcular as posições livres.",
      },
      origem: {
        encaminhados_dnawork: par(origemAtual.encaminhados, origemAnterior.encaminhados),
        recebidos_empresa: par(origemAtual.recebidos, origemAnterior.recebidos),
        entrevistas: par(origemAtual.entrevistas, origemAnterior.entrevistas),
        // Gráfico: origem achada pelo processo, pelo atendimento ou pelas campanhas (contratacoesPorOrigem).
        contratacoes: [
          { origem: "dnawork", total: porOrigem.dnawork },
          { origem: "empresa", total: porOrigem.empresa },
          { origem: "nao_identificado", total: porOrigem.nao_identificado },
        ],
        contratacoes_criterio: porOrigem.por_criterio,
        // Conversão continua só com contratações ligadas ao processo (id_contratacao): é contratados ÷ entradas do processo.
        conversao_dnawork: taxaConversao(origemAtual.contratados_dnawork, origemAtual.encaminhados),
        conversao_empresa: taxaConversao(origemAtual.contratados_empresa, origemAtual.recebidos),
      },
      cadastrados: par(fluxo.cadastrados, anterior.cadastrados),
      vagas_cadastradas: par(fluxo.vagas, anterior.vagas),
      vagas_abertas_periodo: par(fluxo.abertas, anterior.abertas),
      contratacoes: par(fluxo.contratacoes, anterior.contratacoes),
      encaminhamentos: par(fluxo.encaminhamentos, anterior.encaminhamentos),
      empresas_movimento: par(fluxo.empresas, anterior.empresas),
      regimes,
      serie,
      ranking,
      serie_origem: serieOrigem,
      ultimas_contratacoes: recentes.map((row) => presentContratacao(
        row,
        this.config.CONTRATACAO_STATUS_ATIVO,
        this.config.CONTRATACAO_STATUS_ENCERRADO,
      )),
    };
  }

  private async base(ativo: number) {
    const row = await one<{ candidatos: number; sem_data: number; empresas: number; abertas: number; ativas: number }>(this.db, `
      SELECT
        (SELECT count(*)::int FROM dna_work.candidato) AS candidatos,
        (SELECT count(*)::int FROM dna_work.candidato c WHERE ${CADASTRO_CANDIDATO} IS NULL) AS sem_data,
        (SELECT count(*)::int FROM dna_work.empresa) AS empresas,
        (SELECT count(*)::int FROM dna_work.vaga WHERE status = ${VAGA_ABERTA}) AS abertas,
        (SELECT count(*)::int FROM dna_work.conratacaovaga WHERE status = $1) AS ativas
    `, [ativo]);
    return row ?? { candidatos: 0, sem_data: 0, empresas: 0, abertas: 0, ativas: 0 };
  }

  private async fluxo(inicio: string, fim: string) {
    const row = await one<{ cadastrados: number; vagas: number; abertas: number; contratacoes: number; encaminhamentos: number; empresas: number }>(this.db, `
      SELECT
        (SELECT count(*)::int FROM dna_work.candidato c WHERE ${CADASTRO_CANDIDATO} >= $1::date AND ${CADASTRO_CANDIDATO} < $2::date) AS cadastrados,
        (SELECT count(*)::int FROM dna_work.vaga v WHERE ${CADASTRO_VAGA} >= $1::date AND ${CADASTRO_VAGA} < $2::date) AS vagas,
        (SELECT count(*)::int FROM dna_work.vaga v WHERE v.status = ${VAGA_ABERTA} AND ${CADASTRO_VAGA} >= $1::date AND ${CADASTRO_VAGA} < $2::date) AS abertas,
        (SELECT count(*)::int FROM dna_work.conratacaovaga cv WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date) AS contratacoes,
        (SELECT count(*)::int FROM dna_work.emcaminhamento e WHERE ${ENCAMINHAMENTO} >= $1::date AND ${ENCAMINHAMENTO} < $2::date) AS encaminhamentos,
        (SELECT count(*)::int FROM (
          SELECT v.id_empresa FROM dna_work.vaga v WHERE ${CADASTRO_VAGA} >= $1::date AND ${CADASTRO_VAGA} < $2::date
          UNION
          SELECT cv.id_empresa FROM dna_work.conratacaovaga cv WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date
          UNION
          SELECT v.id_empresa FROM dna_work.emcaminhamento e JOIN dna_work.vaga v ON v.id_vaga = e.id_vaga WHERE ${ENCAMINHAMENTO} >= $1::date AND ${ENCAMINHAMENTO} < $2::date
        ) empresas) AS empresas
    `, [inicio, fim]);
    return row ?? { cadastrados: 0, vagas: 0, abertas: 0, contratacoes: 0, encaminhamentos: 0, empresas: 0 };
  }

  private async serie(inicio: string, fim: string) {
    const rows = await this.db.query<{ dia: string; vagas: number; contratacoes: number }>(`
      WITH dias AS (
        SELECT generate_series($1::date, $2::date - 1, interval '1 day')::date AS dia
      )
      SELECT to_char(d.dia, 'DD/MM') AS dia,
             (SELECT count(*)::int FROM dna_work.vaga v WHERE ${CADASTRO_VAGA} = d.dia) AS vagas,
             (SELECT count(*)::int FROM dna_work.conratacaovaga cv WHERE ${CONTRATACAO} = d.dia) AS contratacoes
      FROM dias d
      ORDER BY d.dia
    `, [inicio, fim]);
    return rows.rows;
  }

  private async regimes(inicio: string, fim: string) {
    const rows = await this.db.query<{ regime: string; total: number }>(`
      SELECT coalesce(m.descricao, 'Não identificado') AS regime, count(*)::int AS total
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date
      GROUP BY 1
      ORDER BY 2 DESC
    `, [inicio, fim]);
    return rows.rows;
  }

  private async ranking(inicio: string, fim: string) {
    const rows = await this.db.query<{ empresa: string; total: number }>(`
      SELECT coalesce(e.nome_fantasia, e.razao_social, 'Empresa sem nome') AS empresa, count(*)::int AS total
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date
      GROUP BY 1
      ORDER BY 2 DESC, 1
      LIMIT 8
    `, [inicio, fim]);
    return rows.rows;
  }

  private async posicoes(ativo: number) {
    const row = await one<{ abertas: number; com_capacidade: number; disponiveis: number }>(this.db, `
      SELECT
        (SELECT count(*)::int FROM dna_work.vaga WHERE status = ${VAGA_ABERTA}) AS abertas,
        (SELECT count(*)::int FROM dna_work.vaga WHERE status = ${VAGA_ABERTA} AND quantidade_posicoes IS NOT NULL) AS com_capacidade,
        (SELECT COALESCE(SUM(GREATEST(v.quantidade_posicoes - COALESCE(o.ocupadas, 0), 0)), 0)::int
         FROM dna_work.vaga v
         LEFT JOIN (
           SELECT id_vaga, count(*)::int AS ocupadas
           FROM dna_work.conratacaovaga
           WHERE status = $1
           GROUP BY id_vaga
         ) o ON o.id_vaga = v.id_vaga
         WHERE v.status = ${VAGA_ABERTA} AND v.quantidade_posicoes IS NOT NULL) AS disponiveis
    `, [ativo]);
    return row ?? { abertas: 0, com_capacidade: 0, disponiveis: 0 };
  }

  private async origem(inicio: string, fim: string) {
    const row = await one<{
      encaminhados: number; recebidos: number; entrevistas: number;
      contratados_dnawork: number; contratados_empresa: number; contratados_sem_origem: number;
    }>(this.db, `
      SELECT
        (SELECT count(*)::int FROM dna_work.processo_seletivo
          WHERE origem = 'dnawork' AND data_encaminhamento >= $1::date AND data_encaminhamento < $2::date) AS encaminhados,
        (SELECT count(*)::int FROM dna_work.processo_seletivo
          WHERE origem = 'empresa' AND data_recebimento >= $1::date AND data_recebimento < $2::date) AS recebidos,
        (SELECT count(*)::int FROM dna_work.processo_movimento
          WHERE etapa = 'entrevista_realizada'
            AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date >= $1::date
            AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date < $2::date) AS entrevistas,
        (SELECT count(*)::int FROM dna_work.conratacaovaga cv
          JOIN dna_work.processo_seletivo p ON p.id_contratacao = cv.id_contratacao
          WHERE p.origem = 'dnawork' AND ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date) AS contratados_dnawork,
        (SELECT count(*)::int FROM dna_work.conratacaovaga cv
          JOIN dna_work.processo_seletivo p ON p.id_contratacao = cv.id_contratacao
          WHERE p.origem = 'empresa' AND ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date) AS contratados_empresa,
        (SELECT count(*)::int FROM dna_work.conratacaovaga cv
          LEFT JOIN dna_work.processo_seletivo p ON p.id_contratacao = cv.id_contratacao
          WHERE p.id IS NULL AND ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} < $2::date) AS contratados_sem_origem
    `, [inicio, fim]);
    return row ?? { encaminhados: 0, recebidos: 0, entrevistas: 0, contratados_dnawork: 0, contratados_empresa: 0, contratados_sem_origem: 0 };
  }

  private async serieOrigem(inicio: string, fim: string) {
    const rows = await this.db.query<{ dia: string; dnawork: number; empresa: number; entrevistas: number }>(`
      WITH dias AS (
        SELECT generate_series($1::date, $2::date - 1, interval '1 day')::date AS dia
      )
      SELECT to_char(d.dia, 'DD/MM') AS dia,
             (SELECT count(*)::int FROM dna_work.processo_seletivo p WHERE p.origem = 'dnawork' AND p.data_encaminhamento = d.dia) AS dnawork,
             (SELECT count(*)::int FROM dna_work.processo_seletivo p WHERE p.origem = 'empresa' AND p.data_recebimento = d.dia) AS empresa,
             (SELECT count(*)::int FROM dna_work.processo_movimento m
               WHERE m.etapa = 'entrevista_realizada' AND (m.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = d.dia) AS entrevistas
      FROM dias d
      ORDER BY d.dia
    `, [inicio, fim]);
    return rows.rows;
  }
}

function par(atual: number, anterior: number): Contagem {
  return { atual, anterior };
}
