export const APOLICE_SEGURO = "Apólice Coletiva nº 09820055561928 da Porto Seguro";

/** Carga horária do estágio é sempre a mesma: 6 horas por dia, 30 por semana. */
export const CARGA_HORARIA_DIARIA = "6 horas";
export const CARGA_HORARIA_SEMANAL = "30 horas";

export const MANUAL_FIELDS = [
  "nome", "data_nascimento", "cpf", "rg", "email", "telefone", "endereco", "cep", "cidade", "estado",
  "curso", "periodo", "ano", "turno", "tipo_estagio",
  "nome_responsavel", "nascimento_responsavel", "cpf_responsavel", "rg_responsavel", "email_responsavel",
  "telefone_responsavel", "endereco_responsavel", "cep_responsavel", "cidade_responsavel", "estado_responsavel",
  "nome_escola", "escola_cnpj_inep", "escola_representante", "escola_email", "escola_endereco", "escola_cep",
  "escola_cidade", "escola_estado",
  "emissao_cidade_data", "estagio_inicio", "estagio_termino", "carga_horaria_diaria", "carga_horaria_semanal",
  "jornada", "supervisor", "bolsa", "beneficios", "seguro_apolice", "data_termo_aditivo", "plano_atividades",
] as const;

export type ManualKey = (typeof MANUAL_FIELDS)[number];
export type ManualData = Record<ManualKey, string>;

export const ESCOLA_KEYS = [
  "nome_escola", "escola_cnpj_inep", "escola_representante", "escola_email",
  "escola_endereco", "escola_cep", "escola_cidade", "escola_estado",
] as const;

export type Concedente = {
  razao_social: string;
  cnpj: string;
  endereco: string;
  cep: string;
  cidade: string;
  estado: string;
  email: string;
  representante: string;
};

export const CAMPOS_DATA: ManualKey[] = [
  "data_nascimento",
  "nascimento_responsavel",
  "estagio_inicio",
  "estagio_termino",
  "data_termo_aditivo",
];

export function dataParaPdf(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) return value;
  return `${iso[3]}/${iso[2]}/${iso[1]}`;
}

export function emptyManual(): ManualData {
  const data = {} as ManualData;
  for (const key of MANUAL_FIELDS) data[key] = "";
  return data;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "12 de novembro de 2026", no dia de São Paulo. */
export function dataPorExtenso(agora: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  return `${valor("day")} de ${MESES[valor("month") - 1]} de ${valor("year")}`;
}

/** Só a cidade do campo de emissão: tira a data do fim ("São Paulo, 12 de novembro de 2026" ou "São Paulo, 12/11/2026"). */
export function cidadeDaEmissao(valor: string | null | undefined): string {
  return String(valor ?? "")
    .replace(/[\s,–-]*\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\.?\s*$/i, "")
    .replace(/[\s,–-]*\d{1,2}\/\d{1,2}\/\d{2,4}\.?\s*$/, "")
    .trim();
}

/** Cidade e data de emissão do TCE: a cidade digitada e sempre a data do dia em que o PDF é gerado. */
export function emissaoComData(valor: string | null | undefined, agora: Date): string {
  const cidade = cidadeDaEmissao(valor);
  const data = dataPorExtenso(agora);
  return cidade ? `${cidade}, ${data}` : data;
}
