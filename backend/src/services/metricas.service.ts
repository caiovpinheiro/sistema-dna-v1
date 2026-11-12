import type { Pool } from "pg";
import { permanenciaEstagio, type ContratoBruto } from "../lib/metricas/permanencia.js";

function numero(expr: string) {
  return `CASE WHEN replace(coalesce(${expr}, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$' THEN replace(${expr}, ',', '.')::numeric ELSE 0 END`;
}

/**
 * Preço de estágio de cada contrato, na mesma ordem do Faturamento (legado.service.ts, VALOR_CONTRATO):
 * public.valor_empresas conferido (est_status = 'ok') → vaga_valores → faturamento_empresa. Sem nenhum, 0.
 */
const MENSAL = `COALESCE(
  CASE WHEN ve.est_status = 'ok' AND ve.est_mensal IS NOT NULL THEN ve.est_mensal END,
  CASE WHEN vv.cobra_recorrente::text = '1' THEN ${numero("vv.valor_recorrente")} END,
  CASE WHEN fe.cobra_recorrente::text = '1' THEN ${numero("fe.valor")} END,
  0)`;
const RS = `COALESCE(
  CASE WHEN ve.est_status = 'ok' AND ve.est_mensal IS NOT NULL THEN coalesce(ve.est_rs, 0) END,
  CASE WHEN upper(coalesce(vv.tipo_selecao, fe.tipo_selecao, '')) = 'P'
       THEN ${numero("v.salario")} * ${numero("coalesce(nullif(vv.valor_selecao, ''), fe.valor_selecao)")} / 100
       ELSE ${numero("coalesce(nullif(vv.valor_selecao, ''), fe.valor_selecao)")} END,
  0)`;

function diaUtc(texto: string | undefined): number | null {
  if (!texto) return null;
  const [ano, mes, dia] = texto.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

/** Métricas só para o administrador (app.ts bloqueia /api/v1/metricas para os demais). Só leitura. */
export class MetricasService {
  constructor(private readonly db: Pool) {}

  /**
   * Contratos de estágio (vaga.tipo_vaga = 1) de dna_work.conratacaovaga, com o preço da empresa.
   * `de`/`ate` (AAAA-MM-DD) filtram o período; `modo` diz se entram só os que começaram nele ("inicio") ou todos que estiveram ativos nele ("ativos"). Não lê nenhum dado pessoal.
   */
  async permanenciaEstagio(filtro: { de?: string; ate?: string; modo?: "inicio" | "ativos" } = {}, hoje = new Date()) {
    const { rows } = await this.db.query<ContratoBruto>(`
      SELECT c.status, c.datainicio, c.data_contratacao, c.data_demicao, ${MENSAL} AS mensal, ${RS} AS rs
      FROM dna_work.conratacaovaga c
      JOIN dna_work.vaga v ON v.id_vaga::text = c.id_vaga::text
      LEFT JOIN LATERAL (
        SELECT f.* FROM dna_work.faturamento_empresa f
        WHERE f.id_empresa::text = v.id_empresa::text AND f.modalidade_vaga::text = '1' LIMIT 1
      ) fe ON true
      LEFT JOIN dna_work.vaga_valores vv ON vv.comparador::text = v.comparador::text
      LEFT JOIN public.valor_empresas ve ON ve.id_empresa = v.id_empresa::text
      WHERE v.tipo_vaga::text = '1'`);
    const dia = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const modo = filtro.modo ?? "inicio";
    const periodo = { de: diaUtc(filtro.de), ate: diaUtc(filtro.ate), modo };
    return {
      calculadoEm: new Date(dia).toISOString().slice(0, 10),
      periodo: { de: filtro.de ?? null, ate: filtro.ate ?? null, modo },
      ...permanenciaEstagio(rows, dia, periodo),
    };
  }
}
