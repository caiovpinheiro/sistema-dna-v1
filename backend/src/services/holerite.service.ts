import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { legacyToIso } from "../lib/dates.js";
import { AppError } from "../lib/errors.js";
import { calcularHolerite, diasTrabalhados, gerarHoleritesPdf, lerCompetencia, type CalculoHolerite, type LancamentoHolerite } from "../lib/holerite.js";
import { moneyToNumber } from "../lib/money.js";
import { classifyRegime, onlyDigits, semEntidades } from "../lib/normalize.js";

type LinhaContrato = {
  id_contratacao: number;
  id_candidato: string | null;
  datainicio: string | null;
  data_demicao: string | null;
  nome: string | null;
  cpf: string | null;
  cargo: string | null;
  salario: string | null;
  modalidade: string | null;
};

type LinhaSalva = LancamentoHolerite & { id_contratacao: number; atualizado_em: Date | string | null; atualizado_por: string | null };

export type ItemFolha = {
  id_contratacao: number;
  id_candidato: string | null;
  nome: string;
  cpf: string;
  cargo: string;
  inicio: string | null;
  demissao: string | null;
  lancamento: LancamentoHolerite;
  calculo: CalculoHolerite;
  salvo_em: string | null;
  salvo_por: string | null;
};

const LANCAMENTO_VAZIO: LancamentoHolerite = { faltas: 0, auxilio_transporte: 0, acrescimos: 0, descricao_acrescimos: "", descontos: 0, descricao_descontos: "" };

function cpfFormatado(valor: string | null) {
  const d = onlyDigits(valor ?? "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (valor ?? "").trim();
}

function cnpjFormatado(valor: string | null) {
  const d = onlyDigits(valor ?? "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : (valor ?? "").trim();
}

function numero(valor: unknown) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Folha de holerite de estágio por empresa e competência. Lê as contratações de estágio ativas no mês
 * (dna_work.conratacaovaga + vaga) e grava os lançamentos em dna_work.holerite_estagio. Sem o sistema antigo.
 */
export class HoleriteService {
  constructor(private readonly db: Pool) {}

  private competencia(valor: string) {
    if (!lerCompetencia(valor)) throw new AppError(422, "COMPETENCIA_INVALIDA", "Informe o mês no formato AAAA-MM.");
    return valor;
  }

  private async salvos(idEmpresa: string, competencia: string): Promise<Map<number, LinhaSalva>> {
    try {
      const { rows } = await this.db.query<LinhaSalva>(
        `SELECT id_contratacao, faltas, auxilio_transporte::float8 AS auxilio_transporte, acrescimos::float8 AS acrescimos,
                descricao_acrescimos, descontos::float8 AS descontos, descricao_descontos, atualizado_em, atualizado_por
         FROM dna_work.holerite_estagio WHERE id_empresa = $1 AND competencia = $2`,
        [idEmpresa, competencia],
      );
      return new Map(rows.map((row) => [Number(row.id_contratacao), row]));
    } catch (error) {
      if ((error as { code?: string }).code === "42P01") return new Map();
      throw error;
    }
  }

  async folha(idEmpresa: string, competenciaPedida: string) {
    const competencia = this.competencia(competenciaPedida);
    const empresa = (await this.db.query<{ razao_social: string | null; nome_fantasia: string | null; cnpj: string | null }>(
      "SELECT razao_social, nome_fantasia, cnpj FROM dna_work.empresa WHERE id_empresa::text = $1",
      [idEmpresa],
    )).rows[0];
    if (!empresa) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const { rows } = await this.db.query<LinhaContrato>(`
      SELECT cv.id_contratacao::int AS id_contratacao, cv.id_candidato::text AS id_candidato, cv.datainicio::text AS datainicio,
             cv.data_demicao::text AS data_demicao, c.nome, c.cpf::text AS cpf, v.cargo, v.salario::text AS salario, m.descricao AS modalidade
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      WHERE v.id_empresa::text = $1
      ORDER BY c.nome
    `, [idEmpresa]);
    const salvos = await this.salvos(idEmpresa, competencia);
    const itens: ItemFolha[] = [];
    let foraDoEstagio = 0;
    for (const row of rows) {
      const inicio = legacyToIso(row.datainicio);
      const demissao = legacyToIso(row.data_demicao);
      if (!inicio || diasTrabalhados(competencia, inicio, demissao) === 0) continue;
      if (classifyRegime(row.modalidade) !== "estagio") {
        foraDoEstagio += 1;
        continue;
      }
      const salvo = salvos.get(Number(row.id_contratacao));
      const lancamento: LancamentoHolerite = salvo
        ? {
            faltas: numero(salvo.faltas),
            auxilio_transporte: numero(salvo.auxilio_transporte),
            acrescimos: numero(salvo.acrescimos),
            descricao_acrescimos: salvo.descricao_acrescimos ?? "",
            descontos: numero(salvo.descontos),
            descricao_descontos: salvo.descricao_descontos ?? "",
          }
        : { ...LANCAMENTO_VAZIO };
      itens.push({
        id_contratacao: Number(row.id_contratacao),
        id_candidato: row.id_candidato,
        nome: semEntidades((row.nome ?? "").trim()) || "Sem nome",
        cpf: cpfFormatado(row.cpf),
        cargo: semEntidades((row.cargo ?? "").trim()),
        inicio,
        demissao,
        lancamento,
        calculo: calcularHolerite({ competencia, bolsa_base: moneyToNumber(row.salario ?? "") ?? 0, inicio, demissao, lancamento }),
        salvo_em: salvo?.atualizado_em ? new Date(salvo.atualizado_em).toISOString() : null,
        salvo_por: salvo?.atualizado_por ?? null,
      });
    }
    return {
      competencia,
      empresa: {
        id_empresa: idEmpresa,
        razao_social: semEntidades(empresa.razao_social ?? ""),
        nome_fantasia: semEntidades(empresa.nome_fantasia ?? ""),
        cnpj: cnpjFormatado(empresa.cnpj),
      },
      itens,
      fora_do_estagio: foraDoEstagio,
      total_liquido: Math.round(itens.reduce((soma, item) => soma + item.calculo.liquido, 0) * 100) / 100,
    };
  }

  /** Grava os lançamentos (o cálculo é refeito aqui, com os dados do banco). Só contratações da folha deste mês. */
  async salvar(idEmpresa: string, competenciaPedida: string, lancamentos: Array<LancamentoHolerite & { id_contratacao: number }>, usuario: string) {
    const folha = await this.folha(idEmpresa, competenciaPedida);
    const porId = new Map(folha.itens.map((item) => [item.id_contratacao, item]));
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const lancamento of lancamentos) {
        const item = porId.get(lancamento.id_contratacao);
        if (!item) throw new AppError(422, "FORA_DA_FOLHA", "Uma das contratações não é de estágio ativa neste mês nesta empresa.");
        const calculo = calcularHolerite({ competencia: folha.competencia, bolsa_base: item.calculo.bolsa_base, inicio: item.inicio, demissao: item.demissao, lancamento });
        await client.query(`
          INSERT INTO dna_work.holerite_estagio (
            id, id_contratacao, id_empresa, id_candidato, competencia, bolsa_base, dias_mes, dias_trabalhados, bolsa_proporcional,
            faltas, valor_faltas, auxilio_transporte, acrescimos, descricao_acrescimos, descontos, descricao_descontos, liquido, atualizado_por
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id_contratacao, competencia) DO UPDATE SET
            bolsa_base = EXCLUDED.bolsa_base, dias_mes = EXCLUDED.dias_mes, dias_trabalhados = EXCLUDED.dias_trabalhados,
            bolsa_proporcional = EXCLUDED.bolsa_proporcional, faltas = EXCLUDED.faltas, valor_faltas = EXCLUDED.valor_faltas,
            auxilio_transporte = EXCLUDED.auxilio_transporte, acrescimos = EXCLUDED.acrescimos, descricao_acrescimos = EXCLUDED.descricao_acrescimos,
            descontos = EXCLUDED.descontos, descricao_descontos = EXCLUDED.descricao_descontos, liquido = EXCLUDED.liquido,
            atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now()
        `, [
          randomUUID(), item.id_contratacao, idEmpresa, item.id_candidato, folha.competencia, calculo.bolsa_base, calculo.dias_mes,
          calculo.dias_trabalhados, calculo.bolsa_proporcional, Math.min(lancamento.faltas, calculo.dias_trabalhados), calculo.valor_faltas,
          lancamento.auxilio_transporte, lancamento.acrescimos, lancamento.descricao_acrescimos, lancamento.descontos,
          lancamento.descricao_descontos, calculo.liquido, usuario,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code === "42P01") {
        throw new AppError(503, "MIGRACAO_PENDENTE", "A tabela de holerites ainda não foi criada no banco (migration 20261113150000_holerite_estagio).");
      }
      throw error;
    } finally {
      client.release();
    }
    return this.folha(idEmpresa, competenciaPedida);
  }

  /** PDF com um holerite por página: todos da folha ou só uma contratação. */
  async pdf(idEmpresa: string, competenciaPedida: string, idContratacao?: number) {
    const folha = await this.folha(idEmpresa, competenciaPedida);
    const itens = idContratacao ? folha.itens.filter((item) => item.id_contratacao === idContratacao) : folha.itens;
    if (!itens.length) throw new AppError(404, "SEM_HOLERITE", "Não há estagiário ativo nesta empresa neste mês para gerar holerite.");
    const bytes = await gerarHoleritesPdf(itens.map((item) => ({
      competencia: folha.competencia,
      empresa: { razao_social: folha.empresa.razao_social || folha.empresa.nome_fantasia, cnpj: folha.empresa.cnpj },
      estagiario: { nome: item.nome, cpf: item.cpf, cargo: item.cargo, inicio: item.inicio },
      lancamento: item.lancamento,
      calculo: item.calculo,
    })));
    const nome = (idContratacao ? itens[0].nome : folha.empresa.nome_fantasia || folha.empresa.razao_social || "empresa")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    return { bytes, arquivo: `holerite-${nome}-${folha.competencia}.pdf` };
  }
}
