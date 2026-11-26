import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { AVISO_TEXTO_LIVRE, ausentesDe, foraDaAbrangencia, limpar, redigirPii, saidaAusentes, saidaAviso, saidaLink, semCaracteristicasProtegidas, textoSeguro } from "./comum.js";
import { PERMISSAO_CONTATO } from "./candidatos.js";
import { definir } from "./tipos.js";
import type { ContextoFerramenta } from "../registro.js";

type Linha = Record<string, any>;
const DEAL = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, "deal_id inválido.").describe("Identificador do negócio no CRM (deal_id).");

/** Abrangência `autorizados`: o deal_id precisa levar a um candidato do painel que o administrador autorizou. Sem vínculo verificável, nega. */
async function conferirDeal(ctx: ContextoFerramenta, dealId: string): Promise<void> {
  if (ctx.escopo.tipo === "todos") return;
  const r = (await ctx.servicos.processos.buscarCandidato({ dealId })) as unknown as Linha;
  if (!(r.existe === true && r.id_candidato && ctx.escopo.candidatoPermitido(String(r.id_candidato)))) throw foraDaAbrangencia();
}

export const consultarDadosDossie = definir({
  nome: "consultar_dados_dossie",
  titulo: "Consultar dados do dossiê",
  descricao:
    "Mostra os dados que alimentam o dossiê de um candidato, localizados pelo deal_id EXATO do CRM (tabela de dados da triagem): nome, escolaridade, turno, tipo de vaga, vaga escolhida e resumos do currículo e da entrevista. " +
    "Não há busca por telefone/nome. Não inclui sexo, idade, CEP nem testes comportamentais. Só leitura, sem CRM e sem gerar nada. Não invente campos ausentes.",
  modulo: "dossies", paginas: ["triagem"], consumo: "puro", permissoesIndividuais: [PERMISSAO_CONTATO], dados: "registro",
  entrada: z.object({ deal_id: DEAL }).strict(),
  saida: z.object({
    encontrado: z.boolean(),
    dados: z.object({
      deal_id: z.string(), nome: z.string().nullable(), escolaridade: z.string().nullable(), turno: z.string().nullable(), tipo_de_vaga: z.string().nullable(),
      id_vaga_escolhida: z.string().nullable(), id_empresa: z.string().nullable(), resumo_curriculo: z.string().nullable(), resumo_entrevista: z.string().nullable(),
      telefone: z.string().nullable().optional(),
    }).strict().nullable(),
    vaga_escolhida: z.object({ id_vaga: z.string(), link: saidaLink }).strict().nullable(),
    ausentes: saidaAusentes, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { deal_id }) {
    await conferirDeal(ctx, deal_id);
    const r = (await ctx.servicos.dossie.dadosDoCandidato(deal_id, null)) as unknown as Linha | null;
    if (!r) return { dados: { encontrado: false, dados: null, vaga_escolhida: null, ausentes: ["todos os dados (deal_id sem registro na triagem)"], aviso: "Nenhum registro com este deal_id. Não foi feita busca por outros dados." } };
    const id = (v: unknown) => (v === null || v === undefined || v === "" ? null : limpar(v, 64));
    const dados: Linha = {
      deal_id, nome: limpar(r.nome, 120), escolaridade: limpar(r.escolaridade, 100), turno: limpar(r.turno, 40), tipo_de_vaga: limpar(r.tipo_de_vaga, 40),
      id_vaga_escolhida: id(r.id_vaga_escolhida), id_empresa: id(r.id_empresa), resumo_curriculo: textoSeguro(r.resumo_cv, 3000), resumo_entrevista: textoSeguro(r.resumo_entrevista, 2000),
    };
    if (ctx.permissoes.has(PERMISSAO_CONTATO)) dados.telefone = r.telefone === null || r.telefone === undefined ? null : limpar(String(r.telefone), 30);
    const ausentes = ausentesDe(dados, ["nome", "escolaridade", "turno", "id_vaga_escolhida", "resumo_curriculo", "resumo_entrevista"]);
    if (!ctx.permissoes.has(PERMISSAO_CONTATO)) ausentes.push("telefone (requer a permissão candidatos:contato)");
    return { dados: { encontrado: true, dados, vaga_escolhida: dados.id_vaga_escolhida ? { id_vaga: dados.id_vaga_escolhida, link: ctx.link("vagas", dados.id_vaga_escolhida) } : null, ausentes, aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const gerarDossie = definir({
  nome: "gerar_dossie",
  titulo: "Gerar dossiê do candidato para uma vaga",
  descricao:
    "Gera o TEXTO do dossiê de um candidato para uma vaga (modelo CLT ou estágio), a partir dos dados da triagem (deal_id) e da vaga. NÃO grava nota no CRM nem altera nenhum dado: devolve só o texto para o colaborador revisar. " +
    "Envia o nome e o resumo do currículo (sem contatos, sem sexo e sem idade) a um serviço de IA externo, tem custo e limite de uso por hora. O dossiê é rascunho para revisão humana.",
  modulo: "dossies", paginas: ["triagem"], consumo: "servico_externo", limitePorHora: 20, dados: "registro",
  entrada: z.object({ deal_id: DEAL, id_vaga: z.string().trim().min(1).max(64).describe("Vaga (id_vaga) para a qual o dossiê será escrito.") }).strict(),
  saida: z.object({
    dossie: z.string(), tipo: z.string(), modelo: z.string(), curriculo_origem: z.string(),
    vaga: z.object({ id_vaga: z.string(), cargo: z.string().nullable(), empresa: z.string().nullable(), regime: z.string().nullable(), local: z.string().nullable(), link: saidaLink }).strict(),
    gravado_no_crm: z.literal(false), dados_enviados_a_ia: z.object({ campos: z.array(z.string()), trechos_removidos: z.number().int() }).strict(), aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { deal_id, id_vaga }) {
    await conferirDeal(ctx, deal_id);
    const r = (await ctx.servicos.dossie.dadosDoCandidato(deal_id, null)) as unknown as Linha | null;
    if (!r) throw new AppError(404, "DADOS_NAO_ENCONTRADOS", "Não há dados da triagem para este deal_id.");
    // Minimização: só nome, escolaridade e turno + resumos sem PII e sem trechos sobre características protegidas. Sem dealId na chamada:
    // o serviço não consulta o CRM e não usa sexo/idade do cadastro.
    let removidos = 0;
    const preparar = (t: unknown) => { const x = semCaracteristicasProtegidas(redigirPii(String(t ?? ""))); removidos += x.removidos; return x.texto; };
    const partes = [["RESUMO DO CURRÍCULO", preparar(r.resumo_cv)], ["RESUMO DA ENTREVISTA", preparar(r.resumo_entrevista)]].filter(([, t]) => t);
    const texto = partes.map(([t, v]) => `${t}:\n${v}`).join("\n\n");
    if (texto.length < 30) throw new AppError(422, "SEM_CURRICULO", "Os dados da triagem não têm resumo de currículo suficiente para gerar o dossiê.");
    const resultado = await ctx.servicos.dossie.gerar({
      vagaId: id_vaga, manual: { nome: limpar(r.nome, 120) ?? undefined, escolaridade: limpar(r.escolaridade, 100) ?? undefined, turno: limpar(r.turno, 40) ?? undefined },
      curriculo: { tipo: "texto", texto: texto.slice(0, 12000) },
    } as never);
    const v = resultado.vaga as unknown as Linha;
    return {
      dados: {
        dossie: redigirPii(resultado.dossie).slice(0, 12000), tipo: String(resultado.tipo), modelo: String(resultado.modelo), curriculo_origem: "banco da triagem (deal_id)",
        vaga: { id_vaga: String(v.id), cargo: limpar(v.cargo, 120), empresa: limpar(v.empresa, 120), regime: limpar(v.tipo, 30), local: limpar(v.local, 200), link: ctx.link("vagas", String(v.id)) },
        gravado_no_crm: false as const,
        dados_enviados_a_ia: { campos: ["nome", "escolaridade", "turno", "resumo_curriculo", "resumo_entrevista", "dados da vaga"], trechos_removidos: removidos },
        aviso: "Rascunho gerado por IA para revisão humana. Nada foi gravado no CRM nem no painel; para registrar, use o fluxo do painel.",
      },
    };
  },
});

export const ferramentasDossies = [consultarDadosDossie, gerarDossie];
