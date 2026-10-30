import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { moneyToNumber } from "../lib/money.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import type { Logger } from "./notion-sync.service.js";

/** Colunas da grade no Lightsail, na numeração 1 domingo … 7 sábado. O Lightsail escreve "domindo". */
const COLUNAS_DIA: Record<number, string> = { 1: "domindo", 2: "segunda", 3: "terca", 4: "quarta", 5: "quinta", 6: "sexta", 7: "sab" };
const TIPO_BENEFICIO: Record<string, string> = { M: "Mensal", D: "Diário", S: "Semanal" };
const JORNADA: Record<number, string> = { 0: "fixa", 1: "escala" };
const TIPO_TRABALHO: Record<number, string> = { 0: "presencial", 1: "remoto", 2: "hibrido" };

type VagaLightsail = RowDataPacket & Record<string, unknown> & {
  id_vaga: string;
  id_empresa: string;
  comparador: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
};

type EmpresaNova = { id: string; grupo_id: string | null; cep: string | null; latitude: number | null; longitude: number | null };
type Espelho = { id: string; vaga_id: string | null };
type Repetida = Record<string, unknown> & { vaga_id: string; empresa_id: string | null };

export type LinhaVaga = {
  id: string;
  vaga_id: string;
  grupo_id: string | null;
  empresa_id: string;
  tipo_vaga: number;
  cargo: string;
  salario: number | null;
  carga_horaria: string | null;
  escolaridade: string | null;
  sexo: string | null;
  idade: number | null;
  idade_ate: number | null;
  km: number | null;
  atividades: string | null;
  tempo: null;
  horario: string;
  turno: string | null;
  beneficios: string | null;
  conducoes: null;
  jornada: string | null;
  tipo_trabalho: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type EmpresaPendenteSync = { nome: string; cnpj: string; vagas: number };

export type ResultadoAbertas = {
  dry: boolean;
  lidas: number;
  novas: number;
  jaExistiam: number;
  fora: number;
  erros: number;
  pendentes: EmpresaPendenteSync[];
  inseridas: string[];
  apagadas: string[];
};

const COLUNAS_INSERT = [
  "id", "vaga_id", "grupo_id", "empresa_id", "tipo_vaga", "cargo", "salario", "carga_horaria", "escolaridade", "sexo", "idade", "idade_ate",
  "km", "atividades", "tempo", "horario", "turno", "beneficios", "conducoes", "jornada", "tipo_trabalho", "cep", "latitude", "longitude",
] as const;

function texto(valor: unknown): string {
  return valor == null ? "" : String(valor).trim();
}

function hora(valor: unknown): string | null {
  const raw = texto(valor);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

function inteiro(valor: unknown): number | null {
  const numero = Number.parseInt(texto(valor), 10);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Grade no formato do sistema novo: turno;início-fim;00:00;1=..;…;7=..;texto=…
 * Cada dia usa as próprias colunas; dia dentro da faixa sem hora própria usa horabase/hora_saida_base.
 */
export function horarioDe(vaga: Record<string, unknown>): string {
  const inicio = inteiro(vaga.semanas_inicio) ?? 0;
  const fim = inteiro(vaga.semanas_fim) ?? 0;
  const naFaixa = (numero: number) => inicio > 0 && fim > 0 && (fim >= inicio ? numero >= inicio && numero <= fim : numero >= inicio || numero <= fim);
  const base = { entrada: hora(vaga.horabase), saida: hora(vaga.hora_saida_base) };
  const dias = [1, 2, 3, 4, 5, 6, 7].map((numero) => {
    const coluna = COLUNAS_DIA[numero];
    const entrada = hora(vaga[`${coluna}_entrada`]);
    const saida = hora(vaga[`${coluna}_saida`]);
    if (entrada && saida) return `${numero}=${entrada}-${saida}`;
    if (naFaixa(numero) && base.entrada && base.saida) return `${numero}=${base.entrada}-${base.saida}`;
    return `${numero}=`;
  });
  const partes = [texto(vaga.periodo), `${inicio}-${fim}`, "00:00", ...dias];
  const carga = texto(vaga.texto_carga);
  if (carga) partes.push(`texto=${carga}`);
  return partes.join(";");
}

/** "Auxílio Transporte — R$ 10,00 — Diário", em ordem alfabética, uma linha por benefício. */
export function beneficiosDe(lista: Array<{ nome: string; valor: string; tipo: string }>): string | null {
  const linhas = lista
    .filter((item) => item.nome.trim())
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((item) => [item.nome.trim(), item.valor.trim() ? `R$ ${item.valor.trim()}` : "", TIPO_BENEFICIO[item.tipo] ?? ""].filter(Boolean).join(" — "));
  return linhas.length ? linhas.join("\n") : null;
}

/** Igualdade com um modelo já existente quando o comparador do Lightsail não resolve. */
function chave(linha: Pick<LinhaVaga, "empresa_id" | "tipo_vaga" | "cargo" | "salario" | "carga_horaria" | "sexo" | "idade" | "idade_ate" | "atividades" | "horario">) {
  return [linha.empresa_id, linha.tipo_vaga, linha.cargo, linha.salario, linha.carga_horaria, linha.sexo, linha.idade, linha.idade_ate, linha.atividades, linha.horario]
    .map((valor) => texto(valor).toLowerCase())
    .join("|");
}

export class VagasAbertasSyncService {
  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  private rest() {
    return supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
  }

  private async todas<T>(caminho: string): Promise<T[]> {
    const linhas: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const pagina = await this.rest().get<T[]>(`${caminho}&order=id&limit=1000&offset=${offset}`);
      linhas.push(...pagina);
      if (pagina.length < 1000) return linhas;
    }
  }

  async executar(dry: boolean, slot: string): Promise<ResultadoAbertas> {
    const resultado: ResultadoAbertas = { dry, lidas: 0, novas: 0, jaExistiam: 0, fora: 0, erros: 0, pendentes: [], inseridas: [], apagadas: [] };
    if (!this.mysql || !this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) {
      this.log.error({ slot }, "sync vagas: MySQL ou Supabase não configurado");
      return resultado;
    }

    const [supabase, postgres, empresas, repetidas] = await Promise.all([
      this.todas<Espelho>("vaga?select=id,vaga_id"),
      this.db.query<Espelho>("SELECT id::text AS id, vaga_id::text AS vaga_id FROM public.vaga").then((r) => r.rows),
      this.todas<EmpresaNova>("empresa?select=id,grupo_id,cep,latitude,longitude"),
      this.todas<Repetida>(`vaga_repetida?select=${COLUNAS_INSERT.filter((coluna) => coluna !== "tempo" && coluna !== "conducoes").join(",")}`),
    ]);
    const noSistema = new Map<string, string | null>();
    for (const row of [...supabase, ...postgres]) noSistema.set(row.id, noSistema.get(row.id) ?? row.vaga_id);
    const empresaPorId = new Map(empresas.map((empresa) => [empresa.id, empresa]));
    const { rows: repetidasPg } = await this.db.query<{ vaga_id: string }>("SELECT vaga_id::text AS vaga_id FROM public.vaga_repetida");
    const modelosSupabase = new Set(repetidas.map((row) => row.vaga_id));
    const modelosPostgres = new Set(repetidasPg.map((row) => row.vaga_id));

    // 1) Copiar as novas.
    const [abertas] = await this.mysql.query<VagaLightsail[]>(`
      SELECT v.*, e.nome_fantasia, e.razao_social, e.cnpj
      FROM vaga v
      INNER JOIN empresa e ON e.id_empresa = v.id_empresa
      WHERE e.sede = 10 AND v.status = 0 AND v.tipo_vaga IN (1, 2, 4)
    `);
    resultado.lidas = abertas.length;
    const pendentes = new Map<string, EmpresaPendenteSync>();
    const novas: VagaLightsail[] = [];
    for (const vaga of abertas) {
      if (noSistema.has(vaga.id_vaga)) {
        resultado.jaExistiam += 1;
        continue;
      }
      if (!empresaPorId.has(vaga.id_empresa)) {
        const atual = pendentes.get(vaga.id_empresa) ?? { nome: texto(vaga.nome_fantasia) || texto(vaga.razao_social), cnpj: texto(vaga.cnpj), vagas: 0 };
        atual.vagas += 1;
        pendentes.set(vaga.id_empresa, atual);
        continue;
      }
      novas.push(vaga);
    }
    resultado.pendentes = [...pendentes.values()];

    if (novas.length) {
      const beneficios = await this.beneficios(novas.map((vaga) => vaga.id_vaga));
      const modeloPorComparador = await this.modelosPorComparador(novas, noSistema);
      const modeloPorChave = new Map(repetidas.map((row) => [chave(row as unknown as LinhaVaga), row.vaga_id]));
      for (const vaga of novas) {
        const empresa = empresaPorId.get(vaga.id_empresa)!;
        const linha = this.linhaDe(vaga, empresa, beneficios.get(vaga.id_vaga) ?? []);
        const comparador = texto(vaga.comparador);
        linha.vaga_id = (comparador && modeloPorComparador.get(comparador)) || modeloPorChave.get(chave(linha)) || randomUUID();
        if (comparador) modeloPorComparador.set(comparador, linha.vaga_id);
        modeloPorChave.set(chave(linha), linha.vaga_id);
        resultado.novas += 1;
        this.log.info({ dry, slot, id_vaga: linha.id, empresa_id: linha.empresa_id, vaga_id: linha.vaga_id, cargo: linha.cargo }, "sync vagas: nova");
        if (dry) {
          resultado.inseridas.push(linha.id);
          continue;
        }
        try {
          await this.inserir(linha, !modelosSupabase.has(linha.vaga_id), !modelosPostgres.has(linha.vaga_id));
          modelosSupabase.add(linha.vaga_id);
          modelosPostgres.add(linha.vaga_id);
          noSistema.set(linha.id, linha.vaga_id);
          resultado.inseridas.push(linha.id);
        } catch (error) {
          resultado.erros += 1;
          resultado.novas -= 1;
          this.log.error({ slot, id_vaga: linha.id, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: cópia falhou, vaga não ficou em nenhum dos dois");
        }
      }
    }

    // 2) Apagar as fechadas (só a linha de vaga no Supabase e no Postgres).
    const ids = [...noSistema.keys()];
    if (ids.length) {
      const [status] = await this.mysql.query<RowDataPacket[]>("SELECT id_vaga, status FROM vaga WHERE id_vaga IN (?)", [ids]);
      for (const row of status) {
        const valor = row.status;
        if (typeof valor !== "number" || !Number.isInteger(valor) || valor === 0) continue;
        resultado.fora += 1;
        this.log.info({ dry, slot, id_vaga: row.id_vaga, status: valor }, "sync vagas: fechada, sai do sistema");
        if (dry) {
          resultado.apagadas.push(String(row.id_vaga));
          continue;
        }
        try {
          await this.rest().remove(`vaga?id=eq.${row.id_vaga}`);
          await this.db.query("DELETE FROM public.vaga WHERE id = $1", [row.id_vaga]);
          resultado.apagadas.push(String(row.id_vaga));
        } catch (error) {
          resultado.erros += 1;
          resultado.fora -= 1;
          this.log.error({ slot, id_vaga: row.id_vaga, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao apagar");
        }
      }
    }

    const { lidas, novas: inseridas, jaExistiam, fora, erros } = resultado;
    this.log.info({
      dry, slot, lidas, novas: inseridas, jaExistiam, fora, erros,
      pendentes: resultado.pendentes.map((item) => `${item.nome} | ${item.cnpj} | ${item.vagas}`),
    }, "sync vagas: fim");
    return resultado;
  }

  private async beneficios(ids: string[]) {
    const [rows] = await this.mysql!.query<RowDataPacket[]>(
      `SELECT bv.id_vaga, bv.valor, bv.tipo, b.beneficios AS nome
       FROM beneficio_vaga bv JOIN beneficio b ON b.id = bv.id_beneficio
       WHERE bv.id_vaga IN (?)`,
      [ids],
    );
    const porVaga = new Map<string, Array<{ nome: string; valor: string; tipo: string }>>();
    for (const row of rows) {
      const lista = porVaga.get(String(row.id_vaga)) ?? [];
      lista.push({ nome: texto(row.nome), valor: texto(row.valor), tipo: texto(row.tipo) });
      porVaga.set(String(row.id_vaga), lista);
    }
    return new Map([...porVaga].map(([id, lista]) => [id, lista]));
  }

  /** Vagas iguais compartilham o vaga_id: o comparador do Lightsail aponta para uma vaga que já está no sistema. */
  private async modelosPorComparador(novas: VagaLightsail[], noSistema: Map<string, string | null>) {
    const comparadores = [...new Set(novas.map((vaga) => texto(vaga.comparador)).filter(Boolean))];
    const mapa = new Map<string, string>();
    if (!comparadores.length) return mapa;
    const [rows] = await this.mysql!.query<RowDataPacket[]>("SELECT id_vaga, comparador FROM vaga WHERE comparador IN (?)", [comparadores]);
    for (const row of rows) {
      const vagaId = noSistema.get(String(row.id_vaga));
      if (vagaId && !mapa.has(texto(row.comparador))) mapa.set(texto(row.comparador), vagaId);
    }
    return mapa;
  }

  private linhaDe(vaga: VagaLightsail, empresa: EmpresaNova, beneficios: Array<{ nome: string; valor: string; tipo: string }>): LinhaVaga {
    const jornada = inteiro(vaga.jornada);
    const remoto = inteiro(vaga.remoto);
    const km = Number(texto(vaga.km).replace(",", "."));
    return {
      id: vaga.id_vaga,
      vaga_id: "",
      grupo_id: empresa.grupo_id,
      empresa_id: vaga.id_empresa,
      tipo_vaga: inteiro(vaga.tipo_vaga) ?? 0,
      cargo: texto(vaga.cargo),
      salario: moneyToNumber(texto(vaga.salario)),
      carga_horaria: texto(vaga.carga_horaria) || null,
      escolaridade: texto(vaga.escolaridade) || null,
      sexo: texto(vaga.sexo) || null,
      idade: inteiro(vaga.idade),
      idade_ate: inteiro(vaga.idadeate),
      km: texto(vaga.km) && Number.isFinite(km) ? km : null,
      atividades: texto(vaga.atribuicaoes) || null,
      tempo: null,
      horario: horarioDe(vaga),
      turno: texto(vaga.periodo) || null,
      beneficios: beneficiosDe(beneficios),
      conducoes: null,
      jornada: jornada == null ? null : JORNADA[jornada] ?? null,
      tipo_trabalho: remoto == null ? null : TIPO_TRABALHO[remoto] ?? null,
      cep: empresa.cep,
      latitude: empresa.latitude,
      longitude: empresa.longitude,
    };
  }

  /** Grava nos dois lados. Se o Postgres falhar, desfaz o Supabase: a vaga não fica só de um lado. */
  private async inserir(linha: LinhaVaga, modeloSupabase: boolean, modeloPostgres: boolean) {
    const rest = this.rest();
    const modelo = { ...linha, id: randomUUID(), tipo_vaga: String(linha.tipo_vaga) };
    let modeloInserido = false;
    let vagaInserida = false;
    try {
      if (modeloSupabase) {
        await rest.insert("vaga_repetida", modelo);
        modeloInserido = true;
      }
      await rest.insert("vaga", linha);
      vagaInserida = true;
      const pg = await this.db.connect();
      try {
        await pg.query("BEGIN");
        const colunas = COLUNAS_INSERT.join(", ");
        const marcadores = COLUNAS_INSERT.map((_, indice) => `$${indice + 1}`).join(", ");
        if (modeloPostgres) await pg.query(`INSERT INTO public.vaga_repetida (${colunas}) VALUES (${marcadores})`, COLUNAS_INSERT.map((coluna) => modelo[coluna]));
        await pg.query(`INSERT INTO public.vaga (${colunas}) VALUES (${marcadores})`, COLUNAS_INSERT.map((coluna) => linha[coluna]));
        await pg.query("COMMIT");
      } catch (error) {
        await pg.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        pg.release();
      }
    } catch (error) {
      if (vagaInserida) await rest.remove(`vaga?id=eq.${linha.id}`).catch(() => undefined);
      if (modeloInserido) await rest.remove(`vaga_repetida?id=eq.${modelo.id}`).catch(() => undefined);
      throw error;
    }
  }
}
