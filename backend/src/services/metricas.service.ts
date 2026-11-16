import type { Pool } from "pg";
import { metricasClt } from "../lib/metricas/clt.js";
import { permanenciaEstagio, type ContratoBruto } from "../lib/metricas/permanencia.js";

function numero(expr: string) {
  return `CASE WHEN replace(coalesce(${expr}, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$' THEN replace(${expr}, ',', '.')::numeric ELSE 0 END`;
}

const SALARIO = numero("v.salario");
const SELECAO_LEGADO = `CASE WHEN upper(coalesce(vv.tipo_selecao, fe.tipo_selecao, '')) = 'P'
       THEN ${SALARIO} * ${numero("coalesce(nullif(vv.valor_selecao, ''), fe.valor_selecao)")} / 100
       ELSE ${numero("coalesce(nullif(vv.valor_selecao, ''), fe.valor_selecao)")} END`;

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
  ${SELECAO_LEGADO},
  0)`;

/**
 * Taxa única de uma contratação CLT, na mesma ordem do Faturamento: public.valor_empresas conferido
 * (clt_status = 'ok': % do salário ou valor fixo) → seleção do cadastro antigo (vaga_valores → faturamento_empresa).
 */
const TAXA_CLT = `COALESCE(
  CASE WHEN ve.clt_status = 'ok' AND ve.clt_valor IS NOT NULL THEN
    CASE WHEN ve.clt_modelo = 'Percentual' THEN ${SALARIO} * ve.clt_valor / 100 ELSE ve.clt_valor END
  END,
  ${SELECAO_LEGADO},
  0)`;

/** Contratos da modalidade, com preço. `fe` pega uma linha só por empresa (há empresa com duas). Não lê dado pessoal. */
function sqlContratos(tipoVaga: "1" | "2", colunas: string) {
  return `
    SELECT c.status, c.datainicio, c.data_contratacao, c.data_demicao, ${colunas}
    FROM dna_work.conratacaovaga c
    JOIN dna_work.vaga v ON v.id_vaga::text = c.id_vaga::text
    LEFT JOIN LATERAL (
      SELECT f.* FROM dna_work.faturamento_empresa f
      WHERE f.id_empresa::text = v.id_empresa::text AND f.modalidade_vaga::text = '${tipoVaga}' LIMIT 1
    ) fe ON true
    LEFT JOIN dna_work.vaga_valores vv ON vv.comparador::text = v.comparador::text
    LEFT JOIN public.valor_empresas ve ON ve.id_empresa = v.id_empresa::text
    WHERE v.tipo_vaga::text = '${tipoVaga}'`;
}

function diaUtc(texto: string | undefined): number | null {
  if (!texto) return null;
  const [ano, mes, dia] = texto.split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

const diaDe = (hoje: Date) => Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

/** Métricas só para o administrador (app.ts bloqueia /api/v1/metricas para os demais). Só leitura. */
export class MetricasService {
  constructor(private readonly db: Pool) {}

  /**
   * Contratos de estágio (vaga.tipo_vaga = 1) de dna_work.conratacaovaga, com o preço da empresa.
   * `de`/`ate` (AAAA-MM-DD) filtram o período; `modo` diz se entram só os que começaram nele ("inicio") ou todos que estiveram ativos nele ("ativos").
   */
  async permanenciaEstagio(filtro: { de?: string; ate?: string; modo?: "inicio" | "ativos" } = {}, hoje = new Date()) {
    const { rows } = await this.db.query<ContratoBruto>(sqlContratos("1", `${MENSAL} AS mensal, ${RS} AS rs`));
    const dia = diaDe(hoje);
    const modo = filtro.modo ?? "inicio";
    const periodo = { de: diaUtc(filtro.de), ate: diaUtc(filtro.ate), modo };
    return {
      calculadoEm: new Date(dia).toISOString().slice(0, 10),
      periodo: { de: filtro.de ?? null, ate: filtro.ate ?? null, modo },
      ...permanenciaEstagio(rows, dia, periodo),
    };
  }

  /** Contratações CLT (vaga.tipo_vaga = 2): taxa única por contratação + permanência. O período filtra pela data de início. */
  async contratacoesClt(filtro: { de?: string; ate?: string } = {}, hoje = new Date()) {
    const { rows } = await this.db.query<ContratoBruto>(sqlContratos("2", `0 AS mensal, ${TAXA_CLT} AS rs, ${SALARIO} AS salario`));
    const dia = diaDe(hoje);
    return {
      calculadoEm: new Date(dia).toISOString().slice(0, 10),
      periodo: { de: filtro.de ?? null, ate: filtro.ate ?? null },
      ...metricasClt(rows, dia, { de: diaUtc(filtro.de), ate: diaUtc(filtro.ate) }),
    };
  }
}
