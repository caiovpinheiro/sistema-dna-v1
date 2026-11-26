import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { CandidatoListQuery } from "../../schemas/candidato.js";
import type { ContextoFerramenta } from "../registro.js";
import { AVISO_TEXTO_LIVRE, ausentesDe, dataIso, entradaPagina, limpar, meta, saidaAusentes, saidaAviso, saidaLink, saidaMeta, textoSeguro } from "./comum.js";
import { definir } from "./tipos.js";

type Linha = Record<string, any>;
export const PERMISSAO_CONTATO = "candidatos:contato";
const PAGINAS = ["candidatos"] as const;
const temContato = (ctx: ContextoFerramenta) => ctx.permissoes.has(PERMISSAO_CONTATO);

/**
 * Projeção mínima do candidato. NUNCA saem: CPF, RG, CTPS, nascimento/idade, sexo, estado civil, PCD, observações,
 * endereço (CEP, logradouro, número, complemento, bairro), dados bancários e PIX, documentos.
 * Celular, telefone e e-mail só com a permissão individual candidatos:contato.
 */
const contatoSaida = z.object({ celular: z.string().nullable(), telefone_fixo: z.string().nullable(), email: z.string().nullable() }).strict();
const itemCandidato = z.object({
  id_candidato: z.string(), nome: z.string().nullable(), cidade: z.string().nullable(), uf: z.string().nullable(),
  vinculo: z.string().nullable(), empresa: z.string().nullable(), cadastrado_em: z.string().nullable(),
  contratacao_atual: z.object({ ativo: z.boolean().nullable(), cargo: z.string().nullable(), empresa: z.string().nullable(), regime: z.string().nullable(), inicio: z.string().nullable() }).strict().nullable(),
  contato: contatoSaida.optional(), link: saidaLink,
}).strict();

function resumoCandidato(ctx: ContextoFerramenta, r: Linha) {
  const c = r.contrato as Linha | null | undefined;
  return {
    id_candidato: String(r.id_candidato), nome: limpar(r.nome, 120), cidade: limpar(r.cidade, 80), uf: limpar(r.estado, 2),
    vinculo: limpar(r.vinculo, 20), empresa: limpar(r.empresa_nome, 120), cadastrado_em: dataIso(r.datacadastro),
    contratacao_atual: c ? { ativo: typeof c.ativo === "boolean" ? c.ativo : null, cargo: limpar(c.cargo, 100), empresa: limpar(c.empresa, 120), regime: limpar(c.regime, 30), inicio: dataIso(c.inicio) } : null,
    ...(temContato(ctx) ? { contato: { celular: limpar(r.celular, 30), telefone_fixo: limpar(r.telefonefixo, 30), email: limpar(r.email, 120) } } : {}),
    link: ctx.link("candidatos", String(r.id_candidato)),
  };
}

const DESC = "Só leitura e com dados mínimos: sem CPF, RG, nascimento, endereço, dados bancários ou documentos. Contato (celular, e-mail) só aparece se o seu usuário tiver a permissão candidatos:contato. Não invente dados ausentes.";

export const buscarCandidatos = definir({
  nome: "buscar_candidatos",
  titulo: "Buscar candidatos",
  descricao: `Busca candidatos do painel por nome, cidade, UF, empresa, regime (clt/estagio), situação do vínculo ou tipo de vínculo (dna/empresa). Não há busca por CPF. A busca por telefone ou e-mail exige a permissão candidatos:contato. ${DESC}`,
  modulo: "candidatos", paginas: PAGINAS, consumo: "puro", permissoesIndividuais: [PERMISSAO_CONTATO],
  entrada: z.object({
    nome: z.string().trim().min(2).max(80).optional(), cidade: z.string().trim().min(2).max(80).optional(), uf: z.string().trim().length(2).optional(),
    id_empresa: z.string().trim().min(1).max(40).optional(), regime: z.enum(["clt", "estagio"]).optional(),
    situacao: z.enum(["ativo", "encerrado", "sem_vinculo"]).optional(), vinculo: z.enum(["dna", "empresa"]).optional(),
    telefone: z.string().trim().min(8).max(20).optional(), email: z.string().trim().min(5).max(120).optional(), ...entradaPagina,
  }).strict().refine((e) => Object.entries(e).some(([k, v]) => !["pagina", "limite"].includes(k) && v !== undefined), { message: "Informe ao menos um filtro (nome, cidade, empresa…)." }),
  saida: z.object({ candidatos: z.array(itemCandidato), contato_liberado: z.boolean(), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    if ((e.telefone || e.email) && !temContato(ctx)) throw new AppError(403, "PERMISSAO_CONTATO", "Buscar por telefone ou e-mail exige a permissão candidatos:contato.");
    const r = await ctx.servicos.candidatos.list({ ...e, uf: e.uf?.toUpperCase(), page: e.pagina, pageSize: e.limite, order: "asc", sort: "nome" } as unknown as CandidatoListQuery);
    return {
      dados: {
        candidatos: (r.data as Linha[]).map((c) => resumoCandidato(ctx, c)), contato_liberado: temContato(ctx),
        meta: meta(e.pagina, e.limite, r.meta.total as number), aviso: AVISO_TEXTO_LIVRE,
      },
    };
  },
});

const itemFormacao = z.object({ curso: z.string().nullable(), instituicao: z.string().nullable(), periodo: z.string().nullable(), semestre: z.string().nullable() }).strict();

export const consultarCandidato = definir({
  nome: "consultar_candidato",
  titulo: "Consultar candidato",
  descricao: `Ficha resumida de UM candidato (nome, cidade/UF, formação, vínculo, datas) e a referência do negócio no CRM (deal_id), quando houver. ${DESC}`,
  modulo: "candidatos", paginas: PAGINAS, consumo: "puro", permissoesIndividuais: [PERMISSAO_CONTATO],
  entrada: z.object({ id_candidato: z.string().trim().min(1).max(64) }).strict(),
  saida: z.object({
    candidato: itemCandidato.extend({ formacao: itemFormacao, atualizado_em: z.string().nullable() }).strict(),
    referencias: z.object({ deal_id: z.string().nullable() }).strict(), contato_liberado: z.boolean(), ausentes: saidaAusentes, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { id_candidato }) {
    const r = (await ctx.servicos.candidatos.get(id_candidato)) as unknown as Linha;
    const base = resumoCandidato(ctx, r);
    const candidato = {
      ...base, atualizado_em: dataIso(r.ultimaalteracao),
      formacao: { curso: limpar(r.curso, 120), instituicao: limpar(r.nome_escola, 120), periodo: limpar(r.periodo, 30), semestre: limpar(r.semestre, 20) },
    };
    const deal = r.atendimento?.deal_id;
    const ausentes = ausentesDe({ ...candidato, ...candidato.formacao } as Linha, ["cidade", "uf", "curso", "instituicao", "periodo"]);
    if (!temContato(ctx)) ausentes.push("contato (requer a permissão candidatos:contato)");
    return { dados: { candidato, referencias: { deal_id: deal === null || deal === undefined ? null : limpar(deal, 64) }, contato_liberado: temContato(ctx), ausentes, aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarPerfilProfissional = definir({
  nome: "consultar_perfil_profissional",
  titulo: "Consultar perfil profissional do candidato",
  descricao: `Perfil profissional de UM candidato: escolaridade, formação, objetivo, último cargo, experiências e conhecimentos cadastrados. Use para analisar requisitos de vaga. Não inclui dados pessoais nem testes comportamentais. ${DESC}`,
  modulo: "candidatos", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({ id_candidato: z.string().trim().min(1).max(64) }).strict(),
  saida: z.object({
    id_candidato: z.string(), link: saidaLink,
    perfil: z.object({
      escolaridade: z.string().nullable(), objetivo: z.string().nullable(), ultimo_cargo: z.string().nullable(), curso: z.string().nullable(),
      instituicao: z.string().nullable(), previsao_termino: z.string().nullable(),
      experiencias: z.array(z.object({ cargo: z.string().nullable(), empresa: z.string().nullable(), atribuicoes: z.string().nullable() }).strict()),
      conhecimentos: z.array(z.object({ descricao: z.string().nullable(), nivel: z.string().nullable() }).strict()),
      resumo_curriculo: z.string().nullable(),
    }).strict(),
    ausentes: saidaAusentes, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { id_candidato }) {
    const r = (await ctx.servicos.candidatos.get(id_candidato)) as unknown as Linha;
    const c = (r.curriculo ?? {}) as Linha;
    const inst = (c.instituicao ?? {}) as Linha;
    const perfil = {
      escolaridade: limpar(c.escolaridade ?? r.atendimento?.escolaridade, 100), objetivo: textoSeguro(c.objetivo, 500), ultimo_cargo: textoSeguro(c.ultimo_cargo, 120),
      curso: limpar(r.curso, 120), instituicao: limpar(inst.nome_fantasia ?? inst.razao_social ?? r.nome_escola, 120), previsao_termino: limpar(c.terminoestudo, 40),
      experiencias: ((c.experiencias ?? []) as Linha[]).slice(0, 10).map((x) => ({ cargo: textoSeguro(x.cargo, 120), empresa: textoSeguro(x.empresa, 120), atribuicoes: textoSeguro(x.atribuicoes, 600) })),
      conhecimentos: ((c.conhecimentos ?? []) as Linha[]).slice(0, 20).map((x) => ({ descricao: textoSeguro(x.descricao, 120), nivel: limpar(x.nivel, 30) })),
      resumo_curriculo: textoSeguro(r.atendimento?.resumo_cv, 1500),
    };
    return { dados: { id_candidato: String(r.id_candidato), link: ctx.link("candidatos", String(r.id_candidato)), perfil, ausentes: ausentesDe(perfil as Linha, ["escolaridade", "objetivo", "ultimo_cargo", "experiencias", "conhecimentos", "resumo_curriculo"]), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarHistoricoCandidato = definir({
  nome: "consultar_historico_candidato",
  titulo: "Histórico do candidato (processos e contratações)",
  descricao: `Histórico de UM candidato no DNA Work (cada parte só aparece se o seu usuário tem a página do módulo: Processos e Contratações): processos seletivos (etapa, empresa, vaga, datas, referência do CRM) e contratações (cargo, empresa, regime, situação, datas). Não inclui salário nem CPF. Não substitui o histórico de conversas do CRM. ${DESC}`,
  modulo: "candidatos", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({ id_candidato: z.string().trim().min(1).max(64), incluir_movimentos: z.boolean().default(false).describe("Inclui as últimas movimentações dos 5 processos mais recentes."), limite: z.number().int().min(1).max(25).default(10) }).strict(),
  saida: z.object({
    id_candidato: z.string(), link: saidaLink,
    processos: z.array(z.object({
      id: z.string(), etapa: z.string().nullable(), origem: z.string().nullable(), empresa: z.string().nullable(), cargo: z.string().nullable(), id_vaga: z.string().nullable(),
      recebido_em: z.string().nullable(), encaminhado_em: z.string().nullable(), id_contratacao: z.number().nullable(), deal_id: z.string().nullable(), link: saidaLink,
      movimentos: z.array(z.object({ etapa: z.string().nullable(), observacao: z.string().nullable(), em: z.string().nullable() }).strict()).optional(),
    }).strict()),
    contratacoes: z.array(z.object({ id_contratacao: z.number(), cargo: z.string().nullable(), empresa: z.string().nullable(), regime: z.string().nullable(), situacao: z.string().nullable(), inicio: z.string().nullable(), fim_previsto: z.string().nullable(), encerramento: z.string().nullable() }).strict()),
    secoes_omitidas: z.array(z.string()).describe("Partes não exibidas por falta de permissão no módulo correspondente."),
    aviso: saidaAviso,
  }).strict(),
  async executar(ctx, e) {
    const sv = ctx.servicos;
    const veProcessos = ctx.temPagina("processos");
    const veContratacoes = ctx.temPagina("contratacoes");
    const [proc, contr] = await Promise.all([
      veProcessos ? sv.processos.list({ id_candidato: e.id_candidato, page: 1, pageSize: e.limite, order: "desc" } as never) : Promise.resolve({ data: [] as unknown[] }),
      veContratacoes ? sv.contratacoes.listByCandidato(e.id_candidato, 1, e.limite) : Promise.resolve({ data: [] as unknown[] }),
    ]);
    const processos = [];
    let detalhados = 0;
    for (const p of proc.data as unknown as Linha[]) {
      const item: Linha = {
        id: String(p.id), etapa: limpar(p.etapa, 60), origem: limpar(p.origem, 30), empresa: limpar(p.empresa_nome, 120), cargo: limpar(p.cargo, 120),
        id_vaga: p.id_vaga === null || p.id_vaga === undefined ? null : String(p.id_vaga), recebido_em: dataIso(p.data_recebimento), encaminhado_em: dataIso(p.data_encaminhamento),
        id_contratacao: typeof p.id_contratacao === "number" ? p.id_contratacao : null, deal_id: p.atendimento?.deal_id ? limpar(p.atendimento.deal_id, 64) : null, link: ctx.link("processos", String(p.id)),
      };
      if (e.incluir_movimentos && detalhados < 5) {
        detalhados += 1;
        const d = (await sv.processos.get(String(p.id))) as unknown as Linha;
        item.movimentos = ((d.historico ?? []) as Linha[]).slice(-5).map((m) => ({ etapa: limpar(m.etapa, 60), observacao: textoSeguro(m.observacao, 300), em: dataIso(m.criado_em) }));
      }
      processos.push(item);
    }
    const contratacoes = (contr.data as unknown as Linha[]).map((c) => ({
      id_contratacao: Number(c.id_contratacao), cargo: limpar(c.cargo, 120), empresa: limpar(c.empresa_fantasia ?? c.empresa_razao, 120), regime: limpar(c.regime, 30),
      situacao: limpar(c.situacao, 30), inicio: dataIso(c.data_inicio), fim_previsto: dataIso(c.data_fim_prevista), encerramento: dataIso(c.data_encerramento),
    }));
    return { dados: { id_candidato: e.id_candidato, link: ctx.link("candidatos", e.id_candidato), processos, contratacoes, secoes_omitidas: [...(veProcessos ? [] : ["processos"]), ...(veContratacoes ? [] : ["contratacoes"])], aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const localizarCandidatoPorDeal = definir({
  nome: "localizar_candidato_por_deal",
  titulo: "Localizar candidato pelo deal_id do CRM",
  descricao:
    "Liga o CRM Bwipo ao painel DNA Work por um identificador CONFIÁVEL: o deal_id exato do negócio. Devolve o candidato do painel que tem esse deal_id gravado (id, nome e link). " +
    "Não faz correspondência por nome, telefone ou CPF: sem deal_id igual, diz que não encontrou. O histórico de conversas continua no MCP do CRM. " + DESC,
  modulo: "candidatos", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({ deal_id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, "deal_id inválido.") }).strict(),
  saida: z.object({
    encontrado: z.boolean(),
    candidato: z.object({ id_candidato: z.string(), nome: z.string().nullable(), link: saidaLink }).strict().nullable(),
    referencia: z.object({ deal_id: z.string(), tipo: z.literal("deal_id_exato") }).strict(), aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { deal_id }) {
    const r = (await ctx.servicos.processos.buscarCandidato({ dealId: deal_id })) as unknown as Linha;
    const achou = r.existe === true && r.id_candidato;
    return {
      dados: {
        encontrado: Boolean(achou),
        candidato: achou ? { id_candidato: String(r.id_candidato), nome: limpar(r.nome, 120), link: ctx.link("candidatos", String(r.id_candidato)) } : null,
        referencia: { deal_id, tipo: "deal_id_exato" as const },
        aviso: achou ? "Correspondência por deal_id exato registrado no candidato do painel." : "Nenhum candidato do painel tem este deal_id. Não foi feita busca por nome, telefone ou CPF.",
      },
    };
  },
});

export const ferramentasCandidatos = [buscarCandidatos, consultarCandidato, consultarPerfilProfissional, consultarHistoricoCandidato, localizarCandidatoPorDeal];
