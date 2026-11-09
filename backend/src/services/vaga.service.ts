import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { migrationRequired, AppError } from "../lib/errors.js";
import { formatMoneyLegacy, moneyToNumber, parseMoney } from "../lib/money.js";
import { faixaDaSemana, horarioAlinhado, horarioDe } from "./vagas-abertas-sync.service.js";
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

/** Campos do horário da vaga: quando algum muda na edição, a grade do espelho é refeita. */
const CAMPOS_HORARIO = [
  "horabase", "hora_saida_base", "segunda_entrada", "segunda_saida", "terca_entrada", "terca_saida", "quarta_entrada", "quarta_saida",
  "quinta_entrada", "quinta_saida", "sexta_entrada", "sexta_saida", "sab_entrada", "sab_saida", "domindo_entrada", "domindo_saida", "texto_carga",
];

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
    // data_adicao muda sozinha a cada UPDATE no Lightsail; a abertura da vaga fica a original.
    await this.mysql.query("UPDATE vaga SET status = ?, data_adicao = data_adicao WHERE id_vaga = ?", [codigo, id]);
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
    // Cargo, salário e horário: Postgres e o espelho (Supabase e public.vaga). O Lightsail não recebe a edição.
    const espelhar = await this.dadosDoEspelho(id, dados, salario);
    await this.repo.update(this.db, id, dados, salario);
    if (espelhar.faixa) {
      await this.db.query("UPDATE dna_work.vaga SET semanas_inicio = $2, semanas_fim = $3 WHERE id_vaga = $1", [id, espelhar.faixa.inicio, espelhar.faixa.fim]);
    }
    await this.alinharEspelho(id, espelhar.campos, espelhar.grade);
    if (input.beneficios !== undefined) await this.salvarBeneficios(id, input.beneficios);
    return presentVaga((await this.repo.findById(this.db, id))!);
  }

  /** Quando muda o horário, recalcula a faixa de dias e devolve a grade completa para o espelho; mais os campos editados. */
  private async dadosDoEspelho(id: string, dados: Record<string, unknown>, salario: string | undefined) {
    const mudouHorario = CAMPOS_HORARIO.some((campo) => dados[campo] !== undefined);
    let grade: Record<string, unknown> | null = null;
    let faixa: { inicio: number; fim: number } | null = null;
    if (mudouHorario) {
      const atual = await one<Record<string, unknown>>(this.db, `SELECT ${CAMPOS_HORARIO.join(", ")}, periodo, tempo_refeicao FROM dna_work.vaga WHERE id_vaga = $1`, [id]);
      grade = { ...(atual ?? {}), ...Object.fromEntries(CAMPOS_HORARIO.filter((campo) => dados[campo] !== undefined).map((campo) => [campo, dados[campo]])) };
      faixa = faixaDaSemana(grade);
      if (faixa) {
        grade.semanas_inicio = faixa.inicio;
        grade.semanas_fim = faixa.fim;
      }
    }
    const campos: Record<string, unknown> = {};
    if (dados.cargo !== undefined) campos.cargo = dados.cargo;
    if (dados.carga_horaria !== undefined) campos.carga_horaria = dados.carga_horaria;
    if (dados.sexo !== undefined) campos.sexo = dados.sexo;
    if (salario !== undefined) campos.salario = moneyToNumber(salario);
    return { campos, grade, faixa };
  }

  /** Espelho (Supabase e public.vaga): mesma grade de horário do sync de vagas abertas e os campos editados. */
  private async alinharEspelho(id: string, campos: Record<string, unknown>, grade: Record<string, unknown> | null) {
    const mudar: Record<string, unknown> = { ...campos };
    if (grade) {
      const rest = this.rest();
      const atual = rest
        ? (await rest.get<Array<{ horario: string | null }>>(`vaga?id=eq.${encodeURIComponent(id)}&select=horario`))[0]?.horario ?? null
        : (await one<{ horario: string | null }>(this.db, "SELECT horario FROM public.vaga WHERE id::text = $1", [id]))?.horario ?? null;
      const novo = horarioDe(grade);
      // O texto novo vale; o do espelho só fica quando é o mesmo texto (emoji que o Lightsail troca por "?").
      mudar.horario = horarioAlinhado(atual, novo) ?? atual ?? novo;
    }
    const nomes = Object.keys(mudar);
    if (!nomes.length) return;
    await this.db.query(`UPDATE public.vaga SET ${nomes.map((nome, indice) => `${nome} = $${indice + 2}`).join(", ")} WHERE id::text = $1`, [id, ...nomes.map((nome) => mudar[nome])]);
    const rest = this.rest();
    if (rest) await rest.update(`vaga?id=eq.${encodeURIComponent(id)}`, mudar);
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
