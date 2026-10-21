import { z } from "zod";
import { moneySchema, pageSchema } from "./common.js";

const fields = {
  id_empresa: z.string().trim().min(1),
  cargo: z.string().trim().min(2).max(180),
  tipo_vaga: z.coerce.number().int().positive(),
  salario: moneySchema.optional(),
  quantidade_posicoes: z.coerce.number().int().positive(),
  status: z.coerce.number().int().min(0).max(20).optional(),
  publicar: z.coerce.number().int().min(0).max(1).optional(),
  carga_horaria: z.string().trim().max(40).optional(),
  obs: z.string().trim().max(4000).optional(),
};

export const vagaCreateSchema = z.object(fields);

export const vagaPatchSchema = z.object({
  cargo: fields.cargo.optional(),
  tipo_vaga: fields.tipo_vaga.optional(),
  salario: moneySchema.optional(),
  quantidade_posicoes: fields.quantidade_posicoes.optional(),
  status: fields.status,
  publicar: fields.publicar,
  carga_horaria: fields.carga_horaria,
  obs: fields.obs,
});

export const vagaListSchema = z.object({
  ...pageSchema,
  id_empresa: z.string().trim().optional(),
  cargo: z.string().trim().optional(),
  tipo_vaga: z.coerce.number().int().optional(),
  situacao: z.enum(["aberta", "preenchida", "encerrada", "capacidade_pendente"]).optional(),
  q: z.string().trim().optional(),
});

export type VagaCreate = z.infer<typeof vagaCreateSchema>;
export type VagaPatch = z.infer<typeof vagaPatchSchema>;
export type VagaListQuery = z.infer<typeof vagaListSchema>;
