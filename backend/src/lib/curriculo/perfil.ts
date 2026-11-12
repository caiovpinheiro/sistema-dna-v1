import { z } from "zod";

/**
 * JSON que a Luna devolve (structured output). Campo ausente no currículo vem null ou lista vazia.
 * Idade, sexo, estado civil e documentos ficam de fora de propósito: não entram na triagem profissional.
 */
export const LUNA_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "localizacao", "endereco", "escolaridade", "formacoes", "ultimo_cargo", "experiencias", "habilidades", "cursos", "objetivo", "resumo"],
  properties: {
    nome: { type: ["string", "null"] },
    localizacao: { type: ["string", "null"], description: "Cidade/UF ou bairro, só se escrito no currículo." },
    endereco: {
      description: "Endereço residencial escrito no currículo, só para localizar a pessoa. null se não houver.",
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["cep", "logradouro", "bairro", "cidade", "uf"],
          properties: {
            cep: { type: ["string", "null"], description: "CEP exatamente como escrito; null se não houver." },
            logradouro: { type: ["string", "null"], description: "Rua/avenida, sem número." },
            bairro: { type: ["string", "null"] },
            cidade: { type: ["string", "null"] },
            uf: { type: ["string", "null"], description: "Sigla do estado com 2 letras." },
          },
        },
        { type: "null" },
      ],
    },
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
  endereco: z.object({
    cep: textoOpcional,
    logradouro: textoOpcional,
    bairro: textoOpcional,
    cidade: textoOpcional,
    uf: textoOpcional,
  }).nullable().optional().transform((valor) => valor ?? null),
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

export type EnderecoExtraido = { cep: string | null; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null };

/** CEP com 8 dígitos, ou null. Aceita "01001-000", "01001000", "01.001-000". */
export function cepValido(valor: string | null | undefined): string | null {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 8 && !/^0{8}$/.test(digitos) ? digitos : null;
}

function enderecoNormalizado(endereco: { cep: string | null; logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null } | null): EnderecoExtraido | null {
  if (!endereco) return null;
  const uf = endereco.uf && /^[A-Za-z]{2}$/.test(endereco.uf.trim()) ? endereco.uf.trim().toUpperCase() : null;
  const saida = { cep: cepValido(endereco.cep), logradouro: endereco.logradouro, bairro: endereco.bairro, cidade: endereco.cidade, uf };
  return Object.values(saida).some(Boolean) ? saida : null;
}

export type CurriculoExtraido = {
  nome: string | null;
  localizacao: string | null;
  /** Só para localizar a pessoa (CEP da busca). Nunca vai para o JEV. */
  endereco: EnderecoExtraido | null;
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

export const ESCOLARIDADES = {
  medio_incompleto: "Ensino médio incompleto",
  medio_completo: "Ensino médio completo",
  cursando_medio: "Cursando ensino médio",
  cursando_superior: "Cursando ensino superior",
  superior_completo: "Ensino superior completo",
} as const;
export type Escolaridade = keyof typeof ESCOLARIDADES;

export const TURNOS = { manha: "Manhã", tarde: "Tarde", noite: "Noite" } as const;
export type Turno = keyof typeof TURNOS;

/**
 * O que o operador revisa na tela. Escolaridade, tempo total, habilidades e o texto do currículo analisado vão
 * para o JEV; os turnos (disponível e de estudo) são dados operacionais e ficam fora do score.
 */
export type PerfilProfissional = {
  escolaridade: Escolaridade | "";
  /** Obrigatório quando a escolaridade é "cursando ensino médio". */
  turnoEstudo: Turno | "";
  tempoExperiencia: string;
  habilidades: string;
  turno: Turno | "";
  /** Texto do currículo analisado pela Luna (experiências, formação, cursos). Só leitura na tela. */
  curriculo: string;
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
    endereco: enderecoNormalizado(dados.endereco),
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

const sem = (texto: string | null | undefined) => semAcento(String(texto ?? ""));

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Sugere a opção de escolaridade a partir do texto extraído. Só sugere quando o texto é inequívoco;
 * "superior incompleto" (pode ser trancado) e textos vagos ficam em branco para o operador escolher.
 */
export function escolaridadeSugerida(texto: string | null): Escolaridade | "" {
  const t = sem(texto);
  if (!t) return "";
  const cursando = /cursando|em andamento|andamento|atualmente|previs[aã]o|\d+[ºo°]?\s*(ano|semestre|periodo)/.test(t);
  const superior = /superior|gradua|bacharel|licenciatura|tecnologo|faculdade|universidade/.test(t);
  const medio = /medio|2[ºo°]?\s*grau|colegial/.test(t);
  if (superior) {
    if (/incomplet|trancad/.test(t)) return "";
    if (cursando) return "cursando_superior";
    if (/complet|conclu|formad/.test(t)) return "superior_completo";
    return "";
  }
  if (medio) {
    if (/incomplet/.test(t)) return "medio_incompleto";
    if (cursando) return "cursando_medio";
    if (/complet|conclu/.test(t)) return "medio_completo";
  }
  return "";
}

/** Texto do currículo analisado que vai para o JEV, como o resumo_cv do workflow. Sem nome nem localização. */
export function textoDoCurriculoAnalisado(extraido: CurriculoExtraido): string {
  const formacao = [extraido.escolaridade, ...extraido.formacoes.map((item) => [item.curso, item.instituicao, item.situacao, item.periodo].filter(Boolean).join(" — "))]
    .filter((item): item is string => Boolean(item));
  const blocos: Array<[string, string]> = [
    ["Resumo", extraido.resumo ?? ""],
    ["Formação", [...new Set(formacao)].join("\n")],
    ["Último cargo", extraido.ultimoCargo ?? ""],
    ["Experiência profissional", extraido.experiencias.map((item) => `- ${linhaDaExperiencia(item)}`).join("\n")],
    ["Tempo total de experiência", extraido.tempoTotal.texto],
    ["Habilidades", extraido.habilidades.join(", ")],
    ["Cursos/Certificações", extraido.cursos.join(", ")],
    ["Objetivo profissional", extraido.objetivo ?? ""],
  ];
  return blocos.filter(([, valor]) => valor.trim()).map(([rotulo, valor]) => `${rotulo}:\n${valor}`).join("\n\n");
}

/** Campos da tela preenchidos a partir do que a Luna extraiu. Turnos ficam para o operador. */
export function perfilParaEdicao(extraido: CurriculoExtraido): PerfilProfissional {
  return {
    escolaridade: escolaridadeSugerida(extraido.escolaridade ?? extraido.formacoes.map((item) => [item.curso, item.situacao].join(" ")).join(" ")),
    turnoEstudo: "",
    tempoExperiencia: extraido.tempoTotal.meses == null ? "" : extraido.tempoTotal.texto,
    habilidades: extraido.habilidades.join(", "),
    turno: "",
    curriculo: textoDoCurriculoAnalisado(extraido),
  };
}

/** Texto do currículo enviado ao JEV: escolaridade, tempo total, habilidades e o currículo analisado. Turnos ficam fora. */
export function textoDoCurriculo(perfil: Partial<PerfilProfissional>): string {
  const escolaridade = perfil.escolaridade ? ESCOLARIDADES[perfil.escolaridade] : "";
  const campos: Array<[string, string | undefined]> = [
    ["Escolaridade", escolaridade],
    ["Tempo total de experiência", perfil.tempoExperiencia],
    ["Habilidades e conhecimentos", perfil.habilidades],
  ];
  const linhas = campos
    .map(([rotulo, valor]) => [rotulo, String(valor ?? "").trim()] as const)
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `${rotulo}: ${valor}`);
  const curriculo = String(perfil.curriculo ?? "").trim();
  if (curriculo) linhas.push("", "Currículo analisado:", curriculo);
  return linhas.join("\n");
}

/** Com menos que isso não há o que comparar com a vaga. */
const MINIMO_CURRICULO = 30;

/** Precisa do currículo analisado ou, sem ele, das habilidades informadas à mão. */
export function perfilSuficiente(perfil: Partial<PerfilProfissional>): boolean {
  if (String(perfil.curriculo ?? "").trim().length >= MINIMO_CURRICULO) return true;
  return String(perfil.habilidades ?? "").trim().length >= 3;
}
