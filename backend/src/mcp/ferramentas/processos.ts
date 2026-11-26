import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { ContratacaoListQuery } from "../../schemas/contratacao.js";
import type { ProcessoListQuery } from "../../schemas/processo.js";
import type { ContextoFerramenta } from "../registro.js";
import { AVISO_TEXTO_LIVRE, ausentesDe, dataIso, entradaPagina, limpar, meta, saidaAusentes, saidaAviso, saidaLink, saidaMeta, textoSeguro } from "./comum.js";
import { definir } from "./tipos.js";

type Linha = Record<string, any>;
const idTexto = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

/** Processo sem o JSON de atendimento (resumos, testes): só o deal_id como referência ao CRM. */
const itemProcesso = z.object({
  id: z.string(), etapa: z.string().nullable(), origem: z.string().nullable(),
  candidato: z.object({ id_candidato: z.string().nullable(), nome: z.string().nullable(), link: saidaLink }).strict(),
  empresa: z.object({ id_empresa: z.string().nullable(), nome: z.string().nullable(), link: saidaLink }).strict(),
  vaga: z.object({ id_vaga: z.string().nullable(), cargo: z.string().nullable(), link: saidaLink }).strict(),
  recebido_em: z.string().nullable(), encaminhado_em: z.string().nullable(), criado_em: z.string().nullable(), id_contratacao: z.number().nullable(),
  referencias: z.object({ deal_id: z.string().nullable() }).strict(), link: saidaLink,
}).strict();

function resumoProcesso(ctx: ContextoFerramenta, p: Linha) {
  const idC = idTexto(p.id_candidato); const idE = idTexto(p.id_empresa); const idV = idTexto(p.id_vaga);
  return {
    id: String(p.id), etapa: limpar(p.etapa, 60), origem: limpar(p.origem, 30),
    candidato: { id_candidato: idC, nome: limpar(p.candidato_nome, 120), link: idC ? ctx.link("candidatos", idC) : null },
    empresa: { id_empresa: idE, nome: limpar(p.empresa_nome, 120), link: idE ? ctx.link("empresas", idE) : null },
    vaga: { id_vaga: idV, cargo: limpar(p.cargo, 120), link: idV ? ctx.link("vagas", idV) : null },
    recebido_em: dataIso(p.data_recebimento), encaminhado_em: dataIso(p.data_encaminhamento), criado_em: dataIso(p.criado_em),
    id_contratacao: typeof p.id_contratacao === "number" ? p.id_contratacao : null,
    referencias: { deal_id: p.atendimento?.deal_id ? limpar(p.atendimento.deal_id, 64) : null }, link: ctx.link("processos", String(p.id)),
  };
}

const DESC = "Só leitura. Não inclui salário, CPF, documentos nem rescisão. Não invente dados ausentes.";
const PAG_PROC = ["processos"] as const;
const PAG_CONTR = ["contratacoes"] as const;

export const listarProcessos = definir({
  nome: "listar_processos",
  titulo: "Listar processos seletivos",
  descricao: `Lista processos seletivos (mais recentes primeiro) com filtros por etapa, origem (dnawork/empresa), empresa, vaga, candidato ou nome. Mostra o deal_id do CRM quando existir. ${DESC}`,
  modulo: "processos", paginas: PAG_PROC, consumo: "puro",
  entrada: z.object({
    etapa: z.string().trim().min(2).max(60).optional(), origem: z.enum(["dnawork", "empresa"]).optional(), id_empresa: z.string().trim().min(1).max(40).optional(),
    id_vaga: z.string().trim().min(1).max(64).optional(), id_candidato: z.string().trim().min(1).max(64).optional(), nome: z.string().trim().min(2).max(80).optional(), ...entradaPagina,
  }).strict(),
  saida: z.object({ processos: z.array(itemProcesso), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const { pagina, limite, ...filtros } = e;
    const r = await ctx.servicos.processos.list({ ...filtros, page: pagina, pageSize: limite, order: "desc" } as unknown as ProcessoListQuery);
    return { dados: { processos: (r.data as unknown as Linha[]).map((p) => resumoProcesso(ctx, p)), meta: meta(pagina, limite, r.meta.total as number), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarProcesso = definir({
  nome: "consultar_processo",
  titulo: "Consultar processo seletivo",
  descricao: `Detalhe de UM processo seletivo: etapa atual, vínculos (candidato, empresa, vaga, contratação), datas, referência do CRM e histórico de movimentações. ${DESC}`,
  modulo: "processos", paginas: PAG_PROC, consumo: "puro",
  entrada: z.object({ id_processo: z.string().trim().uuid("Informe o id do processo (uuid).") }).strict(),
  saida: z.object({
    processo: itemProcesso, historico: z.array(z.object({ etapa: z.string().nullable(), observacao: z.string().nullable(), em: z.string().nullable() }).strict()), ausentes: saidaAusentes, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { id_processo }) {
    const p = (await ctx.servicos.processos.get(id_processo)) as unknown as Linha;
    const processo = resumoProcesso(ctx, p);
    const historico = ((p.historico ?? []) as Linha[]).slice(-30).map((m) => ({ etapa: limpar(m.etapa, 60), observacao: textoSeguro(m.observacao, 400), em: dataIso(m.criado_em) }));
    return { dados: { processo, historico, ausentes: ausentesDe({ deal_id: processo.referencias.deal_id, id_contratacao: processo.id_contratacao, encaminhado_em: processo.encaminhado_em }, ["deal_id", "id_contratacao", "encaminhado_em"]), aviso: AVISO_TEXTO_LIVRE } };
  },
});

// ---------------------------------------------------------------- contratações

const itemContratacao = z.object({
  id_contratacao: z.number(),
  candidato: z.object({ id_candidato: z.string().nullable(), nome: z.string().nullable(), link: saidaLink }).strict(),
  empresa: z.object({ id_empresa: z.string().nullable(), nome: z.string().nullable(), link: saidaLink }).strict(),
  vaga: z.object({ id_vaga: z.string().nullable(), cargo: z.string().nullable(), link: saidaLink }).strict(),
  modalidade: z.string().nullable(), regime: z.string().nullable(), carga_horaria: z.string().nullable(), situacao: z.string().nullable(),
  data_contratacao: z.string().nullable(), data_inicio: z.string().nullable(), data_fim_prevista: z.string().nullable(), data_encerramento: z.string().nullable(), link: saidaLink,
}).strict();

/** Sem candidato_cpf, salario e salario_legado. */
function resumoContratacao(ctx: ContextoFerramenta, c: Linha) {
  const idC = idTexto(c.id_candidato); const idE = idTexto(c.id_empresa); const idV = idTexto(c.id_vaga);
  return {
    id_contratacao: Number(c.id_contratacao),
    candidato: { id_candidato: idC, nome: limpar(c.candidato_nome, 120), link: idC ? ctx.link("candidatos", idC) : null },
    empresa: { id_empresa: idE, nome: limpar(c.empresa_fantasia ?? c.empresa_razao, 120), link: idE ? ctx.link("empresas", idE) : null },
    vaga: { id_vaga: idV, cargo: limpar(c.cargo, 120), link: idV ? ctx.link("vagas", idV) : null },
    modalidade: limpar(c.modalidade, 40), regime: limpar(c.regime, 30), carga_horaria: limpar(c.carga_horaria, 40), situacao: limpar(c.situacao, 30),
    data_contratacao: dataIso(c.data_contratacao), data_inicio: dataIso(c.data_inicio), data_fim_prevista: dataIso(c.data_fim_prevista), data_encerramento: dataIso(c.data_encerramento),
    link: ctx.link("contratacoes", String(c.id_contratacao)),
  };
}

export const listarContratacoes = definir({
  nome: "listar_contratacoes",
  titulo: "Listar contratações",
  descricao: `Lista contratações (mais recentes primeiro) por empresa, vaga, candidato, regime, situação ou período de início. A busca livre (q) é por nome/cargo e NÃO aceita números de documento. ${DESC}`,
  modulo: "contratacoes", paginas: PAG_CONTR, consumo: "puro",
  entrada: z.object({
    q: z.string().trim().min(2).max(80).refine((t) => !/\d{4,}/.test(t), "A busca por números de documento não é permitida.").optional().describe("Nome do candidato, empresa ou cargo."),
    id_empresa: z.string().trim().min(1).max(40).optional(), id_vaga: z.string().trim().min(1).max(64).optional(), id_candidato: z.string().trim().min(1).max(64).optional(),
    regime: z.enum(["clt", "estagio"]).optional(), situacao: z.enum(["ativa", "encerrada"]).optional(),
    inicio_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), inicio_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ...entradaPagina,
  }).strict(),
  saida: z.object({ contratacoes: z.array(itemContratacao), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const { pagina, limite, situacao, ...filtros } = e;
    const status = situacao === "ativa" ? 1 : situacao === "encerrada" ? 2 : undefined;
    const r = await ctx.servicos.contratacoes.list({ ...filtros, ...(status ? { status } : {}), page: pagina, pageSize: limite, sort: "data_inicio", order: "desc" } as unknown as ContratacaoListQuery);
    return { dados: { contratacoes: (r.data as unknown as Linha[]).map((c) => resumoContratacao(ctx, c)), meta: meta(pagina, limite, r.meta.total as number), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarContratacao = definir({
  nome: "consultar_contratacao",
  titulo: "Consultar contratação",
  descricao: `Detalhe de UMA contratação (candidato, empresa, vaga, regime, situação e datas). Não inclui salário, CPF, documentos, assinatura nem rescisão. ${DESC}`,
  modulo: "contratacoes", paginas: PAG_CONTR, consumo: "puro",
  entrada: z.object({ id_contratacao: z.number().int().min(1).max(2_000_000_000) }).strict(),
  saida: z.object({ contratacao: itemContratacao, ausentes: saidaAusentes, aviso: saidaAviso }).strict(),
  async executar(ctx, { id_contratacao }) {
    const c = (await ctx.servicos.contratacoes.get(id_contratacao)) as unknown as Linha | null;
    if (!c) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    const contratacao = resumoContratacao(ctx, c);
    return { dados: { contratacao, ausentes: ausentesDe(contratacao as Linha, ["data_inicio", "data_fim_prevista", "data_encerramento", "carga_horaria"]), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const ferramentasProcessos = [listarProcessos, consultarProcesso, listarContratacoes, consultarContratacao];
