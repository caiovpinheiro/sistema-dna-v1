import { legacyToIso } from "./dates.js";
import type { Concedente, ManualData } from "./tce-fields.js";

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
    campos.estagio_termino = legacyToIso(contrato.datafim) ?? "";
    campos.carga_horaria_semanal = texto(contrato.carga_horaria);
    campos.jornada = texto(contrato.texto_carga);
    campos.bolsa = texto(contrato.salario);
    campos.plano_atividades = texto(contrato.atribuicaoes);
  }
  return {
    campos,
    concedente,
    empresaId: idValido(contrato?.id_empresa) || idValido(candidato.id_empresa),
    escolaId: idValido(candidato.escola),
  };
}
