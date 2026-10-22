export const APOLICE_SEGURO = "Apólice Coletiva nº 09820055561928 da Porto Seguro";

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

export function emptyManual(): ManualData {
  const data = {} as ManualData;
  for (const key of MANUAL_FIELDS) data[key] = "";
  return data;
}
