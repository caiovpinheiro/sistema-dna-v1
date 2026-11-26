import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { AVISO_TEXTO_LIVRE, entradaPagina, limpar, meta, redigirPii, saidaAviso, saidaLink, saidaMeta, semCaracteristicasProtegidas, textoSeguro } from "./comum.js";
import { definir } from "./tipos.js";
import { localSemRua } from "./vagas.js";

type Linha = Record<string, unknown>;
const MAX_RESULTADOS = 100;
/** O rótulo do CEP vem como "Rua, Bairro - Cidade/UF": mantém só bairro e cidade (o logradouro do CEP do candidato não sai). */
const origemSemRua = (v: unknown) => { const t = limpar(v, 160); if (!t) return null; const i = t.indexOf(","); return i >= 0 ? t.slice(i + 1).trim() : t; };

const itemCep = z.object({
  id_vaga: z.string(), cargo: z.string().nullable(), empresa: z.string().nullable(), local: z.string().nullable(), regime: z.string().nullable(),
  remuneracao: z.string().nullable(), tem_beneficios: z.boolean(), home_office: z.boolean(), horario: z.string().nullable(),
  distancia_km: z.number().nullable(), prioridade: z.string().nullable(), link: saidaLink,
}).strict();

export const buscarVagasPorCep = definir({
  nome: "buscar_vagas_por_cep",
  titulo: "Buscar vagas por CEP",
  descricao:
    "Encontra vagas abertas perto de um CEP, ordenadas por prioridade e distância. Só leitura: NÃO sincroniza nem grava nada no sistema. " +
    "Consulta serviços externos de CEP/mapas e por isso tem limite de uso por hora. O filtro é só local e regime (não usa sexo nem idade). " +
    "Não invente vagas, valores ou horários: use o que vier.",
  modulo: "triagem", paginas: ["triagem"], consumo: "servico_externo", limitePorHora: 60,
  entrada: z.object({
    cep: z.string().transform((v) => v.replace(/\D/g, "")).pipe(z.string().length(8, "Informe um CEP com 8 dígitos.")).describe("CEP do candidato (8 dígitos)."),
    raio_km: z.number().min(1).max(50).default(10).describe("Raio de busca em km (1 a 50)."),
    regimes: z.array(z.enum(["clt", "estagio"])).min(1).default(["clt", "estagio"]), ...entradaPagina,
  }).strict(),
  saida: z.object({ origem: z.string().nullable(), vagas: z.array(itemCep), meta: saidaMeta, aviso: saidaAviso }).strict(),
  async executar(ctx, e) {
    const r = await ctx.servicos.triagem.buscarSemSincronizar({ cep: e.cep, raioKm: e.raio_km, tipos: e.regimes.map((x) => (x === "clt" ? "CLT" : "Estágio")) } as never);
    const todos = (r.jobs as unknown as Linha[]).slice(0, MAX_RESULTADOS);
    const inicio = (e.pagina - 1) * e.limite;
    return {
      dados: {
        origem: origemSemRua(r.originLabel),
        vagas: todos.slice(inicio, inicio + e.limite).map((j) => ({
          id_vaga: String(j.id), cargo: limpar(j.title, 120), empresa: limpar(j.company, 120), local: localSemRua(j.location),
          regime: limpar(j.contractType, 30), remuneracao: limpar(j.salaryLabel, 60), tem_beneficios: j.hasBenefits === true, home_office: j.homeOffice === true,
          horario: limpar(j.schedule, 300), distancia_km: typeof j.distanceKm === "number" ? j.distanceKm : null, prioridade: limpar(j.prioridade, 20),
          link: ctx.link("vagas", String(j.id)),
        })),
        meta: meta(e.pagina, e.limite, todos.length, inicio + e.limite < todos.length, (r.jobs as unknown[]).length > MAX_RESULTADOS),
        aviso: `Distância em linha reta a partir do CEP. ${AVISO_TEXTO_LIVRE}`,
      },
    };
  },
});

const ESCOLARIDADES = ["medio_incompleto", "medio_completo", "cursando_medio", "cursando_superior", "superior_completo"] as const;
const AVISO_COMPAT =
  "Apoio à análise HUMANA: mostra, por vaga, trechos verificáveis do que o profissional informou e o que não foi comprovado. " +
  "Não é aprovação, reprovação, ranking nem decisão de contratação; a decisão é sempre de uma pessoa.";

const itemCompat = z.object({
  id_vaga: z.string(), link: saidaLink,
  situacao: z.enum(["avaliada", "indisponivel", "dados_insuficientes", "falhou", "resposta_invalida", "nao_encontrada"]),
  motivo: z.string().nullable(),
  aderencia: z.string().nullable().describe("Nível de aderência indicado, em texto (não é nota)."),
  trechos_favoraveis: z.array(z.object({ requisito: z.string(), termos_no_perfil: z.array(z.string()) }).strict()),
  requisitos_nao_comprovados: z.array(z.string()),
  notas: z.array(z.string()),
}).strict();

export const consultarCompatibilidadeProfissional = definir({
  nome: "consultar_compatibilidade_profissional",
  titulo: "Compatibilidade profissional (apoio à análise humana)",
  descricao:
    "Compara o PERFIL PROFISSIONAL informado (escolaridade, experiência, habilidades, resumo) com os requisitos de até 10 vagas e mostra, para revisão humana, os requisitos que o perfil comprova e os que não comprova. " +
    "Informe SOMENTE dados profissionais: não envie nome, contatos, documentos, sexo, idade, estado civil, saúde, religião ou outras características pessoais (trechos assim são removidos antes do envio). " +
    "Não use o resultado para excluir, ranquear ou contratar candidatos. Envia dados a um serviço externo de avaliação e tem limite de uso por hora.",
  modulo: "triagem", paginas: ["triagem"], consumo: "servico_externo", limitePorHora: 30,
  entrada: z.object({
    vaga_ids: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
    escolaridade: z.enum(ESCOLARIDADES).optional(),
    tempo_experiencia: z.string().trim().max(200).optional().describe("Ex.: '2 anos como atendente'."),
    habilidades: z.string().trim().max(1500).optional().describe("Habilidades e conhecimentos profissionais."),
    resumo_profissional: z.string().trim().max(4000).optional().describe("Resumo de experiências e formação, sem dados pessoais."),
  }).strict().refine((e) => e.escolaridade || e.tempo_experiencia || e.habilidades || e.resumo_profissional, { message: "Informe ao menos um dado profissional." }),
  saida: z.object({
    avaliacoes: z.array(itemCompat),
    dados_enviados: z.object({ campos: z.array(z.string()), trechos_removidos: z.number().int(), dados_pessoais_mascarados: z.boolean() }).strict(),
    aviso: saidaAviso,
  }).strict(),
  async executar(ctx, e) {
    // Minimização: máscara de PII e remoção de trechos com características protegidas ANTES de qualquer envio ao JEV.
    let removidos = 0;
    let mascarado = false;
    const preparar = (texto?: string) => {
      if (!texto) return "";
      const redigido = redigirPii(texto);
      if (redigido !== texto) mascarado = true;
      const r = semCaracteristicasProtegidas(redigido);
      removidos += r.removidos;
      return r.texto;
    };
    const perfil = { escolaridade: e.escolaridade ?? "", tempoExperiencia: preparar(e.tempo_experiencia), habilidades: preparar(e.habilidades), curriculo: preparar(e.resumo_profissional) };
    const r = await ctx.servicos.matching.avaliar({ perfil: perfil as never, vagaIds: [...new Set(e.vaga_ids)] });
    const avaliacoes = r.avaliacoes.map((a) => ({
      id_vaga: String(a.id), link: ctx.link("vagas", a.id), situacao: a.status, motivo: limpar(a.motivo, 300),
      aderencia: limpar(a.jev?.nivel ? `${a.jev.nivel}${a.jev.descricaoNivel ? ` — ${a.jev.descricaoNivel}` : ""}` : null, 300),
      trechos_favoraveis: (a.explicacao?.favoraveis ?? []).slice(0, 10).map((f) => ({ requisito: textoSeguro(f.trecho, 300) ?? "", termos_no_perfil: f.termos.slice(0, 10).map((t) => limpar(t, 40) ?? "").filter(Boolean) })),
      requisitos_nao_comprovados: (a.explicacao?.naoComprovados ?? []).slice(0, 10).map((t) => textoSeguro(t, 300) ?? "").filter(Boolean),
      notas: (a.explicacao?.notas ?? []).slice(0, 5).map((t) => limpar(t, 300) ?? "").filter(Boolean),
    }));
    const campos = ["escolaridade", "tempo_experiencia", "habilidades", "resumo_profissional"].filter((c) => (e as Record<string, unknown>)[c]);
    return { dados: { avaliacoes, dados_enviados: { campos, trechos_removidos: removidos, dados_pessoais_mascarados: mascarado }, aviso: AVISO_COMPAT } };
  },
});

export const gerarMensagemApresentacaoVaga = definir({
  nome: "gerar_mensagem_apresentacao_vaga",
  titulo: "Gerar mensagem de apresentação da vaga",
  descricao:
    "Monta o RASCUNHO da mensagem para apresentar uma vaga ao candidato, no formato padrão do DNA Work (cargo, local, salário e benefícios, horário), usando só os dados atuais da vaga. " +
    "Não envia nada ao candidato. O colaborador revisa e personaliza antes de enviar; não acrescente informações que não estejam nos fatos retornados.",
  modulo: "triagem", paginas: ["triagem", "vagas"], consumo: "puro",
  entrada: z.object({ id_vaga: z.string().trim().min(1).max(64), primeiro_nome: z.string().trim().min(2).max(30).regex(/^[\p{L}' -]+$/u, "Use só o primeiro nome (letras).").optional() }).strict(),
  saida: z.object({
    id_vaga: z.string(), link: saidaLink, mensagem: z.string(),
    fatos_utilizados: z.object({ cargo: z.string().nullable(), local: z.string().nullable(), remuneracao: z.number().nullable(), beneficios: z.string().nullable(), horario: z.string().nullable() }).strict(),
    situacao: z.string().nullable(), aviso: saidaAviso,
  }).strict(),
  async executar(ctx, { id_vaga, primeiro_nome }) {
    const v = (await ctx.servicos.vagas.get(id_vaga)) as unknown as Linha;
    const mensagem = limpar(v.mensagem, 1500);
    if (!mensagem) throw new AppError(422, "MENSAGEM_INDISPONIVEL", "Não foi possível montar a mensagem desta vaga.");
    const situacao = limpar(v.situacao, 30);
    return {
      dados: {
        id_vaga: String(v.id_vaga), link: ctx.link("vagas", String(v.id_vaga)),
        mensagem: primeiro_nome ? `Olá, ${primeiro_nome}! ${mensagem}` : mensagem,
        fatos_utilizados: { cargo: limpar(v.cargo, 120), local: localSemRua(v.local), remuneracao: typeof v.salario === "number" ? v.salario : null, beneficios: limpar(v.beneficios, 600), horario: limpar(v.horario, 300) },
        situacao,
        aviso: situacao && situacao !== "aberta" ? `ATENÇÃO: esta vaga está ${situacao}; confirme antes de apresentar ao candidato.` : "Rascunho gerado a partir dos dados do sistema; revise antes de enviar.",
      },
    };
  },
});

export const ferramentasTriagem = [buscarVagasPorCep, consultarCompatibilidadeProfissional, gerarMensagemApresentacaoVaga];
