import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { AVISO_TEXTO_LIVRE, removerChavesSensiveis, saidaAviso } from "./comum.js";
import { definir } from "./tipos.js";

/** Indicadores gerenciais: restritos à administração; um colaborador só usa com esta permissão individual. */
export const PERMISSAO_INDICADORES = "gestao:indicadores";

type Linha = Record<string, any>;
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD.");
const AGREGADO = z.record(z.unknown());
const AVISO_AGREGADO = "Indicadores agregados (sem dados de pessoas, sem salários e sem valores financeiros). Não invente números fora desta resposta.";

const periodoEntrada = z.object({
  dias: z.number().int().min(1).max(366).optional().describe("Últimos N dias (1 a 366)."),
  de: DATA.optional(), ate: DATA.optional(),
}).strict().refine((e) => !(e.dias && (e.de || e.ate)), { message: "Use dias OU de/ate, não os dois." });

const pegar = (o: Linha, chaves: string[]) => Object.fromEntries(chaves.filter((k) => k in o).map((k) => [k, removerChavesSensiveis(o[k])]));

const CHAVES_DASHBOARD = ["periodo", "candidatos_base", "empresas_base", "vagas_abertas_agora", "contratacoes_ativas_agora", "posicoes", "origem", "cadastrados", "vagas_cadastradas", "vagas_abertas_periodo", "contratacoes", "encaminhamentos", "empresas_movimento", "regimes", "serie", "ranking", "serie_origem"];
const CHAVES_CONTRATACOES = ["periodo", "contratacoes_ativas_agora", "contratacoes", "encaminhamentos", "regimes", "serie", "ranking"];

function periodoDe(e: { dias?: number; de?: string; ate?: string }) {
  return e.de || e.ate ? { de: e.de, ate: e.ate } : { dias: e.dias ?? 30 };
}

export const consultarDashboard = definir({
  nome: "consultar_dashboard",
  titulo: "Dashboard de gestão",
  descricao: `Indicadores gerais do painel no período (cadastros, vagas, contratações, encaminhamentos, regimes, série e ranking de empresas), comparados ao período anterior. Não inclui a lista de últimas contratações (tem CPF e salário). ${AVISO_AGREGADO}`,
  modulo: "gestao", paginas: ["painel"], consumo: "puro", dados: "agregado", exigePermissao: PERMISSAO_INDICADORES,
  entrada: periodoEntrada,
  saida: z.object({ indicadores: AGREGADO, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = (await ctx.servicos.dashboard.get(periodoDe(e))) as unknown as Linha;
    return { dados: { indicadores: pegar(r, CHAVES_DASHBOARD), aviso: AVISO_AGREGADO } };
  },
});

export const consultarIndicadoresContratacoes = definir({
  nome: "consultar_indicadores_contratacoes",
  titulo: "Indicadores de contratações",
  descricao: `Indicadores de contratações no período: total e comparação com o período anterior, contratações ativas agora, encaminhamentos, regimes (CLT/estágio), série no tempo e ranking de empresas. ${AVISO_AGREGADO}`,
  modulo: "gestao", paginas: ["contratacoes"], consumo: "puro", dados: "agregado", exigePermissao: PERMISSAO_INDICADORES,
  entrada: periodoEntrada,
  saida: z.object({ indicadores: AGREGADO, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = (await ctx.servicos.dashboard.get(periodoDe(e))) as unknown as Linha;
    const origem = (r.origem ?? {}) as Linha;
    return { dados: { indicadores: { ...pegar(r, CHAVES_CONTRATACOES), origem_das_contratacoes: removerChavesSensiveis(origem.contratacoes ?? []) }, aviso: AVISO_AGREGADO } };
  },
});

export const consultarOrigemCandidatos = definir({
  nome: "consultar_origem_candidatos",
  titulo: "Origem dos candidatos",
  descricao:
    "De onde vêm os candidatos (origens, redes, campanhas, ganhos e atendimentos) em um período de até 3 meses. Padrão: últimos 7 dias. Pode consultar o CRM, demorar e tem custo; por isso há limite de uso por hora e cache de 10 minutos. " + AVISO_AGREGADO,
  modulo: "gestao", paginas: ["painel"], consumo: "servico_externo", limitePorHora: 6, dados: "agregado", exigePermissao: PERMISSAO_INDICADORES,
  entrada: z.object({ de: DATA.optional(), ate: DATA.optional() }).strict(),
  saida: z.object({ origem: AGREGADO, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = await ctx.servicos.origem(e.de ?? null, e.ate ?? null);
    if (r.status >= 400) {
      const msg = (r.body as Linha | null)?.error?.message;
      throw new AppError(r.status >= 500 ? 503 : 422, "ORIGEM_INDISPONIVEL", typeof msg === "string" ? msg.slice(0, 200) : "Não foi possível consultar a origem dos candidatos agora.");
    }
    const corpo = ((r.body as Linha)?.data ?? r.body) as Linha;
    return { dados: { origem: removerChavesSensiveis(corpo), aviso: AVISO_AGREGADO } };
  },
});

const metricaEntrada = z.object({ de: DATA.optional(), ate: DATA.optional() }).strict();
const AVISO_METRICA = "Somente administradores. Métricas de permanência e quantidades; valores financeiros (preço, taxa, receita) e dados de pessoas são removidos. " + AVISO_AGREGADO;

export const consultarMetricasClt = definir({
  nome: "consultar_metricas_clt",
  titulo: "Métricas de contratações CLT",
  descricao: `Métricas das contratações CLT (quantidades e permanência) no período. ${AVISO_METRICA}`,
  modulo: "gestao", paginas: [], adminOnly: true, consumo: "puro", dados: "agregado",
  entrada: metricaEntrada,
  saida: z.object({ metricas: AGREGADO, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = (await ctx.servicos.metricas.contratacoesClt(e)) as unknown as Linha;
    return { dados: { metricas: removerChavesSensiveis(r), aviso: AVISO_METRICA } };
  },
});

export const consultarMetricasEstagio = definir({
  nome: "consultar_metricas_estagio",
  titulo: "Métricas de permanência de estágio",
  descricao: `Permanência dos estagiários (por início ou ativos) no período. ${AVISO_METRICA}`,
  modulo: "gestao", paginas: [], adminOnly: true, consumo: "puro", dados: "agregado",
  entrada: metricaEntrada.extend({ modo: z.enum(["inicio", "ativos"]).default("inicio") }).strict(),
  saida: z.object({ metricas: AGREGADO, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = (await ctx.servicos.metricas.permanenciaEstagio(e)) as unknown as Linha;
    return { dados: { metricas: removerChavesSensiveis(r), aviso: AVISO_METRICA } };
  },
});

export const ferramentasGestao = [consultarDashboard, consultarIndicadoresContratacoes, consultarOrigemCandidatos, consultarMetricasClt, consultarMetricasEstagio];
void AVISO_TEXTO_LIVRE;
