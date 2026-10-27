import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { migrationRequired, AppError } from "../lib/errors.js";
import { formatMoneyLegacy, parseMoney } from "../lib/money.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import { one } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { VagaCreate, VagaListQuery, VagaPatch } from "../schemas/vaga.js";
import { presentVaga } from "./presenters.js";

export class VagaService {
  constructor(
    private readonly db: Pool,
    private readonly repo: VagaRepository,
    private readonly empresas: EmpresaRepository,
    private readonly config: AppConfig,
    private readonly capabilities: SchemaCapabilities,
  ) {}

  private ensureCapacityColumn() {
    if (!this.capabilities.quantidadePosicoes) throw migrationRequired(this.capabilities.missing);
  }

  private async assertModalidade(id: number) {
    const modalidade = await one<{ id: number }>(this.db, "SELECT id FROM dna_work.modalidade_vaga WHERE id = $1", [id]);
    if (!modalidade) throw new AppError(422, "MODALIDADE_INVALIDA", "A modalidade informada não existe.");
  }

  async create(input: VagaCreate) {
    this.ensureCapacityColumn();
    const empresa = await this.empresas.findById(this.db, input.id_empresa);
    if (!empresa) throw new AppError(422, "EMPRESA_INVALIDA", "A vaga precisa pertencer a uma empresa existente.");
    await this.assertModalidade(input.tipo_vaga);
    const id = randomUUID();
    await this.repo.insert(this.db, input, id);
    return presentVaga((await this.repo.findById(this.db, id))!, this.config.vagaStatusBloqueadas);
  }

  async update(id: string, input: VagaPatch) {
    this.ensureCapacityColumn();
    const current = await this.repo.findById(this.db, id);
    if (!current) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    if (input.tipo_vaga) await this.assertModalidade(input.tipo_vaga);
    if (input.quantidade_posicoes != null && input.quantidade_posicoes < current.ocupadas) {
      throw new AppError(409, "QUANTIDADE_INSUFICIENTE", "A quantidade não pode ficar abaixo das posições já ocupadas.", {
        ocupadas: current.ocupadas,
      });
    }
    const salario = input.salario ? formatMoneyLegacy(parseMoney(input.salario)) : undefined;
    const hasChange = Object.entries(input).some(([, value]) => value !== undefined);
    if (!hasChange) throw new AppError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo informado para atualização.");
    await this.repo.update(this.db, id, input, salario);
    return presentVaga((await this.repo.findById(this.db, id))!, this.config.vagaStatusBloqueadas);
  }

  async get(id: string) {
    this.ensureCapacityColumn();
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    const ficha = await this.repo.ficha(this.db, id, row.comparador);
    return { ...presentVaga(row, this.config.vagaStatusBloqueadas), ...ficha };
  }

  async list(query: VagaListQuery) {
    this.ensureCapacityColumn();
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map((row) => presentVaga(row, this.config.vagaStatusBloqueadas)),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }
}
