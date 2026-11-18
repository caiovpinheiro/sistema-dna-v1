import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { migrationRequired, AppError } from "../lib/errors.js";
import { formatMoneyLegacy, moneyToNumber, parseMoney } from "../lib/money.js";
import { faixaDaSemana, horarioAlinhado, horarioDe } from "./vagas-abertas-sync.service.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import { codigoParaStatus } from "../lib/vaga-status.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import { one } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { PrioridadeVaga, VagaCreate, VagaListQuery, VagaPatch } from "../schemas/vaga.js";
import { reagruparVagaIds } from "../lib/vaga-id.js";
import { presentVaga } from "./presenters.js";
import { classifyRegime } from "../lib/normalize.js";
import { legacyToIso } from "../lib/dates.js";
import { mensagemDaVaga } from "../lib/mensagem-vaga.js";
import { DIAS_ESCALA, textoDoHorario } from "../lib/horario-escala.js";

/** Campos do horário da vaga: quando algum muda na edição, a grade de public.vaga é refeita. */
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
    /** Alinha public.vaga (triagem) às vagas abertas depois que a situação muda. */
    private readonly alinharTriagem: (() => Promise<unknown>) | null = null,
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
      if (codigo !== Number(current.status)) dados.status = codigo;
    }
    // Cargo, salário e horário: dna_work.vaga e public.vaga.
    const espelhar = await this.dadosDoEspelho(id, dados, salario);
    await this.repo.update(this.db, id, dados, salario);
    if (espelhar.faixa) {
      await this.db.query("UPDATE dna_work.vaga SET semanas_inicio = $2, semanas_fim = $3 WHERE id_vaga = $1", [id, espelhar.faixa.inicio, espelhar.faixa.fim]);
    }
    await this.alinharEspelho(id, espelhar.campos, espelhar.grade);
    if (input.beneficios !== undefined) await this.salvarBeneficios(id, input.beneficios);
    // Detalhe diferente, vaga_id diferente: a vaga editada sai do grupo das repetidas (ou entra no grupo igual).
    // Se falhar aqui, o sync de vagas abertas recalcula no próximo ciclo.
    await reagruparVagaIds(this.db).catch(() => undefined);
    // Abriu ou fechou: entra ou sai da triagem na hora. Falha aqui não desfaz a edição; a busca da triagem alinha de novo.
    if (dados.status !== undefined && this.alinharTriagem) await this.alinharTriagem().catch(() => undefined);
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

  /** public.vaga: mesma grade de horário do sync de vagas abertas e os campos editados. */
  private async alinharEspelho(id: string, campos: Record<string, unknown>, grade: Record<string, unknown> | null) {
    const mudar: Record<string, unknown> = { ...campos };
    if (grade) {
      const atual = (await one<{ horario: string | null }>(this.db, "SELECT horario FROM public.vaga WHERE id::text = $1", [id]))?.horario ?? null;
      const novo = horarioDe(grade);
      // O texto novo vale; o de public.vaga só fica quando é o mesmo texto (emoji que o Lightsail troca por "?").
      mudar.horario = horarioAlinhado(atual, novo) ?? atual ?? novo;
    }
    const nomes = Object.keys(mudar);
    if (!nomes.length) return;
    await this.db.query(`UPDATE public.vaga SET ${nomes.map((nome, indice) => `${nome} = $${indice + 2}`).join(", ")} WHERE id::text = $1`, [id, ...nomes.map((nome) => mudar[nome])]);
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

  private async lerBeneficios(id: string) {
    const publicada = await one<{ beneficios: string | null }>(this.db, "SELECT beneficios FROM public.vaga WHERE id::text = $1", [id]);
    const publicado = publicada?.beneficios?.trim();
    if (publicado) return publicado;
    const local = await one<{ beneficios_texto: string | null }>(this.db, "SELECT beneficios_texto FROM dna_work.vaga WHERE id_vaga = $1", [id]);
    return local?.beneficios_texto ?? "";
  }

  private async salvarBeneficios(id: string, beneficios: string) {
    const texto = beneficios.trim() || null;
    await this.db.query("UPDATE dna_work.vaga SET beneficios_texto = $2 WHERE id_vaga = $1", [id, texto]);
    await this.db.query("UPDATE public.vaga SET beneficios = $2 WHERE id::text = $1", [id, texto]);
  }

  opcoesFiltro() {
    return this.repo.opcoesFiltro(this.db);
  }

  async definirPrioridade(id: string, prioridade: PrioridadeVaga) {
    const vaga = await this.repo.findById(this.db, id);
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    await this.repo.salvarPrioridade(this.db, id, prioridade);
    return { id_vaga: id, prioridade };
  }

  /**
   * Vagas do grupo (todas as empresas dele), juntas pelo que aparece na lista (ver
   * VagaRepository.vagasJuntasDoGrupo): contagem por situação e a página da situação escolhida.
   */
  async doGrupo(grupoId: string, filtro: { situacao?: "aberta" | "pausada" | "contratada" | "fechada"; page: number; pageSize: number }) {
    const [contagem, lista] = await Promise.all([
      this.repo.contarPorSituacao(this.db, grupoId),
      this.repo.vagasJuntasDoGrupo(this.db, grupoId, filtro),
    ]);
    const prioridades = ["alta", "media", "baixa"];
    return {
      contagem: contagem.vagas,
      disponiveis: contagem.disponiveis,
      vagas: lista.rows.map((row) => ({
        id_vaga: row.id_vaga,
        cargo: row.cargo,
        empresa: row.empresa,
        regime: classifyRegime(row.modalidade),
        situacao: row.situacao,
        quantidade_posicoes: row.posicoes,
        ocupadas: row.ocupadas,
        disponiveis: row.disponiveis,
        dataabertura: legacyToIso(row.dataabertura),
        prioridade: prioridades[row.faixa] ?? "media",
        linhas: row.linhas,
        codigos: row.codigos,
      })),
      meta: { page: filtro.page, pageSize: filtro.pageSize, total: lista.total },
    };
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
