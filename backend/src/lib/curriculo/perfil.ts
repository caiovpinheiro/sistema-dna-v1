import { z } from "zod";

/**
 * JSON que a Luna devolve (structured output). Campo ausente no currículo vem null ou lista vazia.
 * Idade, sexo, estado civil e documentos ficam de fora de propósito: não entram na triagem profissional.
 */
export const LUNA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "localizacao", "escolaridade", "formacoes", "ultimo_cargo", "experiencias", "habilidades", "cursos", "objetivo", "resumo"],
  properties: {
    nome: { type: ["string", "null"] },
    localizacao: { type: ["string", "null"], description: "Cidade/UF ou bairro, só se escrito no currículo." },
    escolaridade: { type: ["string", "null"], description: "Maior nível de escolaridade informado, com situação (completo, cursando, incompleto)." },
    formacoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["curso", "instituicao", "situacao", "periodo"],
        properties: {
          curso: { type: ["string", "null"] },
          instituicao: { type: ["string", "null"] },
          situacao: { type: ["string", "null"] },
          periodo: { type: ["string", "null"] },
        },
      },
    },
    ultimo_cargo: { type: ["string", "null"] },
    experiencias: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cargo", "empresa", "inicio", "fim", "atual", "duracao_informada", "atividades"],
        properties: {
          cargo: { type: ["string", "null"] },
          empresa: { type: ["string", "null"] },
          inicio: { type: ["string", "null"], description: "AAAA-MM, ou AAAA quando só o ano aparece. null se não houver data." },
          fim: { type: ["string", "null"], description: "AAAA-MM, ou AAAA. null quando é o emprego atual ou não há data." },
          atual: { type: "boolean", description: "true só se o currículo disser que a pessoa continua no emprego." },
          duracao_informada: { type: ["string", "null"], description: "Duração escrita no próprio currículo, sem calcular." },
          atividades: { type: ["string", "null"], description: "Atividades descritas no currículo para essa experiência, em uma frase curta." },
        },
      },
    },
    habilidades: { type: "array", items: { type: "string" } },
    cursos: { type: "array", items: { type: "string" }, description: "Cursos livres e certificações." },
    objetivo: { type: ["string", "null"] },
    resumo: { type: ["string", "null"], description: "Resumo profissional objetivo de até 3 frases, só com fatos do currículo, sem julgamento de contratação." },
  },
} as const;

const textoOpcional = z.string().nullable().optional().transform((valor) => limparTexto(valor));

const lunaRespostaSchema = z.object({
  nome: textoOpcional,
  localizacao: textoOpcional,
  escolaridade: textoOpcional,
  formacoes: z.array(z.object({
    curso: textoOpcional,
    instituicao: textoOpcional,
    situacao: textoOpcional,
    periodo: textoOpcional,
  })).nullable().optional().transform((lista) => lista ?? []),
  ultimo_cargo: textoOpcional,
  experiencias: z.array(z.object({
    cargo: textoOpcional,
    empresa: textoOpcional,
    inicio: textoOpcional,
    fim: textoOpcional,
    atual: z.boolean().nullable().optional().transform((valor) => valor === true),
    duracao_informada: textoOpcional,
    atividades: textoOpcional,
  })).nullable().optional().transform((lista) => lista ?? []),
  habilidades: z.array(z.string()).nullable().optional().transform((lista) => lista ?? []),
  cursos: z.array(z.string()).nullable().optional().transform((lista) => lista ?? []),
  objetivo: textoOpcional,
  resumo: textoOpcional,
});

export type ExperienciaExtraida = {
  cargo: string | null;
  empresa: string | null;
  inicio: string | null;
  fim: string | null;
  atual: boolean;
  atividades: string | null;
  /** Meses calculados pelas datas; null quando as datas não bastam. */
  meses: number | null;
  /** true quando alguma data só tem o ano. */
  aproximado: boolean;
  /** Texto para exibir: calculado pelas datas, ou a duração escrita no currículo, ou null. */
  duracao: string | null;
};

export type TempoTotal = {
  meses: number | null;
  aproximado: boolean;
  /** Quantas experiências ficaram fora da soma por falta de datas. */
  semDatas: number;
  texto: string;
};

export type CurriculoExtraido = {
  nome: string | null;
  localizacao: string | null;
  escolaridade: string | null;
  formacoes: Array<{ curso: string | null; instituicao: string | null; situacao: string | null; periodo: string | null }>;
  ultimoCargo: string | null;
  experiencias: ExperienciaExtraida[];
  tempoTotal: TempoTotal;
  habilidades: string[];
  cursos: string[];
  objetivo: string | null;
  resumo: string | null;
};

/** O que o operador revisa na tela e o que vai para o JEV. Só dados profissionais. */
export type PerfilProfissional = {
  resumo: string;
  escolaridade: string;
  ultimoCargo: string;
  experiencias: string;
  tempoExperiencia: string;
  habilidades: string;
  cursos: string;
  objetivo: string;
};

const NAO_INFORMADO = /^(n[ãa]o\s+informad[oa]s?|n\/?a|null|undefined|-+|—)$/i;

export function limparTexto(valor: string | null | undefined): string | null {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  return !texto || NAO_INFORMADO.test(texto) ? null : texto;
}

function unicos(lista: string[], limite = 30): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const item of lista) {
    const texto = limparTexto(item);
    if (!texto) continue;
    const chave = texto.toLocaleLowerCase("pt-BR");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(texto);
    if (saida.length >= limite) break;
  }
  return saida;
}

/** Corta o resumo em até três frases, sem reescrever o conteúdo. */
export function ateTresFrases(texto: string | null): string | null {
  if (!texto) return null;
  const frases = texto.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((frase) => frase.trim()).filter(Boolean) ?? [];
  return frases.slice(0, 3).join(" ") || null;
}

type Mes = { indice: number; soAno: boolean };

/** "2021-03" vira o mês 2021*12+2; "2021" vira janeiro (ou dezembro, no fim) e fica marcado como aproximado. */
export function lerMes(valor: string | null, fim = false): Mes | null {
  if (!valor) return null;
  const completo = valor.match(/^(\d{4})-(\d{2})$/);
  if (completo) {
    const ano = Number(completo[1]);
    const mes = Number(completo[2]);
    if (ano < 1950 || ano > 2100 || mes < 1 || mes > 12) return null;
    return { indice: ano * 12 + mes - 1, soAno: false };
  }
  const ano = valor.match(/^(\d{4})$/);
  if (ano) {
    const numero = Number(ano[1]);
    if (numero < 1950 || numero > 2100) return null;
    return { indice: numero * 12 + (fim ? 11 : 0), soAno: true };
  }
  return null;
}

export function mesDe(data: Date): number {
  return data.getUTCFullYear() * 12 + data.getUTCMonth();
}

export function formatarMeses(meses: number): string {
  if (meses < 1) return "menos de 1 mês";
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes = [];
  if (anos) partes.push(`${anos} ${anos === 1 ? "ano" : "anos"}`);
  if (resto) partes.push(`${resto} ${resto === 1 ? "mês" : "meses"}`);
  return partes.join(" e ");
}

type Intervalo = { inicio: number; fim: number };

/** Une períodos sobrepostos ou contíguos e soma os meses sem contar duas vezes o mesmo mês. */
export function mesesSemSobreposicao(intervalos: Intervalo[]): number {
  const ordenados = intervalos.filter((item) => item.fim >= item.inicio).sort((a, b) => a.inicio - b.inicio);
  let total = 0;
  let atual: Intervalo | null = null;
  for (const item of ordenados) {
    if (atual && item.inicio <= atual.fim + 1) {
      atual.fim = Math.max(atual.fim, item.fim);
      continue;
    }
    if (atual) total += atual.fim - atual.inicio + 1;
    atual = { ...item };
  }
  if (atual) total += atual.fim - atual.inicio + 1;
  return total;
}

function intervaloDa(experiencia: { inicio: string | null; fim: string | null; atual: boolean }, hoje: number) {
  const inicio = lerMes(experiencia.inicio);
  const fim = experiencia.atual && !experiencia.fim ? { indice: hoje, soAno: false } : lerMes(experiencia.fim, true);
  if (!inicio || !fim || fim.indice < inicio.indice || inicio.indice > hoje) return null;
  return { inicio: inicio.indice, fim: Math.min(fim.indice, hoje), aproximado: inicio.soAno || fim.soAno };
}

/**
 * Normaliza a resposta da Luna: valida o formato, troca "Não informado" por null, remove repetidos,
 * calcula a duração de cada experiência e o total sem sobreposição. Nada é inventado: sem data, sem duração.
 */
export function normalizarCurriculo(bruto: unknown, referencia = new Date()): CurriculoExtraido {
  const lido = lunaRespostaSchema.safeParse(bruto);
  if (!lido.success) throw new Error("Resposta da análise de currículo fora do formato esperado.");
  const dados = lido.data;
  const hoje = mesDe(referencia);
  const intervalos: Intervalo[] = [];
  let aproximado = false;
  let semDatas = 0;

  const experiencias = dados.experiencias
    .filter((item) => item.cargo || item.empresa)
    .slice(0, 20)
    .map((item): ExperienciaExtraida => {
      const intervalo = intervaloDa(item, hoje);
      if (intervalo) {
        intervalos.push(intervalo);
        if (intervalo.aproximado) aproximado = true;
      } else {
        semDatas += 1;
      }
      const meses = intervalo ? intervalo.fim - intervalo.inicio + 1 : null;
      const duracao = meses != null
        ? `${intervalo?.aproximado ? "aproximadamente " : ""}${formatarMeses(meses)}`
        : item.duracao_informada;
      return {
        cargo: item.cargo,
        empresa: item.empresa,
        inicio: item.inicio,
        fim: item.fim,
        atual: item.atual,
        atividades: item.atividades,
        meses,
        aproximado: intervalo?.aproximado ?? false,
        duracao,
      };
    });

  const meses = intervalos.length ? mesesSemSobreposicao(intervalos) : null;
  const parcial = semDatas > 0;
  const texto = meses == null
    ? "Não foi possível calcular com segurança"
    : `${aproximado || parcial ? "aproximadamente " : ""}${formatarMeses(meses)}${parcial ? ` (${semDatas} ${semDatas === 1 ? "experiência sem datas ficou" : "experiências sem datas ficaram"} fora da soma)` : ""}`;

  return {
    nome: dados.nome,
    localizacao: dados.localizacao,
    escolaridade: dados.escolaridade,
    formacoes: dados.formacoes.filter((item) => item.curso || item.instituicao).slice(0, 10),
    ultimoCargo: dados.ultimo_cargo ?? experiencias.find((item) => item.atual)?.cargo ?? null,
    experiencias,
    tempoTotal: { meses, aproximado: aproximado || parcial, semDatas, texto },
    habilidades: unicos(dados.habilidades),
    cursos: unicos(dados.cursos, 20),
    objetivo: dados.objetivo,
    resumo: ateTresFrases(dados.resumo),
  };
}

function linhaDaExperiencia(item: ExperienciaExtraida): string {
  const partes = [item.cargo ?? "Cargo não informado", item.empresa ?? "empresa não informada"];
  if (item.duracao) partes.push(item.duracao);
  else if (item.atual) partes.push("atual");
  const linha = partes.join(" — ");
  return item.atividades ? `${linha}: ${item.atividades}` : linha;
}

/** Campos editáveis a partir do que foi extraído. */
export function perfilParaEdicao(extraido: CurriculoExtraido): PerfilProfissional {
  const formacao = extraido.formacoes
    .map((item) => [item.curso, item.instituicao, item.situacao].filter(Boolean).join(" — "))
    .filter(Boolean);
  return {
    resumo: extraido.resumo ?? "",
    escolaridade: [extraido.escolaridade, ...formacao.filter((item) => item !== extraido.escolaridade)].filter(Boolean).join("\n"),
    ultimoCargo: extraido.ultimoCargo ?? "",
    experiencias: extraido.experiencias.map(linhaDaExperiencia).join("\n"),
    tempoExperiencia: extraido.tempoTotal.meses == null ? "" : extraido.tempoTotal.texto,
    habilidades: extraido.habilidades.join(", "),
    cursos: extraido.cursos.join(", "),
    objetivo: extraido.objetivo ?? "",
  };
}

/** Texto do currículo enviado ao JEV. Só campos profissionais preenchidos; nada pessoal. */
export function textoDoCurriculo(perfil: Partial<PerfilProfissional>): string {
  const campos: Array<[string, string | undefined]> = [
    ["Resumo profissional", perfil.resumo],
    ["Formação/escolaridade", perfil.escolaridade],
    ["Último cargo", perfil.ultimoCargo],
    ["Experiências", perfil.experiencias],
    ["Tempo total de experiência", perfil.tempoExperiencia],
    ["Habilidades e conhecimentos", perfil.habilidades],
    ["Cursos e certificações", perfil.cursos],
    ["Objetivo profissional", perfil.objetivo],
  ];
  return campos
    .map(([rotulo, valor]) => [rotulo, String(valor ?? "").trim()] as const)
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `${rotulo}: ${valor}`)
    .join("\n");
}

/** Com menos que isso não há o que comparar com a vaga. */
const MINIMO_CURRICULO = 30;

export function perfilSuficiente(perfil: Partial<PerfilProfissional>): boolean {
  const essencial = [perfil.resumo, perfil.experiencias, perfil.habilidades, perfil.ultimoCargo, perfil.cursos]
    .map((valor) => String(valor ?? "").trim())
    .join(" ");
  return essencial.replace(/\s+/g, " ").trim().length >= MINIMO_CURRICULO;
}
