import { legacyToIso } from "../lib/dates.js";
import { classifyRegime } from "../lib/normalize.js";
import { moneyToNumber } from "../lib/money.js";
import type { CandidatoRow } from "../repositories/candidato.repository.js";
import type { ContratacaoRow } from "../repositories/contratacao.repository.js";
import type { EmpresaRow } from "../repositories/empresa.repository.js";
import type { VagaRow } from "../repositories/vaga.repository.js";

export function presentCandidato(row: CandidatoRow, detail = false) {
  return {
    id_candidato: row.id_candidato,
    nome: row.nome,
    cpf: row.cpf,
    rg: row.rg,
    rg_expedidor: row.rg_expedidor,
    datanascimento: legacyToIso(row.datanascimento),
    datacadastro: legacyToIso(row.datacadastro),
    ultimaalteracao: legacyToIso(row.ultimaalteracao),
    telefonefixo: row.telefonefixo,
    celular: row.celular,
    email: row.email,
    logradouro: row.logradouro,
    numero: row.numero,
    complemento: row.complemento,
    bairro: row.bairro,
    cidade: row.cidade,
    estado: row.estado,
    cep: row.cep,
    escola: row.escola,
    nome_escola: row.nome_escola,
    modalidadecurso: row.modalidadecurso,
    curso: row.curso,
    periodo: row.periodo,
    semestre: row.semestre,
    ctps: row.ctps,
    sexo: row.sexo,
    estadocivil: row.estadocivil,
    obs: row.obs,
    id_empresa: row.id_empresa,
    empresa_nome: row.empresa_nome ?? null,
    vinculo: row.id_empresa ? "empresa" as const : "dna" as const,
    colaborador: row.colaborador,
    pcd: row.pcd,
    banco: detail ? row.banco : undefined,
    agencia: detail ? row.agencia : undefined,
    numero_conta: detail ? row.numero_conta : undefined,
    nome_conta: detail ? row.nome_conta : undefined,
    tipo_chave_pix: detail ? row.tipo_chave_pix : undefined,
    chave_pix: detail ? row.chave_pix : undefined,
    atendimento: detail ? row.atendimento : undefined,
  };
}

export function presentEmpresa(row: EmpresaRow) {
  return {
    ...row,
    data_adicao: row.data_adicao instanceof Date ? row.data_adicao.toISOString() : row.data_adicao,
  };
}

export function vagaSituacao(row: Pick<VagaRow, "status" | "quantidade_posicoes" | "ocupadas">, bloqueadas: number[]) {
  if (row.status != null && bloqueadas.includes(Number(row.status))) return "encerrada" as const;
  if (row.quantidade_posicoes == null) return "capacidade_pendente" as const;
  if (row.ocupadas >= row.quantidade_posicoes) return "preenchida" as const;
  return "aberta" as const;
}

export function presentVaga(row: VagaRow, bloqueadas: number[]) {
  const situacao = vagaSituacao(row, bloqueadas);
  const disponiveis = row.quantidade_posicoes == null ? null : Math.max(row.quantidade_posicoes - row.ocupadas, 0);
  return {
    id_vaga: row.id_vaga,
    id_empresa: row.id_empresa,
    razao_social: row.razao_social,
    nome_fantasia: row.nome_fantasia,
    cargo: row.cargo,
    tipo_vaga: row.tipo_vaga,
    modalidade: row.modalidade,
    regime: classifyRegime(row.modalidade),
    salario: moneyToNumber(row.salario),
    salario_legado: row.salario,
    status: row.status,
    situacao,
    dataabertura: legacyToIso(row.dataabertura),
    publicar: row.publicar,
    carga_horaria: row.carga_horaria,
    obs: row.obs,
    quantidade_posicoes: row.quantidade_posicoes,
    ocupadas: row.ocupadas,
    disponiveis,
  };
}

export function presentContratacao(row: ContratacaoRow, statusAtivo: number, statusEncerrado: number) {
  const regime = classifyRegime(row.modalidade);
  const situacao = row.status === statusAtivo ? "ativa" : row.status === statusEncerrado ? "encerrada" : "indefinida";
  return {
    id_contratacao: row.id_contratacao,
    id_vaga: row.id_vaga,
    id_candidato: row.id_candidato,
    id_empresa: row.id_empresa,
    candidato_nome: row.candidato_nome,
    candidato_cpf: row.candidato_cpf,
    empresa_razao: row.empresa_razao,
    empresa_fantasia: row.empresa_fantasia,
    cargo: row.cargo,
    modalidade: row.modalidade,
    regime,
    salario: moneyToNumber(row.salario),
    salario_legado: row.salario,
    carga_horaria: row.carga_horaria,
    status: row.status,
    situacao,
    data_contratacao: legacyToIso(row.data_contratacao),
    data_inicio: legacyToIso(row.datainicio),
    data_fim_prevista: legacyToIso(row.datafim),
    data_encerramento: legacyToIso(row.data_demicao),
  };
}
