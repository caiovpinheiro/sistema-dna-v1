import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { chaveCargo, nomePadronizado } from "../lib/cargo.js";
import { AppError } from "../lib/errors.js";

export type Cargo = { id: string; nome: string; chave: string; descricao: string | null; requisitos: string | null };

const CAMPOS = "id::text AS id, nome, chave, descricao, requisitos";

/** Cargos com descrição e requisitos, em public.cargo. A chave única (cargo_chave_unica) é garantida pelo Postgres. */
export class CargoService {
  constructor(
    private readonly db: Pick<Pool, "query">,
    _config?: AppConfig,
  ) {}

  async listar(): Promise<Cargo[]> {
    const { rows } = await this.db.query<Cargo>(`SELECT ${CAMPOS} FROM public.cargo ORDER BY nome`);
    return rows;
  }

  async porChave(): Promise<Map<string, Cargo>> {
    return new Map((await this.listar()).map((cargo) => [cargo.chave, cargo]));
  }

  async obter(id: string): Promise<Cargo> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(422, "CARGO_INVALIDO", "Escolha um cargo da lista.");
    }
    const { rows } = await this.db.query<Cargo>(`SELECT ${CAMPOS} FROM public.cargo WHERE id = $1`, [id]);
    if (!rows[0]) throw new AppError(422, "CARGO_INVALIDO", "Escolha um cargo da lista.");
    return rows[0];
  }

  private async buscarChave(chave: string): Promise<Cargo | null> {
    const { rows } = await this.db.query<Cargo>(`SELECT ${CAMPOS} FROM public.cargo WHERE chave = $1`, [chave]);
    return rows[0] ?? null;
  }

  /** Cria o cargo. Se outra criação ganhou a corrida (mesma chave), devolve a dela. */
  private async criar(nome: string, descricao: string | null, requisitos: string | null): Promise<{ cargo: Cargo; reaproveitado: boolean }> {
    const cargo: Cargo = { id: randomUUID(), nome: nomePadronizado(nome), chave: chaveCargo(nome), descricao, requisitos };
    const { rowCount } = await this.db.query(
      "INSERT INTO public.cargo (id, nome, chave, descricao, requisitos) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (chave) DO NOTHING",
      [cargo.id, cargo.nome, cargo.chave, cargo.descricao, cargo.requisitos],
    );
    if (rowCount) return { cargo, reaproveitado: false };
    const existente = await this.buscarChave(cargo.chave);
    if (!existente) throw new AppError(409, "CARGO_DUPLICADO", "Não foi possível gravar o cargo. Tente de novo.");
    return { cargo: existente, reaproveitado: true };
  }

  async resolverNovo(input: { nome: string; descricao: string; requisitos: string }): Promise<{ cargo: Cargo; reaproveitado: boolean }> {
    const chave = chaveCargo(input.nome);
    if (!chave) throw new AppError(422, "CARGO_INVALIDO", "Informe um nome de cargo com letras ou números.");
    const existente = await this.buscarChave(chave);
    if (existente) return { cargo: existente, reaproveitado: true };
    return this.criar(input.nome, input.descricao, input.requisitos);
  }

  /** Usado pelo sync: cria o cargo com os textos vazios. Chave vazia não vira cargo. */
  async criarVazio(nomeOriginal: string): Promise<Cargo | null> {
    if (!chaveCargo(nomeOriginal)) return null;
    return (await this.criar(nomeOriginal, null, null)).cargo;
  }
}
