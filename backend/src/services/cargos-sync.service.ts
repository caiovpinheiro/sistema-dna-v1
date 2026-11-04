import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { chaveCargo } from "../lib/cargo.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import type { Cargo, CargoService } from "./cargo.service.js";
import type { Logger } from "./notion-sync.service.js";

type Tabela = "vaga" | "vaga_repetida";

export type LinhaCargo = { tabela: Tabela; id: string; cargo: string | null; cargo_id: string | null; descricao: string | null; requisitos: string | null };

export type AtualizacaoCargo = {
  tabela: Tabela;
  id: string;
  cargoChave: string;
  campos: { cargo_id?: string; descricao?: string; requisitos?: string };
};

export type ResultadoCargos = {
  dry: boolean;
  cargosCriados: number;
  vagasVinculadas: number;
  descricoesCompletadas: number;
  requisitosCompletados: number;
  erros: number;
};

function vazio(valor: string | null) {
  return !valor || !valor.trim();
}

/**
 * O que falta em cada vaga e modelo: o vínculo com o cargo e os textos vazios.
 * Texto já preenchido na vaga nunca entra. cargosFaltando traz o primeiro nome original de cada chave sem cargo.
 */
export function planoDeCargos(linhas: LinhaCargo[], cargos: Map<string, Cargo>) {
  const faltando = new Map<string, string>();
  const atualizacoes: AtualizacaoCargo[] = [];
  for (const linha of linhas) {
    const chave = chaveCargo(linha.cargo ?? "");
    if (!chave) continue;
    const cargo = cargos.get(chave);
    if (!cargo) {
      if (!faltando.has(chave)) faltando.set(chave, (linha.cargo ?? "").trim());
      continue;
    }
    const campos: AtualizacaoCargo["campos"] = {};
    if (!linha.cargo_id) campos.cargo_id = cargo.id;
    if (vazio(linha.descricao) && !vazio(cargo.descricao)) campos.descricao = cargo.descricao!;
    if (vazio(linha.requisitos) && !vazio(cargo.requisitos)) campos.requisitos = cargo.requisitos!;
    if (Object.keys(campos).length) atualizacoes.push({ tabela: linha.tabela, id: linha.id, cargoChave: chave, campos });
  }
  return { cargosFaltando: [...faltando.values()], atualizacoes };
}

/** Passo "cargos" do sync: liga vagas e modelos ao cargo, cria os cargos que faltam e completa textos vazios. */
export class CargosSyncService {
  constructor(
    private readonly db: Pool,
    private readonly config: AppConfig,
    private readonly cargos: CargoService,
    private readonly log: Logger,
    private readonly restFalso?: () => ReturnType<typeof supabaseRest>,
  ) {}

  private rest() {
    return this.restFalso?.() ?? supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
  }

  /**
   * Postgres primeiro: se ele falhar, o Supabase continua vazio e o próximo ciclo tenta de novo.
   * Nos dois bancos a gravação só preenche o que está vazio, mesmo que a leitura tenha ficado velha.
   */
  private async aplicar(atualizacao: AtualizacaoCargo) {
    const { tabela, id, campos } = atualizacao;
    const sets: string[] = [];
    const valores: unknown[] = [];
    if (campos.cargo_id) {
      valores.push(campos.cargo_id);
      sets.push(`cargo_id = COALESCE(cargo_id, $${valores.length})`);
    }
    for (const coluna of ["descricao", "requisitos"] as const) {
      if (!campos[coluna]) continue;
      valores.push(campos[coluna]);
      sets.push(`${coluna} = CASE WHEN ${coluna} IS NULL OR btrim(${coluna}) = '' THEN $${valores.length} ELSE ${coluna} END`);
    }
    valores.push(id);
    await this.db.query(`UPDATE public.${tabela} SET ${sets.join(", ")} WHERE id = $${valores.length}`, valores);
    const rest = this.rest();
    if (campos.cargo_id) await rest.update(`${tabela}?id=eq.${id}&cargo_id=is.null`, { cargo_id: campos.cargo_id });
    for (const coluna of ["descricao", "requisitos"] as const) {
      if (campos[coluna]) await rest.update(`${tabela}?id=eq.${id}&or=(${coluna}.is.null,${coluna}.eq.)`, { [coluna]: campos[coluna] });
    }
  }

  private async linhas(tabela: Tabela): Promise<LinhaCargo[]> {
    const linhas: LinhaCargo[] = [];
    for (let offset = 0; ; offset += 1000) {
      const pagina = await this.rest().get<Omit<LinhaCargo, "tabela">[]>(`${tabela}?select=id,cargo,cargo_id,descricao,requisitos&order=id&limit=1000&offset=${offset}`);
      linhas.push(...pagina.map((linha) => ({ ...linha, tabela })));
      if (pagina.length < 1000) return linhas;
    }
  }

  async executar(dry: boolean, slot: string): Promise<ResultadoCargos> {
    const resultado: ResultadoCargos = { dry, cargosCriados: 0, vagasVinculadas: 0, descricoesCompletadas: 0, requisitosCompletados: 0, erros: 0 };
    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) {
      this.log.error({ slot }, "sync cargos: Supabase não configurado");
      return resultado;
    }
    const linhas = [...await this.linhas("vaga"), ...await this.linhas("vaga_repetida")];
    const cargos = await this.cargos.porChave();

    for (const nome of planoDeCargos(linhas, cargos).cargosFaltando) {
      resultado.cargosCriados += 1;
      this.log.info({ dry, slot, cargo: nome }, "sync cargos: cargo novo");
      if (dry) {
        // Simulação: um cargo em memória, só para contar as vagas que seriam ligadas.
        const chave = chaveCargo(nome);
        cargos.set(chave, { id: `simulado-${chave}`, nome, chave, descricao: null, requisitos: null });
        continue;
      }
      try {
        const cargo = await this.cargos.criarVazio(nome);
        if (cargo) cargos.set(cargo.chave, cargo);
      } catch (error) {
        resultado.cargosCriados -= 1;
        resultado.erros += 1;
        this.log.error({ slot, cargo: nome, erro: error instanceof Error ? error.message : String(error) }, "sync cargos: falha ao criar cargo");
      }
    }

    // Antes das vagas: public.vaga.cargo_id aponta para public.cargo no Postgres.
    if (!dry) {
      await this.cargos.garantirEspelho([...cargos.values()]).catch((error: unknown) => {
        resultado.erros += 1;
        this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync cargos: falha no espelho do Postgres");
      });
    }

    for (const atualizacao of planoDeCargos(linhas, cargos).atualizacoes) {
      const { campos } = atualizacao;
      try {
        if (!dry) await this.aplicar(atualizacao);
        if (campos.cargo_id) resultado.vagasVinculadas += 1;
        if (campos.descricao) resultado.descricoesCompletadas += 1;
        if (campos.requisitos) resultado.requisitosCompletados += 1;
      } catch (error) {
        resultado.erros += 1;
        this.log.error({ slot, tabela: atualizacao.tabela, id: atualizacao.id, erro: error instanceof Error ? error.message : String(error) }, "sync cargos: falha ao atualizar");
      }
    }

    const { cargosCriados, vagasVinculadas, descricoesCompletadas, requisitosCompletados, erros } = resultado;
    this.log.info({ dry, slot, cargosCriados, vagasVinculadas, descricoesCompletadas, requisitosCompletados, erros }, "sync cargos: fim");
    return resultado;
  }
}
