import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import type { EmpresaCreate, EmpresaListQuery, EmpresaPatch } from "../schemas/empresa.js";
import { presentEmpresa } from "./presenters.js";

const PATCHABLE = new Set([
  "razao_social", "nome_fantasia", "cnpj", "email", "telefone", "celular", "cep", "logradouro",
  "numero", "complemento", "bairro", "cidade", "uf", "status", "responsavel", "tipo_empresa",
  "matriz", "ie", "site", "obs",
]);

export class EmpresaService {
  constructor(private readonly db: Pool, private readonly repo: EmpresaRepository) {}

  private async assertMatriz(matriz: string | undefined, selfId?: string) {
    if (!matriz) return;
    if (selfId && matriz === selfId) {
      throw new AppError(422, "MATRIZ_INVALIDA", "A empresa não pode ser matriz dela mesma.");
    }
    const found = await this.repo.findById(this.db, matriz);
    if (!found) throw new AppError(422, "MATRIZ_INVALIDA", "A matriz informada não existe.");
  }

  async create(input: EmpresaCreate) {
    const duplicated = await this.repo.findByCnpj(this.db, input.cnpj);
    if (duplicated) {
      throw new AppError(409, "CNPJ_DUPLICADO", "Já existe uma empresa com este CNPJ.", {
        id_empresa: duplicated.id_empresa,
      });
    }
    await this.assertMatriz(input.matriz);
    const id = randomUUID();
    await this.repo.insert(this.db, input, id);
    return presentEmpresa((await this.repo.findById(this.db, id))!);
  }

  async update(id: string, input: EmpresaPatch) {
    const current = await this.repo.findById(this.db, id);
    if (!current) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const patch: EmpresaPatch = {};
    for (const [key, value] of Object.entries(input)) {
      if (!PATCHABLE.has(key) || value === undefined) continue;
      (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo informado para atualização.");
    }
    if (patch.cnpj) {
      const duplicated = await this.repo.findByCnpj(this.db, patch.cnpj, id);
      if (duplicated) {
        throw new AppError(409, "CNPJ_DUPLICADO", "Já existe uma empresa com este CNPJ.", {
          id_empresa: duplicated.id_empresa,
        });
      }
    }
    if (patch.matriz === id) delete patch.matriz;
    await this.assertMatriz(patch.matriz, id);
    await this.repo.update(this.db, id, patch);
    return presentEmpresa((await this.repo.findById(this.db, id))!);
  }

  async get(id: string) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    return presentEmpresa(row);
  }

  async list(query: EmpresaListQuery) {
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map(presentEmpresa),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }
}
