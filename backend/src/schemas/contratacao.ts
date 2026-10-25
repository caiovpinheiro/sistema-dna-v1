import { z } from "zod";
import { isoDateSchema, pageSchema } from "./common.js";

export const contratacaoCreateSchema = z.object({
  id_candidato: z.string().trim().min(1),
  id_vaga: z.string().trim().min(1),
  id_empresa: z.string().trim().min(1).optional(),
  data_inicio: isoDateSchema,
  data_fim: isoDateSchema.optional(),
  id_processo: z.string().uuid().optional(),
});

export const contratacaoEncerrarSchema = z.object({
  data_encerramento: isoDateSchema,
});

export const contratacaoListSchema = z.object({
  ...pageSchema,
  q: z.string().trim().optional(),
  id_empresa: z.string().trim().optional(),
  id_vaga: z.string().trim().optional(),
  id_candidato: z.string().trim().optional(),
  regime: z.enum(["clt", "estagio"]).optional(),
  status: z.coerce.number().int().optional(),
  inicio_de: isoDateSchema.optional(),
  inicio_ate: isoDateSchema.optional(),
});

export type ContratacaoCreate = z.infer<typeof contratacaoCreateSchema>;
export type ContratacaoEncerrar = z.infer<typeof contratacaoEncerrarSchema>;
export type ContratacaoListQuery = z.infer<typeof contratacaoListSchema>;
