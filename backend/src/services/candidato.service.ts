import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { CandidatoRepository } from "../repositories/candidato.repository.js";
import type { CandidatoCreate, CandidatoListQuery, CandidatoPatch } from "../schemas/candidato.js";
import { presentCandidato } from "./presenters.js";

const PATCHABLE = new Set([
  "nome", "cpf", "rg", "rg_expedidor", "datanascimento", "email", "celular", "telefonefixo",
  "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "estado", "sexo",
  "estadocivil", "obs", "escola", "nome_escola", "curso", "modalidadecurso", "semestre",
  "periodo", "ctps", "banco", "agencia", "numero_conta", "nome_conta", "tipo_chave_pix",
  "chave_pix", "pcd", "id_empresa",
]);

export class CandidatoService {
  constructor(private readonly db: Pool, private readonly repo: CandidatoRepository) {}

  async create(input: CandidatoCreate) {
    await this.garantirEmpresa(input.id_empresa);
    const duplicated = await this.repo.findByCpf(this.db, input.cpf);
    if (duplicated) {
      throw new AppError(409, "CPF_DUPLICADO", "Já existe um candidato com este CPF.", {
        id_candidato: duplicated.id_candidato,
      });
    }
    const id = randomUUID();
    await this.repo.insert(this.db, input, id);
    const created = await this.repo.findById(this.db, id);
    return presentCandidato(created!, true);
  }

  async update(id: string, input: CandidatoPatch) {
    const current = await this.repo.findById(this.db, id);
    if (!current) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    const patch: CandidatoPatch = {};
    for (const [key, value] of Object.entries(input)) {
      if (!PATCHABLE.has(key) || value === undefined) continue;
      (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo informado para atualização.");
    }
    if (patch.id_empresa) await this.garantirEmpresa(patch.id_empresa);
    if (patch.cpf) {
      const duplicated = await this.repo.findByCpf(this.db, patch.cpf, id);
      if (duplicated) {
        throw new AppError(409, "CPF_DUPLICADO", "Já existe um candidato com este CPF.", {
          id_candidato: duplicated.id_candidato,
        });
      }
    }
    await this.repo.update(this.db, id, patch);
    const updated = await this.repo.findById(this.db, id);
    return presentCandidato(updated!, true);
  }

  async get(id: string) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    return { ...presentCandidato(row, true), curriculo: await this.repo.curriculo(this.db, row) };
  }

  async list(query: CandidatoListQuery) {
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map((row) => presentCandidato(row)),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }

  private async garantirEmpresa(id: string | null | undefined) {
    if (!id) return;
    const row = await this.db.query("SELECT id_empresa FROM dna_work.empresa WHERE id_empresa = $1", [id]);
    if (!row.rowCount) throw new AppError(422, "EMPRESA_NAO_ENCONTRADA", "Selecione a empresa do candidato.");
  }
}
