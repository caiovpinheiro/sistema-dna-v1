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

export const atendimentoSchema = z.object({
  nome: z.string().trim().min(3).max(180),
  celular: z.string().trim().min(8).max(20),
  email: z.union([z.string().trim().email(), z.literal("")]).nullish(),
  cpf: z.string().trim().nullish(),
  id_vaga: z.string().trim().nullish(),
  id_empresa: z.string().trim().nullish(),
  empresa: z.string().trim().nullish(),
  cargo: z.string().trim().nullish(),
  data_recebimento: isoDateSchema.nullish(),
  observacao: z.string().trim().max(500).nullish(),
  cep: z.string().trim().max(12).nullish(),
  sexo: z.string().trim().max(20).nullish(),
  escolaridade: z.string().trim().max(80).nullish(),
  idade: z.string().trim().max(10).nullish(),
  tipo_de_vaga: z.string().trim().max(40).nullish(),
  resumo_cv: z.string().trim().max(20000).nullish(),
  resumo_entrevista: z.string().trim().max(20000).nullish(),
  descricao_vaga: z.string().trim().max(4000).nullish(),
  teste_comportamental: z.string().trim().max(4000).nullish(),
  info_conducao: z.string().trim().max(8000).nullish(),
  deal_id: z.string().trim().max(80).nullish(),
});

export type ProcessoCreate = z.infer<typeof processoCreateSchema>;
export type Atendimento = z.infer<typeof atendimentoSchema>;
export type ProcessoMover = z.infer<typeof processoMoverSchema>;
export type ProcessoListQuery = z.infer<typeof processoListSchema>;
