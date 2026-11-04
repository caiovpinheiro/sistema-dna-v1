import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { chaveCargo, nomePadronizado } from "../lib/cargo.js";
import { AppError } from "../lib/errors.js";
import { supabaseRest } from "../lib/supabase-rest.js";

export type Cargo = { id: string; nome: string; chave: string; descricao: string | null; requisitos: string | null };

type SupabaseRest = ReturnType<typeof supabaseRest>;

const CAMPOS = "id,nome,chave,descricao,requisitos";

function duplicado(error: unknown) {
  return error instanceof Error && /duplicate key|23505|cargo_chave_unica/i.test(error.message);
}

/** Cargos com descrição e requisitos. O Supabase é a fonte; o Postgres guarda a mesma linha com o mesmo id. */
export class CargoService {
  private readonly rest: () => SupabaseRest;

  constructor(
    private readonly db: Pick<Pool, "query">,
    config: AppConfig,
    rest?: () => SupabaseRest,
  ) {
    this.rest = rest ?? (() => {
      if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
        throw new AppError(503, "SUPABASE_NAO_CONFIGURADO", "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
      }
      return supabaseRest({ url: config.SUPABASE_URL, key: config.SUPABASE_SERVICE_ROLE_KEY });
    });
  }

  async listar(): Promise<Cargo[]> {
    const linhas: Cargo[] = [];
    for (let offset = 0; ; offset += 1000) {
      const pagina = await this.rest().get<Cargo[]>(`cargo?select=${CAMPOS}&order=nome.asc&limit=1000&offset=${offset}`);
      linhas.push(...pagina);
      if (pagina.length < 1000) return linhas;
    }
  }

  async porChave(): Promise<Map<string, Cargo>> {
    return new Map((await this.listar()).map((cargo) => [cargo.chave, cargo]));
  }

  async obter(id: string): Promise<Cargo> {
    const [cargo] = await this.rest().get<Cargo[]>(`cargo?id=eq.${encodeURIComponent(id)}&select=${CAMPOS}`);
    if (!cargo) throw new AppError(422, "CARGO_INVALIDO", "Escolha um cargo da lista.");
    return cargo;
  }

  private async buscarChave(chave: string): Promise<Cargo | null> {
    const [cargo] = await this.rest().get<Cargo[]>(`cargo?chave=eq.${encodeURIComponent(chave)}&select=${CAMPOS}`);
    return cargo ?? null;
  }

  /** Cria no Supabase e espelha no Postgres. Se outra criação ganhou a corrida, devolve a dela. */
  private async criar(nome: string, descricao: string | null, requisitos: string | null): Promise<{ cargo: Cargo; reaproveitado: boolean }> {
    const cargo: Cargo = { id: randomUUID(), nome: nomePadronizado(nome), chave: chaveCargo(nome), descricao, requisitos };
    try {
      await this.rest().insert("cargo", cargo);
    } catch (error) {
      if (!duplicado(error)) throw error;
      const existente = await this.buscarChave(cargo.chave);
      if (!existente) throw error;
      return { cargo: existente, reaproveitado: true };
    }
    await this.espelhar(cargo);
    return { cargo, reaproveitado: false };
  }

  /** Falha no Postgres não impede o cargo: o sync completa o espelho depois. */
  private async espelhar(cargo: Cargo): Promise<boolean> {
    try {
      await this.db.query(
        "INSERT INTO public.cargo (id, nome, chave, descricao, requisitos) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [cargo.id, cargo.nome, cargo.chave, cargo.descricao, cargo.requisitos],
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Garante o cargo no Postgres dentro da transação da vaga e devolve o id que pode ir em public.vaga.cargo_id.
   * Se o Postgres já tem a mesma chave com outro id, devolve null: a vaga entra sem vínculo lá, e não falha.
   */
  async idNoPostgres(cliente: Pick<Pool, "query">, cargo: Cargo): Promise<string | null> {
    await cliente.query(
      "INSERT INTO public.cargo (id, nome, chave, descricao, requisitos) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [cargo.id, cargo.nome, cargo.chave, cargo.descricao, cargo.requisitos],
    );
    const { rows } = await cliente.query<{ id: string }>("SELECT id::text AS id FROM public.cargo WHERE id = $1", [cargo.id]);
    return rows[0]?.id ?? null;
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

  /** Insere no Postgres os cargos que ainda não estão lá. Devolve quantos inseriu. */
  async garantirEspelho(cargos: Cargo[]): Promise<number> {
    if (!cargos.length) return 0;
    const { rows } = await this.db.query<{ id: string }>("SELECT id::text AS id FROM public.cargo");
    const presentes = new Set(rows.map((row) => row.id));
    let inseridos = 0;
    for (const cargo of cargos) {
      if (!presentes.has(cargo.id) && await this.espelhar(cargo)) inseridos += 1;
    }
    return inseridos;
  }
}
