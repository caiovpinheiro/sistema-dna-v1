import { z } from "zod";
import { isoDateSchema, optionalCep, optionalEmail, optionalPhone, pageSchema, ufSchema, cpfSchema } from "./common.js";

const fields = {
  nome: z.string().trim().min(3).max(180),
  cpf: cpfSchema,
  rg: z.string().trim().max(30).optional(),
  rg_expedidor: z.string().trim().max(40).optional(),
  datanascimento: isoDateSchema.optional(),
  email: optionalEmail,
  celular: optionalPhone,
  telefonefixo: optionalPhone,
  cep: optionalCep,
  logradouro: z.string().trim().max(180).optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(80).optional(),
  bairro: z.string().trim().max(80).optional(),
  cidade: z.string().trim().max(80).optional(),
  estado: ufSchema,
  sexo: z.enum(["M", "F", "O"]).optional(),
  estadocivil: z.string().trim().max(40).optional(),
  obs: z.string().trim().max(4000).optional(),
  escola: z.string().trim().max(180).optional(),
  nome_escola: z.string().trim().max(180).optional(),
  curso: z.string().trim().max(180).optional(),
  modalidadecurso: z.string().trim().max(80).optional(),
  semestre: z.string().trim().max(20).optional(),
  periodo: z.string().trim().max(40).optional(),
  ctps: z.string().trim().max(40).optional(),
  banco: z.string().trim().max(80).optional(),
  agencia: z.string().trim().max(20).optional(),
  numero_conta: z.string().trim().max(30).optional(),
  nome_conta: z.string().trim().max(180).optional(),
  tipo_chave_pix: z.string().trim().max(30).optional(),
  chave_pix: z.string().trim().max(120).optional(),
  pcd: z.string().trim().max(80).optional(),
};

export const candidatoCreateSchema = z.object({
  ...fields,
  nome: fields.nome,
  cpf: fields.cpf,
  email: z.string().email(),
});

export const candidatoPatchSchema = z.object(fields).partial();

export const candidatoListSchema = z.object({
  ...pageSchema,
  nome: z.string().trim().optional(),
  cpf: z.string().trim().optional(),
  email: z.string().trim().optional(),
  telefone: z.string().trim().optional(),
  cidade: z.string().trim().optional(),
  uf: z.string().trim().optional(),
  id_empresa: z.string().trim().optional(),
  regime: z.enum(["clt", "estagio"]).optional(),
  situacao: z.enum(["ativo", "encerrado", "sem_vinculo"]).optional(),
  cadastro_de: isoDateSchema.optional(),
  cadastro_ate: isoDateSchema.optional(),
});

export type CandidatoCreate = z.infer<typeof candidatoCreateSchema>;
export type CandidatoPatch = z.infer<typeof candidatoPatchSchema>;
export type CandidatoListQuery = z.infer<typeof candidatoListSchema>;
