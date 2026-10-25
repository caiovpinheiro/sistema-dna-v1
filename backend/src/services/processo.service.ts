import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { etapaInicial, podeMover } from "../lib/processo.js";
import { CandidatoRepository } from "../repositories/candidato.repository.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import { ProcessoRepository } from "../repositories/processo.repository.js";
import type { Db } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { ProcessoCreate, ProcessoListQuery, ProcessoMover } from "../schemas/processo.js";

function hojeSp() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export class ProcessoService {
  constructor(
    private readonly db: Pool,
    private readonly repo: ProcessoRepository,
    private readonly vagas: VagaRepository,
    private readonly candidatos: CandidatoRepository,
    private readonly empresas: EmpresaRepository,
  ) {}

  async list(query: ProcessoListQuery) {
    const result = await this.repo.list(this.db, query);
    return { data: result.rows, meta: { page: query.page, pageSize: query.pageSize, total: result.total } };
  }

  async get(id: string) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
    const historico = await this.repo.historico(this.db, id);
    return { ...row, historico };
  }

  async create(input: ProcessoCreate) {
    const vaga = await this.vagas.findById(this.db, input.id_vaga);
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    if (vaga.id_empresa !== input.id_empresa) {
      throw new AppError(409, "EMPRESA_DIVERGENTE", "A vaga não pertence à empresa informada.");
    }
    const empresa = await this.empresas.findById(this.db, input.id_empresa);
    if (!empresa) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const candidato = await this.candidatos.findById(this.db, input.id_candidato);
    if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    const etapa = etapaInicial(input.origem, input.data_encaminhamento ?? null);
    try {
      const id = await this.repo.insert(this.db, {
        idCandidato: input.id_candidato,
        idEmpresa: input.id_empresa,
        idVaga: input.id_vaga,
        origem: input.origem,
        dataRecebimento: input.data_recebimento,
        dataEncaminhamento: input.data_encaminhamento ?? null,
        etapa,
        observacao: input.observacao ?? null,
      });
      return this.get(id);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(409, "PROCESSO_ABERTO", "Este candidato já tem um processo em andamento nesta vaga.");
      }
      throw error;
    }
  }

  async mover(id: string, input: ProcessoMover) {
    const atual = await this.repo.findById(this.db, id);
    if (!atual) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
    if (input.etapa === "contratado") {
      throw new AppError(409, "ETAPA_PELA_CONTRATACAO", "A etapa contratado é registrada pela contratação do candidato.");
    }
    if (!podeMover(atual.etapa, input.etapa)) {
      throw new AppError(409, "ETAPA_INVALIDA", "Esta etapa não pode ser aplicada ao processo atual.");
    }
    const encaminhamento = input.etapa === "encaminhado" && !atual.data_encaminhamento ? hojeSp() : null;
    await this.repo.mover(this.db, id, input.etapa, encaminhamento);
    await this.repo.movimento(this.db, id, input.etapa, input.observacao ?? null);
    return this.get(id);
  }

  async vincularContratacao(db: Db, input: { idProcesso?: string; idCandidato: string; idVaga: string; idContratacao: number }) {
    if (input.idProcesso) {
      const processo = await this.repo.findById(db, input.idProcesso);
      if (!processo) throw new AppError(404, "PROCESSO_NAO_ENCONTRADO", "Processo não encontrado.");
      if (processo.id_candidato !== input.idCandidato || processo.id_vaga !== input.idVaga) {
        throw new AppError(409, "PROCESSO_DIVERGENTE", "O processo não é deste candidato nesta vaga.");
      }
      if (processo.etapa === "contratado" && processo.id_contratacao === input.idContratacao) return;
      if (processo.etapa === "contratado" || processo.etapa === "reprovado" || processo.etapa === "desistente") {
        throw new AppError(409, "PROCESSO_ENCERRADO", "O processo selecionado já foi encerrado.");
      }
      await this.repo.vincular(db, processo.id, input.idContratacao);
      return;
    }
    const aberto = await this.repo.aberto(db, input.idCandidato, input.idVaga);
    if (aberto) await this.repo.vincular(db, aberto.id, input.idContratacao);
  }
}
