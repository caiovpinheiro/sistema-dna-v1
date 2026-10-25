import { z } from "zod";
import { isoDateSchema, pageSchema } from "./common.js";
import { ETAPAS } from "../lib/processo.js";

export const processoCreateSchema = z.object({
  id_candidato: z.string().trim().min(1),
  id_empresa: z.string().trim().min(1),
  id_vaga: z.string().trim().min(1),
  origem: z.enum(["dnawork", "empresa"]),
  data_recebimento: isoDateSchema,
  data_encaminhamento: isoDateSchema.optional(),
  observacao: z.string().trim().max(500).optional(),
}).superRefine((input, context) => {
  if (input.origem === "dnawork" && !input.data_encaminhamento) {
    context.addIssue({ code: "custom", path: ["data_encaminhamento"], message: "Informe a data de encaminhamento." });
  }
  if (input.data_encaminhamento && input.data_encaminhamento < input.data_recebimento) {
    context.addIssue({ code: "custom", path: ["data_encaminhamento"], message: "O encaminhamento não pode ser anterior ao recebimento." });
  }
});

export const processoMoverSchema = z.object({
  etapa: z.enum(ETAPAS),
  observacao: z.string().trim().max(500).optional(),
});

export const processoListSchema = z.object({
  ...pageSchema,
  origem: z.enum(["dnawork", "empresa"]).optional(),
  etapa: z.enum(ETAPAS).optional(),
  id_empresa: z.string().trim().optional(),
  id_vaga: z.string().trim().optional(),
  id_candidato: z.string().trim().optional(),
  nome: z.string().trim().optional(),
});

export type ProcessoCreate = z.infer<typeof processoCreateSchema>;
export type ProcessoMover = z.infer<typeof processoMoverSchema>;
export type ProcessoListQuery = z.infer<typeof processoListSchema>;
