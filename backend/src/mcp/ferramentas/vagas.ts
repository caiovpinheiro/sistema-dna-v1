import { z } from "zod";
import { DIAS_ESCALA, textoDoHorario } from "../../lib/horario-escala.js";
import type { VagaListQuery } from "../../schemas/vaga.js";
import type { ContextoFerramenta } from "../registro.js";
import { AVISO_TEXTO_LIVRE, LIMITE_MAXIMO, ausentesDe, dataIso, entradaPagina, limpar, meta, numeroOuNull, saidaAusentes, saidaAviso, saidaLink, saidaMeta, textoSeguro } from "./comum.js";
import { definir, semAcento } from "./tipos.js";

type Linha = Record<string, unknown>;
const PAGINAS_VAGAS = ["vagas", "vagas-modelos", "vagas-modelo"] as const;
const REGIME_TIPO = { clt: 2, estagio: 1 } as const;
const LIMITE_VARREDURA = 300;

const itemVaga = z.object({
  id_vaga: z.string(),
  cargo: z.string().nullable(),
  empresa: z.string().nullable(),
  id_empresa: z.string().nullable(),
  regime: z.string().nullable(),
  situacao: z.string().nullable(),
  remuneracao: z.number().nullable().describe("Salário/bolsa mensal em reais, quando cadastrado."),
  horario: z.string().nullable(),
  carga_horaria: z.string().nullable(),
  local: z.string().nullable().describe("Bairro, cidade e UF da vaga (não é o endereço completo)."),
  beneficios: z.string().nullable(),
  posicoes: z.object({ total: z.number().nullable(), ocupadas: z.number().nullable(), disponiveis: z.number().nullable() }).strict(),
  prioridade: z.string().nullable(),
  codigo: z.string().nullable(),
  data_abertura: z.string().nullable(),
  link: saidaLink,
}).strict();

/** Local da vaga SEM logradouro/número: só bairro e cidade/UF (o endereço da empresa não sai por esta ferramenta). */
export function localSemRua(local: unknown): string | null {
  const texto = limpar(local, 200);
  if (!texto) return null;
  const partes = texto.split(",").map((p) => p.trim()).filter(Boolean);
  return (partes.length > 2 ? partes.slice(-2) : partes).join(", ");
}

export function resumoVaga(ctx: ContextoFerramenta, r: Linha) {
  return {
    id_vaga: String(r.id_vaga),
    cargo: limpar(r.cargo, 120),
    empresa: limpar(r.empresa ?? r.nome_fantasia, 120),
    id_empresa: r.id_empresa === null || r.id_empresa === undefined ? null : String(r.id_empresa),
    regime: limpar(r.regime, 30),
    situacao: limpar(r.situacao, 30),
    remuneracao: numeroOuNull(r.salario),
    horario: limpar(r.horario, 300),
    carga_horaria: limpar(r.carga_horaria, 40),
    local: localSemRua(r.local),
    beneficios: limpar(r.beneficios, 600),
    posicoes: { total: numeroOuNull(r.quantidade_posicoes), ocupadas: numeroOuNull(r.ocupadas), disponiveis: numeroOuNull(r.disponiveis) },
    prioridade: limpar(r.prioridade, 20),
    codigo: limpar(r.codigo, 40),
    data_abertura: dataIso(r.dataabertura),
    link: ctx.link("vagas", String(r.id_vaga)),
  };
}

const filtrosBusca = {
  cargo: z.string().trim().min(2).max(80).optional().describe("Parte do nome do cargo (ex.: atendente)."),
  regime: z.enum(["clt", "estagio"]).optional().describe("Regime: CLT ou estágio."),
  empresa: z.string().trim().min(2).max(80).optional().describe("Parte do nome da empresa."),
  id_empresa: z.string().trim().min(1).max(40).optional().describe("Identificador da empresa (use quando já souber)."),
  cidade: z.string().trim().min(2).max(80).optional().describe("Cidade da vaga."),
  bairro: z.string().trim().min(2).max(80).optional().describe("Bairro da vaga."),
  remuneracao_min: z.number().min(0).max(100000).optional().describe("Remuneração mínima em reais."),
  remuneracao_max: z.number().min(0).max(100000).optional().describe("Remuneração máxima em reais."),
  beneficio: z.string().trim().min(2).max(60).optional().describe("Parte do texto de um benefício (ex.: vale refeição)."),
  horario: z.string().trim().min(2).max(60).optional().describe("Parte do texto do horário (ex.: sábado)."),
  prioridade: z.enum(["alta", "media", "baixa"]).optional(),
};

type Filtros = {
  cargo?: string; regime?: "clt" | "estagio"; empresa?: string; id_empresa?: string; cidade?: string; bairro?: string;
  remuneracao_min?: number; remuneracao_max?: number; beneficio?: string; horario?: string; prioridade?: "alta" | "media" | "baixa";
  situacao: "aberta" | "pausada" | "contratada" | "fechada"; pagina: number; limite: number;
};

/** Filtros no SQL do service; os que o service não tem (cidade, bairro, valores, benefício, horário) são aplicados sobre até 300 vagas. */
export async function consultarVagas(ctx: ContextoFerramenta, f: Filtros) {
  const base = {
    cargo: f.cargo, tipo_vaga: f.regime ? REGIME_TIPO[f.regime] : undefined, id_empresa: f.id_empresa, situacao: f.situacao,
    prioridade: f.prioridade, q: f.empresa, sort: "dataabertura", order: "desc",
  };
  const emMemoria = Boolean(f.cidade || f.bairro || f.remuneracao_min !== undefined || f.remuneracao_max !== undefined || f.beneficio || f.horario);
  const vagas = ctx.servicos.vagas;
  if (!emMemoria) {
    const r = await vagas.list({ ...base, page: f.pagina, pageSize: f.limite } as unknown as VagaListQuery);
    return { itens: r.data as Linha[], total: r.meta.total as number, limitada: false };
  }
  const todas: Linha[] = [];
  let total = 0;
  for (let p = 1; p * 100 <= LIMITE_VARREDURA; p += 1) {
    const r = await vagas.list({ ...base, page: p, pageSize: 100 } as unknown as VagaListQuery);
    todas.push(...(r.data as Linha[]));
    total = r.meta.total as number;
    if (todas.length >= total) break;
  }
  const contem = (campo: unknown, termo?: string) => !termo || semAcento(campo).includes(semAcento(termo));
  const filtradas = todas.filter((r) => {
    const salario = numeroOuNull(r.salario);
    return contem(localSemRua(r.local), f.cidade) && contem(localSemRua(r.local), f.bairro) && contem(r.beneficios, f.beneficio) && contem(r.horario, f.horario)
      && (f.remuneracao_min === undefined || (salario !== null && salario >= f.remuneracao_min))
      && (f.remuneracao_max === undefined || (salario !== null && salario <= f.remuneracao_max));
  });
  const inicio = (f.pagina - 1) * f.limite;
  return { itens: filtradas.slice(inicio, inicio + f.limite), total: filtradas.length, limitada: total > todas.length };
}

const saidaLista = z.object({ vagas: z.array(itemVaga), meta: saidaMeta, aviso: saidaAviso }).strict();
const montarLista = (ctx: ContextoFerramenta, f: Filtros, r: Awaited<ReturnType<typeof consultarVagas>>) => ({
  vagas: r.itens.map((v) => resumoVaga(ctx, v)),
  meta: meta(f.pagina, f.limite, r.total, f.pagina * f.limite < r.total, r.limitada),
  aviso: r.limitada
    ? `A busca com cidade, bairro, remuneração, benefício ou horário olha as ${LIMITE_VARREDURA} vagas mais recentes do critério; pode haver outras. ${AVISO_TEXTO_LIVRE}`
    : AVISO_TEXTO_LIVRE,
});

const DESC_USO = "Só leitura. Use os dados exatamente como vêm: não invente salário, benefícios, horário ou requisitos; se um campo vier vazio, diga que não há informação.";

export const buscarVagas = definir({
  nome: "buscar_vagas",
  titulo: "Buscar vagas",
  descricao: `Busca vagas do DNA Work por cargo, regime (CLT/estágio), empresa, cidade, bairro, remuneração, benefício, horário e situação (padrão: abertas). ${DESC_USO}`,
  modulo: "vagas", paginas: PAGINAS_VAGAS, consumo: "puro",
  entrada: z.object({ ...filtrosBusca, situacao: z.enum(["aberta", "pausada", "contratada", "fechada"]).default("aberta"), ...entradaPagina }).strict(),
  saida: saidaLista,
  async executar(ctx, f) { return { dados: montarLista(ctx, f, await consultarVagas(ctx, f)) }; },
});

export const listarVagasAbertas = definir({
  nome: "listar_vagas_abertas",
  titulo: "Listar vagas abertas",
  descricao: `Lista as vagas abertas mais recentes, opcionalmente só CLT ou só estágio. Para filtrar por cargo, local ou salário use buscar_vagas. ${DESC_USO}`,
  modulo: "vagas", paginas: PAGINAS_VAGAS, consumo: "puro",
  entrada: z.object({ regime: z.enum(["clt", "estagio"]).optional(), ...entradaPagina }).strict(),
  saida: saidaLista,
  async executar(ctx, e) { const f: Filtros = { ...e, situacao: "aberta" }; return { dados: montarLista(ctx, f, await consultarVagas(ctx, f)) }; },
});

export const listarVagasPorEmpresa = definir({
  nome: "listar_vagas_por_empresa",
  titulo: "Listar vagas por empresa",
  descricao: `Lista as vagas de uma empresa, pelo identificador (id_empresa) ou por parte do nome. Para dados da empresa use consultar_empresa. ${DESC_USO}`,
  modulo: "vagas", paginas: PAGINAS_VAGAS, consumo: "puro",
  entrada: z.object({
    id_empresa: z.string().trim().min(1).max(40).optional(), empresa: z.string().trim().min(2).max(80).optional(),
    situacao: z.enum(["aberta", "pausada", "contratada", "fechada"]).default("aberta"), ...entradaPagina,
  }).strict().refine((e) => e.id_empresa || e.empresa, { message: "Informe id_empresa ou empresa." }),
  saida: saidaLista,
  async executar(ctx, e) { const f: Filtros = { ...e }; return { dados: montarLista(ctx, f, await consultarVagas(ctx, f)) }; },
});

const beneficiosEmLista = (v: unknown): string[] => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map((b) => limpar(b, 200)).filter((b): b is string => Boolean(b)).slice(0, 20);

export const consultarVaga = definir({
  nome: "consultar_vaga",
  titulo: "Consultar vaga completa",
  descricao: `Ficha completa e atualizada de UMA vaga (cargo, empresa, remuneração, benefícios, horário e carga horária, localização, atribuições, requisitos, situação e posições). Use para apresentar a vaga ao candidato. ${DESC_USO}`,
  modulo: "vagas", paginas: PAGINAS_VAGAS, consumo: "puro",
  entrada: z.object({ id_vaga: z.string().trim().min(1).max(64).describe("Identificador da vaga (id_vaga).") }).strict(),
  saida: z.object({
    vaga: itemVaga.extend({
      atribuicoes: z.string().nullable(), requisitos_desejaveis: z.string().nullable(),
      beneficios_lista: z.array(z.string()), horario_detalhado: z.string().nullable(),
    }).strict(),
    ausentes: saidaAusentes, aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { id_vaga }) {
    const r = (await ctx.servicos.vagas.get(id_vaga)) as unknown as Linha;
    const base = resumoVaga(ctx, r);
    // A ficha só traz o local do endereço próprio da vaga; sem ele, usa bairro/cidade/UF da empresa (como a lista do painel).
    if (!base.local && base.id_empresa && ctx.servicos.empresas) {
      const emp = (await ctx.servicos.empresas.findById(ctx.servicos.db, base.id_empresa)) as unknown as Linha | null;
      if (emp) base.local = localSemRua([emp.bairro, [emp.cidade, emp.uf].filter(Boolean).join("/")].filter(Boolean).join(", "));
    }
    const vaga = {
      ...base,
      atribuicoes: textoSeguro(r.atribuicaoes, 2000),
      requisitos_desejaveis: textoSeguro(r.requisitos_desejaveis, 1500),
      beneficios_lista: beneficiosEmLista(r.beneficios),
      horario_detalhado: limpar(r.texto_carga, 300),
    };
    const ausentes = [...ausentesDe(vaga as Linha, ["remuneracao", "horario", "local", "beneficios", "atribuicoes", "requisitos_desejaveis", "carga_horaria"]), "data_atualizacao"];
    return { dados: { vaga, ausentes, aviso: AVISO_TEXTO_LIVRE } };
  },
});

const itemModelo = z.object({
  vaga_id: z.string(), tipo: z.string(), cargo: z.string().nullable(), descricao: z.string().nullable(), requisitos: z.string().nullable(),
  atividades: z.string().nullable(), salario: z.string().nullable(), carga_horaria: z.string().nullable(), horario: z.string().nullable(),
  beneficios: z.string().nullable(), escala: z.array(z.string()), folga: z.array(z.string()),
}).strict();

export const consultarModeloVaga = definir({
  nome: "consultar_modelo_vaga",
  titulo: "Consultar modelo de vaga",
  descricao: `Consulta os MODELOS de vaga por cargo (descrição padrão, requisitos, atividades, salário-base, carga horária, horário e escala). É o texto-base do cargo, não uma vaga aberta. ${DESC_USO}`,
  modulo: "vagas", paginas: ["vagas-modelos", "vagas-modelo", "vagas"], consumo: "puro",
  entrada: z.object({
    cargo: z.string().trim().min(2).max(80).optional(), regime: z.enum(["clt", "estagio"]).optional(),
    vaga_id: z.string().trim().min(1).max(64).optional(), ...entradaPagina,
  }).strict(),
  saida: z.object({ modelos: z.array(itemModelo), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(_ctx, e) {
    const r = await _ctx.servicos.cadastro.modelosSomenteLeitura({ cargo: e.cargo, tipo: e.regime, vagaId: e.vaga_id, limite: e.limite, offset: (e.pagina - 1) * e.limite });
    const modelos = r.modelos.map((m) => {
      const f = m.formulario as Record<string, any>;
      const horario = textoDoHorario(DIAS_ESCALA.map((dia) => ({ modo: (f.folga ?? []).includes(dia) ? "folga" : (f.escala ?? []).includes(dia) ? "escala" : "fixo", entrada: f[`${dia}_entrada`], saida: f[`${dia}_saida`] })) as never);
      return {
        vaga_id: m.vagaId, tipo: m.tipo, cargo: limpar(f.cargo, 120), descricao: textoSeguro(f.descricao, 2000), requisitos: textoSeguro(f.requisitos, 2000),
        atividades: textoSeguro(f.atividades, 2000), salario: m.salarioTexto, carga_horaria: limpar(f.carga_horaria, 40), horario: limpar(horario, 300),
        beneficios: textoSeguro(f.beneficios, 600), escala: (f.escala ?? []).map(String), folga: (f.folga ?? []).map(String),
      };
    });
    return { dados: { modelos, meta: meta(e.pagina, e.limite, r.total), aviso: AVISO_TEXTO_LIVRE } };
  },
});

export const consultarFiltrosVagas = definir({
  nome: "consultar_filtros_vagas",
  titulo: "Consultar filtros de vagas",
  descricao: `Lista as opções válidas para filtrar vagas: empresas, grupos de empresas, cargos, regimes e situações. Use antes de buscar vagas, para descobrir nomes e identificadores válidos. ${DESC_USO}`,
  modulo: "vagas", paginas: PAGINAS_VAGAS, consumo: "puro",
  entrada: z.object({
    limite: z.number().int().min(1).max(200).default(50).describe("Máximo de itens por lista (1 a 200)."),
    busca: z.string().trim().min(1).max(80).optional().describe("Texto para filtrar pelo nome (opcional)."),
  }).strict(),
  saida: z.object({
    empresas: z.array(z.object({ id: z.string(), nome: z.string() }).strict()),
    grupos: z.array(z.object({ id: z.string(), nome: z.string() }).strict()),
    cargos: z.array(z.object({ chave: z.string(), nome: z.string() }).strict()),
    regimes: z.array(z.string()), situacoes: z.array(z.string()), prioridades: z.array(z.string()),
    total: z.object({ empresas: z.number(), grupos: z.number(), cargos: z.number() }).strict(), truncado: z.boolean(),
  }).strict(),
  async executar(ctx, { limite, busca }) {
    const bruto = await ctx.servicos.vagas.opcoesFiltro();
    const filtro = (nome: string | null | undefined) => !busca || semAcento(nome).includes(semAcento(busca));
    const empresas = bruto.empresas.filter((i) => filtro(i.nome));
    const grupos = bruto.grupos.filter((i) => filtro(i.nome));
    const cargos = bruto.cargos.filter((i) => filtro(i.nome));
    return {
      dados: {
        empresas: empresas.slice(0, limite).map((i) => ({ id: i.id, nome: i.nome })),
        grupos: grupos.slice(0, limite).map((i) => ({ id: i.id, nome: i.nome })),
        cargos: cargos.slice(0, limite).map((i) => ({ chave: i.chave, nome: i.nome })),
        regimes: ["clt", "estagio"], situacoes: ["aberta", "pausada", "contratada", "fechada"], prioridades: ["alta", "media", "baixa"],
        total: { empresas: empresas.length, grupos: grupos.length, cargos: cargos.length },
        truncado: empresas.length > limite || grupos.length > limite || cargos.length > limite,
      },
    };
  },
});

export const ferramentasVagas = [buscarVagas, consultarVaga, listarVagasAbertas, consultarModeloVaga, listarVagasPorEmpresa, consultarFiltrosVagas];
void LIMITE_MAXIMO;
