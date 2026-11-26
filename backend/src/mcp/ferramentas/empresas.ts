import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { EmpresaListQuery } from "../../schemas/empresa.js";
import type { ContextoFerramenta } from "../registro.js";
import { AVISO_TEXTO_LIVRE, ausentesDe, entradaPagina, limpar, meta, numeroOuNull, saidaAusentes, saidaAviso, saidaLink, saidaMeta } from "./comum.js";
import { consultarVagas, resumoVaga } from "./vagas.js";
import { definir } from "./tipos.js";

type Linha = Record<string, unknown>;

/**
 * Empresa sem CNPJ, e-mail, telefone, responsável, observações, matriz, endereço completo, cobrança ou portal.
 * Usa o REPOSITORY (só SELECT): EmpresaService.list/get criam tabela e limpam senha de envio ao ler.
 */
const itemEmpresa = z.object({
  id_empresa: z.string(), nome: z.string().nullable(), bairro: z.string().nullable(), cidade: z.string().nullable(), uf: z.string().nullable(),
  site: z.string().nullable(), status: z.number().nullable(), link: saidaLink,
}).strict();

const resumoEmpresa = (ctx: ContextoFerramenta, r: Linha) => ({
  id_empresa: String(r.id_empresa),
  nome: limpar(r.nome_fantasia ?? r.razao_social, 120),
  bairro: limpar(r.bairro, 80), cidade: limpar(r.cidade, 80), uf: limpar(r.uf, 2),
  site: limpar(r.site, 200), status: numeroOuNull(r.status),
  link: ctx.link("empresas", String(r.id_empresa)),
});

const DESC = "Só leitura. Não há dados financeiros, bancários ou de cobrança nesta ferramenta; não invente informações ausentes.";
const PAGINAS = ["empresas"] as const;

export const buscarEmpresas = definir({
  nome: "buscar_empresas",
  titulo: "Buscar empresas",
  descricao: `Busca empresas parceiras pelo nome (fantasia ou razão social), cidade ou UF. Devolve identificação e localização (bairro/cidade/UF). ${DESC}`,
  modulo: "empresas", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({
    nome: z.string().trim().min(2).max(80).optional().describe("Parte do nome da empresa."),
    cidade: z.string().trim().min(2).max(80).optional(), uf: z.string().trim().length(2).optional(), ...entradaPagina,
  }).strict(),
  saida: z.object({ empresas: z.array(itemEmpresa), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = await ctx.servicos.empresas.list(ctx.servicos.db, { q: e.nome, cidade: e.cidade, uf: e.uf?.toUpperCase(), page: e.pagina, pageSize: e.limite, order: "asc" } as unknown as EmpresaListQuery);
    return { dados: { empresas: (r.rows as unknown as Linha[]).map((x) => resumoEmpresa(ctx, x)), meta: meta(e.pagina, e.limite, r.total), aviso: AVISO_TEXTO_LIVRE } };
  },
});

async function totaisPorSituacao(ctx: ContextoFerramenta, idEmpresa: string) {
  const resultado = {} as Record<"aberta" | "pausada" | "contratada" | "fechada", number>;
  for (const situacao of ["aberta", "pausada", "contratada", "fechada"] as const) {
    const r = await consultarVagas(ctx, { id_empresa: idEmpresa, situacao, pagina: 1, limite: 1 });
    resultado[situacao] = r.total;
  }
  return resultado;
}
const saidaContagem = z.object({ aberta: z.number(), pausada: z.number(), contratada: z.number(), fechada: z.number() }).strict();

export const consultarEmpresa = definir({
  nome: "consultar_empresa",
  titulo: "Consultar empresa",
  descricao: `Dados públicos de UMA empresa (nome, localização, site, situação) e quantas vagas ela tem por situação. ${DESC}`,
  modulo: "empresas", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({ id_empresa: z.string().trim().min(1).max(40) }).strict(),
  saida: z.object({ empresa: itemEmpresa, vagas: saidaContagem, ausentes: saidaAusentes, aviso: saidaAviso }).strict(),
  async executar(ctx, { id_empresa }) {
    const row = await ctx.servicos.empresas.findById(ctx.servicos.db, id_empresa);
    if (!row) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const empresa = resumoEmpresa(ctx, row as unknown as Linha);
    return { dados: { empresa, vagas: await totaisPorSituacao(ctx, id_empresa), ausentes: ausentesDe(empresa as Linha, ["nome", "cidade", "uf", "bairro", "site"]), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarVagasEmpresa = definir({
  nome: "consultar_vagas_empresa",
  titulo: "Consultar vagas de uma empresa",
  descricao: `Resumo de uma empresa com a contagem de vagas por situação e a lista das vagas (abertas por padrão). Use para ver o que a empresa está contratando. ${DESC}`,
  modulo: "empresas", paginas: PAGINAS, consumo: "puro",
  entrada: z.object({ id_empresa: z.string().trim().min(1).max(40), situacao: z.enum(["aberta", "pausada", "contratada", "fechada"]).default("aberta"), ...entradaPagina }).strict(),
  saida: z.object({
    empresa: itemEmpresa, contagem: saidaContagem, vagas: z.array(z.record(z.unknown())), meta: saidaMeta, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, e) {
    const row = await ctx.servicos.empresas.findById(ctx.servicos.db, e.id_empresa);
    if (!row) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const lista = await consultarVagas(ctx, { id_empresa: e.id_empresa, situacao: e.situacao, pagina: e.pagina, limite: e.limite });
    return {
      dados: {
        empresa: resumoEmpresa(ctx, row as unknown as Linha), contagem: await totaisPorSituacao(ctx, e.id_empresa),
        vagas: lista.itens.map((v) => resumoVaga(ctx, v)), meta: meta(e.pagina, e.limite, lista.total), aviso: AVISO_TEXTO_LIVRE,
      },
    };
  },
});

export const ferramentasEmpresas = [buscarEmpresas, consultarEmpresa, consultarVagasEmpresa];
