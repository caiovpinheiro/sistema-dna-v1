import { z } from "zod";
import { semEntidades } from "../lib/normalize.js";
import { isoDateSchema, optionalCnpj, optionalCep, optionalEmail, optionalPhone, pageSchema, ufSchema } from "./common.js";

const fields = {
  // Nomes vêm limpos de entidades HTML ("&amp;" → "&"), como o sistema antigo deixava gravado.
  razao_social: z.string().trim().transform(semEntidades).pipe(z.string().min(3, "A razão social precisa ter pelo menos 3 letras.").max(180, "A razão social pode ter até 180 letras.")),
  nome_fantasia: z.string().trim().transform(semEntidades).pipe(z.string().max(180, "O nome fantasia pode ter até 180 letras.")).optional(),
  cnpj: optionalCnpj,
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
  responsavel: z.string().trim().transform(semEntidades).pipe(z.string().max(180)).optional(),
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
  acesso: z.enum(["acessou", "nunca", "sem"]).optional(),
});

export type EmpresaCreate = z.infer<typeof empresaCreateSchema>;
export type EmpresaPatch = z.infer<typeof empresaPatchSchema>;
export type EmpresaListQuery = z.infer<typeof empresaListSchema>;

void isoDateSchema;
