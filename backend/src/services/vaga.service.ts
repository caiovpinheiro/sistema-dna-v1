import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { migrationRequired, AppError } from "../lib/errors.js";
import { formatMoneyLegacy, parseMoney } from "../lib/money.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import type { MysqlPool } from "../db/mysql.js";
import { codigoParaStatus } from "../lib/vaga-status.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import { one } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { VagaCreate, VagaListQuery, VagaPatch } from "../schemas/vaga.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import { presentVaga } from "./presenters.js";
import { mensagemDaVaga } from "../lib/mensagem-vaga.js";
import { DIAS_ESCALA, textoDoHorario } from "../lib/horario-escala.js";

/** Horário da mensagem: o texto do horário da vaga; vazio, o texto montado pela grade de dias; sem grade, a entrada e a saída. */
function horarioDaFicha(ficha: Record<string, unknown>): string | null {
  const texto = String(ficha.texto_carga ?? "").trim();
  if (texto) return texto;
  const hora = (valor: unknown) => (/^\d{2}:\d{2}$/.test(String(valor ?? "")) ? String(valor) : "");
  const dias = DIAS_ESCALA.map((dia) => {
    const coluna = dia === "domingo" ? "domindo" : dia;
    return { modo: "fixo" as const, entrada: hora(ficha[`${coluna}_entrada`]), saida: hora(ficha[`${coluna}_saida`]) };
  });
  const pelaGrade = textoDoHorario(dias);
  if (pelaGrade) return pelaGrade;
  const entrada = hora(ficha.horabase);
  const saida = hora(ficha.hora_saida_base);
  return entrada && saida ? `${entrada} às ${saida}` : null;
}

export class VagaService {
  constructor(
    private readonly db: Pool,
    private readonly repo: VagaRepository,
    private readonly empresas: EmpresaRepository,
    private readonly config: AppConfig,
    private readonly capabilities: SchemaCapabilities,
    private readonly mysql: MysqlPool | null = null,
  ) {}

  /** Grava o código no Lightsail antes do Postgres: se o Lightsail recusar, nada muda. Só o número do status, sem mexer em tabela. */
  private async statusNoLightsail(id: string, codigo: number) {
    if (!this.mysql) throw new AppError(503, "LIGHTSAIL_INDISPONIVEL", "Não foi possível falar com o Lightsail para mudar a situação.");
    await this.mysql.query("UPDATE vaga SET status = ? WHERE id_vaga = ?", [codigo, id]);
  }

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
    const { situacao, ...dados } = input;
    await this.repo.insert(this.db, situacao ? { ...dados, status: codigoParaStatus(situacao) } : dados, id);
    return presentVaga((await this.repo.findById(this.db, id))!);
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
    const { situacao, ...dados } = input;
    if (situacao) {
      const codigo = codigoParaStatus(situacao, current.status);
      if (codigo !== Number(current.status)) {
        await this.statusNoLightsail(id, codigo);
        dados.status = codigo;
      }
    }
    await this.repo.update(this.db, id, dados, salario);
    if (input.beneficios !== undefined) await this.salvarBeneficios(id, input.beneficios);
    return presentVaga((await this.repo.findById(this.db, id))!);
  }

  async sugeridos(id: string) {
    this.ensureCapacityColumn();
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    return this.repo.sugeridos(this.db, id);
  }

  async get(id: string) {
    this.ensureCapacityColumn();
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    const ficha = await this.repo.ficha(this.db, id, row.comparador);
    const beneficios = await this.lerBeneficios(id);
    const mensagem = mensagemDaVaga({
      cargo: row.cargo,
      ...await this.localDaVaga(row.comparador, row.id_empresa),
      salario: row.salario,
      beneficios,
      horario: horarioDaFicha(ficha),
    });
    return { ...presentVaga(row), ...ficha, beneficios, mensagem };
  }

  /** Bairro e cidade do endereço da vaga; sem eles, os da empresa. */
  private async localDaVaga(comparador: string | null, idEmpresa: string | null) {
    const daVaga = comparador
      ? await one<{ bairro: string | null; cidade: string | null }>(this.db, "SELECT bairro, cidade FROM dna_work.vaga_endereco WHERE comparador = $1 LIMIT 1", [comparador])
      : null;
    if (daVaga?.bairro?.trim() || daVaga?.cidade?.trim()) return { bairro: daVaga.bairro, cidade: daVaga.cidade };
    const daEmpresa = idEmpresa
      ? await one<{ bairro: string | null; cidade: string | null }>(this.db, "SELECT bairro, cidade FROM dna_work.empresa WHERE id_empresa = $1", [idEmpresa])
      : null;
    return { bairro: daEmpresa?.bairro ?? null, cidade: daEmpresa?.cidade ?? null };
  }

  private rest() {
    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) return null;
    return supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
  }

  private async lerBeneficios(id: string) {
    const rest = this.rest();
    if (rest) {
      const rows = await rest.get<Array<{ beneficios: string | null }>>(`vaga?id=eq.${encodeURIComponent(id)}&select=beneficios`);
      const publicado = rows[0]?.beneficios?.trim();
      if (publicado) return publicado;
    } else {
      const publicada = await one<{ beneficios: string | null }>(this.db, "SELECT beneficios FROM public.vaga WHERE id::text = $1", [id]);
      const publicado = publicada?.beneficios?.trim();
      if (publicado) return publicado;
    }
    const local = await one<{ beneficios_texto: string | null }>(this.db, "SELECT beneficios_texto FROM dna_work.vaga WHERE id_vaga = $1", [id]);
    return local?.beneficios_texto ?? "";
  }

  private async salvarBeneficios(id: string, beneficios: string) {
    const texto = beneficios.trim() || null;
    await this.db.query("UPDATE dna_work.vaga SET beneficios_texto = $2 WHERE id_vaga = $1", [id, texto]);
    await this.db.query("UPDATE public.vaga SET beneficios = $2 WHERE id::text = $1", [id, texto]);
    const rest = this.rest();
    if (rest) await rest.update(`vaga?id=eq.${encodeURIComponent(id)}`, { beneficios: texto });
  }

  opcoesFiltro() {
    return this.repo.opcoesFiltro(this.db);
  }

  async list(query: VagaListQuery) {
    this.ensureCapacityColumn();
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map((row) => presentVaga(row)),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }
}
