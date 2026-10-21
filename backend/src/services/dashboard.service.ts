import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import { ContratacaoRepository } from "../repositories/contratacao.repository.js";
import { one } from "../repositories/sql.js";
import { presentContratacao } from "./presenters.js";

export class DashboardService {
  constructor(
    private readonly db: Pool,
    private readonly contratacoes: ContratacaoRepository,
    private readonly config: AppConfig,
    private readonly capabilities: SchemaCapabilities,
  ) {}

  async get() {
    const ativo = this.config.CONTRATACAO_STATUS_ATIVO;
    const bloqueadas = this.config.vagaStatusBloqueadas;
    const counts = await one<{
      candidatos: number;
      empresas: number;
      contratacoes_ativas: number;
    }>(this.db, `
      SELECT
        (SELECT count(*)::int FROM dna_work.candidato) AS candidatos,
        (SELECT count(*)::int FROM dna_work.empresa) AS empresas,
        (SELECT count(*)::int FROM dna_work.conratacaovaga WHERE status = $1) AS contratacoes_ativas
    `, [ativo]);
    let vagasAbertas = 0;
    let posicoesDisponiveis = 0;
    if (this.capabilities.quantidadePosicoes) {
      const capacity = await one<{ vagas_abertas: number; posicoes_disponiveis: number }>(this.db, `
        SELECT
          count(*) FILTER (
            WHERE v.quantidade_posicoes IS NOT NULL
              AND COALESCE(o.ocupadas, 0) < v.quantidade_posicoes
              AND NOT (COALESCE(v.status, -1) = ANY($2::int[]))
          )::int AS vagas_abertas,
          COALESCE(SUM(
            CASE
              WHEN v.quantidade_posicoes IS NOT NULL AND NOT (COALESCE(v.status, -1) = ANY($2::int[]))
                THEN GREATEST(v.quantidade_posicoes - COALESCE(o.ocupadas, 0), 0)
              ELSE 0
            END
          ), 0)::int AS posicoes_disponiveis
        FROM dna_work.vaga v
        LEFT JOIN (
          SELECT id_vaga, count(*)::int AS ocupadas
          FROM dna_work.conratacaovaga
          WHERE status = $1
          GROUP BY id_vaga
        ) o ON o.id_vaga = v.id_vaga
      `, [ativo, bloqueadas]);
      vagasAbertas = capacity?.vagas_abertas ?? 0;
      posicoesDisponiveis = capacity?.posicoes_disponiveis ?? 0;
    }
    const recent = await this.contratacoes.recent(this.db, 8);
    return {
      candidatos: counts?.candidatos ?? 0,
      empresas: counts?.empresas ?? 0,
      vagas_abertas: vagasAbertas,
      posicoes_disponiveis: posicoesDisponiveis,
      contratacoes_ativas: counts?.contratacoes_ativas ?? 0,
      capacidade_configurada: this.capabilities.quantidadePosicoes,
      ultimas_contratacoes: recent.map((row) => presentContratacao(
        row,
        this.config.CONTRATACAO_STATUS_ATIVO,
        this.config.CONTRATACAO_STATUS_ENCERRADO,
      )),
    };
  }
}
