import { z } from "zod";
import { cnpjSchema, isoDateSchema, optionalCep, optionalEmail, optionalPhone, pageSchema, ufSchema } from "./common.js";

const fields = {
  razao_social: z.string().trim().min(3).max(180),
  nome_fantasia: z.string().trim().max(180).optional(),
  cnpj: cnpjSchema,
  email: optionalEmail,
  telefone: optionalPhone,
  celular: optionalPhone,
  cep: optionalCep,
  logradouro: z.string().trim().max(180).optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(80).optional(),
  bairro: z.string().trim().max(80).optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: ufSchema,
  status: z.coerce.number().int().min(0).max(9).optional(),
  responsavel: z.string().trim().max(180).optional(),
  tipo_empresa: z.coerce.number().int().optional(),
  matriz: z.string().trim().max(36).optional(),
  ie: z.string().trim().max(30).optional(),
  site: z.string().trim().max(180).optional(),
  obs: z.string().trim().max(4000).optional(),
};

export const empresaCreateSchema = z.object({
  ...fields,
  email: z.string().email(),
});

export const empresaPatchSchema = z.object(fields).partial();

export const empresaListSchema = z.object({
  ...pageSchema,
  razao_social: z.string().trim().optional(),
  nome_fantasia: z.string().trim().optional(),
  cnpj: z.string().trim().optional(),
  cidade: z.string().trim().optional(),
  uf: z.string().trim().optional(),
  status: z.coerce.number().int().optional(),
  q: z.string().trim().optional(),
});

export type EmpresaCreate = z.infer<typeof empresaCreateSchema>;
export type EmpresaPatch = z.infer<typeof empresaPatchSchema>;
export type EmpresaListQuery = z.infer<typeof empresaListSchema>;

void isoDateSchema;
