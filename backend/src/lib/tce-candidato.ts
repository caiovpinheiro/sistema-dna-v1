import { legacyToIso } from "./dates.js";
import { moneyToNumber } from "./money.js";
import { horarioDoEspelho } from "../services/triagem.service.js";
import { CARGA_HORARIA_DIARIA, CARGA_HORARIA_SEMANAL, type Concedente, type ManualData } from "./tce-fields.js";

export type CandidatoTce = {
  id: string;
  nome: string;
  cpf: string;
  empresa: string;
};

export type PreenchimentoTce = {
  campos: Partial<ManualData>;
  concedente: Concedente | null;
  empresaId: string;
  escolaId: string;
  idContratacao: number | null;
  terminoEstudo: string;
};

type Linha = Record<string, string | null>;

function texto(value: string | null | undefined) {
  return (value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\u00a0/g, " ").trim();
}

function idValido(value: string | null | undefined) {
  const limpo = texto(value);
  return limpo && limpo !== "0" ? limpo : "";
}

function juntar(...partes: Array<string | null | undefined>) {
  return partes.map((parte) => texto(parte)).filter(Boolean).join(", ");
}

function contato(...partes: Array<string | null | undefined>) {
  return partes.map((parte) => texto(parte)).filter(Boolean).join(" / ");
}

function maisDoisAnos(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(ano + 2, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

/**
 * Regra do v0 (gerar-contrato-para-candidato / precontratar-datas):
 * o término do estágio é a data de fim da contratação ou, sem ela, o fim dos
 * estudos do candidato (candidato.terminoestudo). Nunca passa do fim dos estudos
 * nem de 2 anos a partir do início.
 */
export function terminoDoEstagio(inicio: string, fimContratacao: string, terminoEstudo: string) {
  const limites = [fimContratacao || terminoEstudo, terminoEstudo, inicio ? maisDoisAnos(inicio) : ""].filter(Boolean);
  return limites.sort()[0] ?? "";
}

function bolsaTexto(value: string | null | undefined) {
  const numero = moneyToNumber(texto(value));
  return numero == null ? texto(value) : numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

export function preenchimentoDoCandidato(candidato: Linha, escola: Partial<ManualData> | null, contrato: Linha | null): PreenchimentoTce {
  const campos: Partial<ManualData> = {
    nome: texto(candidato.nome),
    data_nascimento: legacyToIso(candidato.datanascimento) ?? "",
    cpf: texto(candidato.cpf),
    rg: texto(candidato.rg),
    email: texto(candidato.email),
    telefone: contato(candidato.celular, candidato.telefonefixo),
    endereco: juntar(candidato.logradouro, candidato.numero, candidato.complemento, candidato.bairro),
    cep: texto(candidato.cep),
    cidade: texto(candidato.cidade),
    estado: texto(candidato.estado),
    curso: texto(candidato.curso),
    periodo: texto(candidato.semestre),
    ano: texto(candidato.ano_escolar),
    turno: texto(candidato.periodo),
    nome_responsavel: texto(candidato.nome_responsavel) || texto(candidato.nomepai) || texto(candidato.nomemae),
    cpf_responsavel: texto(candidato.cpf_responsavel),
    email_responsavel: texto(candidato.email_responsavel),
    telefone_responsavel: texto(candidato.celular_responsavel),
  };
  if (escola) {
    for (const [chave, valor] of Object.entries(escola)) {
      if (valor) campos[chave as keyof ManualData] = valor;
    }
  }
  const terminoEstudo = legacyToIso(candidato.terminoestudo) ?? "";
  campos.estagio_termino = terminoEstudo;
  let concedente: Concedente | null = null;
  if (contrato?.razao_social || contrato?.nome_fantasia) {
    concedente = {
      razao_social: texto(contrato.razao_social) || texto(contrato.nome_fantasia),
      cnpj: texto(contrato.cnpj),
      endereco: juntar(contrato.emp_logradouro, contrato.emp_numero, contrato.emp_complemento, contrato.emp_bairro),
      cep: texto(contrato.emp_cep),
      cidade: texto(contrato.emp_cidade),
      estado: texto(contrato.emp_uf),
      email: texto(contrato.emp_email),
      representante: texto(contrato.responsavel),
    };
    campos.estagio_inicio = legacyToIso(contrato.datainicio) ?? "";
    campos.estagio_termino = terminoDoEstagio(campos.estagio_inicio, legacyToIso(contrato.datafim) ?? "", terminoEstudo);
    campos.jornada = texto(contrato.texto_carga);
    campos.bolsa = bolsaTexto(contrato.salario);
    campos.plano_atividades = texto(contrato.atribuicaoes);
  }
  campos.carga_horaria_diaria = CARGA_HORARIA_DIARIA;
  campos.carga_horaria_semanal = CARGA_HORARIA_SEMANAL;
  return {
    campos,
    concedente,
    empresaId: idValido(contrato?.id_empresa) || idValido(candidato.id_empresa),
    escolaId: idValido(candidato.escola),
    idContratacao: Number(contrato?.id_contratacao) || null,
    terminoEstudo,
  };
}

/** Linha de public.vaga (estágio) com a empresa, como vem da busca do TCE. */
export type LinhaVagaTce = {
  id: string;
  empresa_id: string | null;
  cargo: string | null;
  salario: string | null;
  beneficios: string | null;
  horario: string | null;
  jornada: string | null;
  atividades: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  local: string | null;
};

export type VagaTce = {
  id: string;
  cargo: string;
  empresa: string;
  empresaId: string;
  local: string;
  /** Campos das condições do estágio que a vaga preenche; só os que têm valor. */
  campos: Partial<ManualData>;
};

/** Vaga de estágio → campos do Anexo I: jornada (horário da vaga), bolsa, benefícios e plano de atividades. */
export function vagaParaTce(linha: LinhaVagaTce): VagaTce {
  const campos: Partial<ManualData> = {
    jornada: horarioDoEspelho(linha.horario) ?? texto(linha.jornada),
    bolsa: Number(linha.salario) > 0 ? bolsaTexto(linha.salario) : "",
    beneficios: texto(linha.beneficios),
    plano_atividades: texto(linha.atividades),
  };
  for (const chave of Object.keys(campos) as Array<keyof ManualData>) if (!campos[chave]) delete campos[chave];
  return {
    id: linha.id,
    cargo: texto(linha.cargo) || "Vaga de estágio",
    empresa: texto(linha.nome_fantasia) || texto(linha.razao_social),
    empresaId: idValido(linha.empresa_id),
    local: texto(linha.local).replace(/\s+-\s+/, ", ").replace(/\s*\/\s*/, " "),
    campos,
  };
}
