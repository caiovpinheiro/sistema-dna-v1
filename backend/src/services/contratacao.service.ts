import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import { AppError, migrationRequired } from "../lib/errors.js";
import { isoToLegacy, legacyToday } from "../lib/dates.js";
import { classifyRegime } from "../lib/normalize.js";
import { CandidatoRepository } from "../repositories/candidato.repository.js";
import { ContratacaoRepository } from "../repositories/contratacao.repository.js";
import { one } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { ContratacaoCreate, ContratacaoEncerrar, ContratacaoListQuery } from "../schemas/contratacao.js";
import { presentContratacao, vagaSituacao } from "./presenters.js";
import type { ProcessoService } from "./processo.service.js";

type StoredResponse = { statusCode: number; body: unknown };

export class ContratacaoService {
  constructor(
    private readonly db: Pool,
    private readonly repo: ContratacaoRepository,
    private readonly vagas: VagaRepository,
    private readonly candidatos: CandidatoRepository,
    private readonly config: AppConfig,
    private readonly capabilities: SchemaCapabilities,
    private readonly processos: ProcessoService,
  ) {}

  private ensureReady() {
    if (this.capabilities.missing.length) throw migrationRequired(this.capabilities.missing);
  }

  private present(row: NonNullable<Awaited<ReturnType<ContratacaoRepository["findById"]>>>) {
    return presentContratacao(row, this.config.CONTRATACAO_STATUS_ATIVO, this.config.CONTRATACAO_STATUS_ENCERRADO);
  }

  async list(query: ContratacaoListQuery) {
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map((row) => this.present(row)),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }

  async get(id: number) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    return this.present(row);
  }

  async listByCandidato(idCandidato: string, page: number, pageSize: number) {
    const candidato = await this.candidatos.findById(this.db, idCandidato);
    if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    return this.list({ page, pageSize, order: "desc", id_candidato: idCandidato });
  }

  async listByEmpresa(idEmpresa: string, page: number, pageSize: number) {
    return this.list({ page, pageSize, order: "desc", id_empresa: idEmpresa });
  }

  async listByVaga(idVaga: string, page: number, pageSize: number) {
    const vaga = await this.vagas.findById(this.db, idVaga);
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    return this.list({ page, pageSize, order: "desc", id_vaga: idVaga });
  }

  async create(input: ContratacaoCreate, idempotencyKey: string) {
    this.ensureReady();
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const replay = await this.claimIdempotency(client, idempotencyKey, hash);
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.id_candidato]);
      const vaga = await this.vagas.lockById(client, input.id_vaga);
      if (!vaga || !vaga.id_empresa) {
        throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
      }
      if (input.id_empresa && input.id_empresa !== vaga.id_empresa) {
        throw new AppError(409, "EMPRESA_DIVERGENTE", "A empresa informada não é a dona da vaga.", {
          id_empresa: vaga.id_empresa,
        });
      }
      const situacao = vagaSituacao(vaga, this.config.vagaStatusBloqueadas);
      if (situacao === "encerrada") {
        throw new AppError(409, "VAGA_ENCERRADA", "A vaga não está habilitada para contratação.");
      }
      if (situacao === "capacidade_pendente") {
        throw new AppError(409, "CAPACIDADE_NAO_CONFIGURADA", "Defina a quantidade de posições da vaga antes de contratar.");
      }
      const regime = classifyRegime(vaga.modalidade);
      if (regime === "outro") {
        throw new AppError(422, "MODALIDADE_NAO_SUPORTADA", "Esta versão contrata apenas vagas de CLT ou estágio.", {
          modalidade: vaga.modalidade,
        });
      }
      const candidato = await this.candidatos.findById(client, input.id_candidato);
      if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
      const duplicate = await this.repo.findActiveDuplicate(
        client, vaga.id_vaga, candidato.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO,
      );
      if (duplicate) {
        throw new AppError(409, "VINCULO_DUPLICADO", "O candidato já possui vínculo ativo nesta vaga.", {
          id_contratacao: duplicate.id_contratacao,
        });
      }
      if (!this.config.ALLOW_MULTIPLE_ACTIVE_LINKS) {
        const other = await this.repo.findOtherActive(client, candidato.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO);
        if (other) {
          throw new AppError(409, "CANDIDATO_JA_ATIVO", "O candidato já possui um vínculo ativo. A liberação de vínculos simultâneos ainda não foi confirmada.", {
            id_contratacao: other.id_contratacao,
          });
        }
      }
      if (situacao === "preenchida") {
        throw new AppError(409, "VAGA_SEM_POSICAO", "Todas as posições desta vaga já estão ocupadas.");
      }
      const ocupadas = await this.repo.countActiveByVaga(client, vaga.id_vaga, this.config.CONTRATACAO_STATUS_ATIVO);
      if (vaga.quantidade_posicoes == null || ocupadas.total >= vaga.quantidade_posicoes) {
        throw new AppError(409, "VAGA_SEM_POSICAO", "Todas as posições desta vaga já estão ocupadas.");
      }
      const idContratacao = await this.repo.insert(client, {
        idVaga: vaga.id_vaga,
        idCandidato: candidato.id_candidato,
        idEmpresa: vaga.id_empresa,
        dataContratacao: legacyToday(),
        dataInicio: isoToLegacy(input.data_inicio),
        dataFim: input.data_fim ? isoToLegacy(input.data_fim) : null,
        status: this.config.CONTRATACAO_STATUS_ATIVO,
        contador: candidato.contador,
        comparador: vaga.comparador,
      });
      const idColaborador = randomUUID();
      await this.repo.insertColaborador(client, {
        idColaborador,
        idCandidato: candidato.id_candidato,
        idEmpresa: vaga.id_empresa,
        dataInicio: isoToLegacy(input.data_inicio),
        cargo: vaga.cargo,
        tipoVaga: vaga.tipo_vaga,
        salario: vaga.salario,
        cargaHoraria: vaga.carga_horaria,
        dataCadastro: legacyToday(),
        status: this.config.COLABORADOR_STATUS_ATIVO,
        idContratacao,
      });
      await this.repo.atualizarFlagCandidato(client, candidato.id_candidato, vaga.id_empresa, true, legacyToday());
      await this.processos.vincularContratacao(client, {
        idProcesso: input.id_processo,
        idCandidato: candidato.id_candidato,
        idVaga: vaga.id_vaga,
        idContratacao,
      });
      const depois = ocupadas.total + 1;
      if (vaga.quantidade_posicoes != null && depois >= vaga.quantidade_posicoes) {
        await this.vagas.setStatus(client, vaga.id_vaga, this.config.VAGA_STATUS_OCUPADA);
      }
      const saved = await this.repo.findById(client, idContratacao);
      const body = {
        success: true,
        data: {
          ...this.present(saved!),
          id_colaborador: idColaborador,
          regime,
        },
        meta: {},
      };
      await client.query(
        "UPDATE dna_work.api_idempotencia SET status_code = 201, response = $2::jsonb WHERE chave = $1",
        [idempotencyKey, JSON.stringify(body)],
      );
      await client.query("COMMIT");
      return { statusCode: 201, body };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async documentos(id: number) {
    this.ensureReady();
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    const docs = await this.repo.listarRescisoes(this.db, id);
    return docs.map((item) => ({
      id: item.id,
      nome: item.nome,
      vaga: item.cargo,
      empresa: item.empresa,
      data: item.data_demissao,
      status: "Encerrado",
      motivo: item.motivo,
      motivo_interno: item.motivo_interno,
      avaliacao: item.avaliacao,
      resumo: item.resumo,
    }));
  }

  async encerrar(id: number, input: ContratacaoEncerrar) {
    this.ensureReady();
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await this.repo.lockById(client, id);
      if (!current) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
      if (current.status === this.config.CONTRATACAO_STATUS_ENCERRADO || current.data_demicao) {
        throw new AppError(409, "JA_ENCERRADA", "Esta contratação já está encerrada.");
      }
      if (current.status !== this.config.CONTRATACAO_STATUS_ATIVO) {
        throw new AppError(409, "STATUS_NAO_ENCERRAVEL", "Somente um vínculo ativo pode ser encerrado.");
      }
      if (current.id_vaga) await this.vagas.lockById(client, current.id_vaga);
      const data = isoToLegacy(input.data_encerramento);
      await this.repo.encerrar(client, id, this.config.CONTRATACAO_STATUS_ENCERRADO, data);
      if (input.motivo) {
        await this.repo.salvarRescisao(client, {
          idContratacao: id,
          nome: current.tipo_vaga === 1 ? "Rescisão de estágio" : "Rescisão CLT",
          motivo: input.motivo,
          motivoInterno: input.motivo_interno || null,
          avaliacao: input.avaliacao || null,
          resumo: input.resumo || null,
          dataDemissao: data,
          cargo: current.cargo,
          empresa: current.empresa_fantasia || current.empresa_razao,
        });
      }
      await this.repo.encerrarColaborador(client, id, this.config.COLABORADOR_STATUS_INATIVO);
      if (current.id_candidato) {
        const other = await this.repo.findOtherActive(client, current.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO);
        if (!other) await this.repo.atualizarFlagCandidato(client, current.id_candidato, null, false, legacyToday());
      }
      const saved = await this.repo.findById(client, id);
      await client.query("COMMIT");
      return this.present(saved!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimIdempotency(client: PoolClient, key: string, hash: string): Promise<StoredResponse | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inserted = await client.query(
        `INSERT INTO dna_work.api_idempotencia (chave, request_hash)
         VALUES ($1, $2)
         ON CONFLICT (chave) DO NOTHING
         RETURNING chave`,
        [key, hash],
      );
      if (inserted.rowCount === 1) return null;
      const current = await one<{ request_hash: string; status_code: number | null; response: unknown }>(
        client,
        "SELECT request_hash, status_code, response FROM dna_work.api_idempotencia WHERE chave = $1 FOR UPDATE",
        [key],
      );
      if (!current) continue;
      if (current.request_hash !== hash) {
        throw new AppError(409, "IDEMPOTENCIA_DIVERGENTE", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      if (current.response && current.status_code) {
        return { statusCode: current.status_code, body: current.response };
      }
      throw new AppError(409, "IDEMPOTENCIA_EM_ANDAMENTO", "Já existe uma contratação em processamento com esta chave.");
    }
    throw new AppError(409, "IDEMPOTENCIA_EM_ANDAMENTO", "Não foi possível reservar a chave de idempotência.");
  }
}
