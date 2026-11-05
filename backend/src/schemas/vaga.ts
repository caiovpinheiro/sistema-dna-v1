import { z } from "zod";
import { STATUS_VAGA } from "../lib/vaga-status.js";
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
  km: z.string().trim().max(20).optional(),
  atribuicaoes: z.string().trim().max(8000).optional(),
  atribu_contrato: z.string().trim().max(8000).optional(),
  requisitos_desejaveis: z.string().trim().max(4000).optional(),
  destaque: z.string().trim().max(4000).optional(),
  horabase: z.string().trim().max(20).optional(),
  hora_saida_base: z.string().trim().max(20).optional(),
  segunda_entrada: z.string().trim().max(20).optional(),
  segunda_saida: z.string().trim().max(20).optional(),
  terca_entrada: z.string().trim().max(20).optional(),
  terca_saida: z.string().trim().max(20).optional(),
  quarta_entrada: z.string().trim().max(20).optional(),
  quarta_saida: z.string().trim().max(20).optional(),
  quinta_entrada: z.string().trim().max(20).optional(),
  quinta_saida: z.string().trim().max(20).optional(),
  sexta_entrada: z.string().trim().max(20).optional(),
  sexta_saida: z.string().trim().max(20).optional(),
  sab_entrada: z.string().trim().max(20).optional(),
  sab_saida: z.string().trim().max(20).optional(),
  domindo_entrada: z.string().trim().max(20).optional(),
  domindo_saida: z.string().trim().max(20).optional(),
  texto_carga: z.string().trim().max(255).optional(),
  sexo: z.enum(["M", "F", "I"]).optional(),
};

export const vagaCreateSchema = z.object({ ...fields, situacao: z.enum(STATUS_VAGA).optional() });

export const vagaPatchSchema = z.object({
  cargo: fields.cargo.optional(),
  tipo_vaga: fields.tipo_vaga.optional(),
  salario: moneySchema.optional(),
  quantidade_posicoes: fields.quantidade_posicoes.optional(),
  status: fields.status,
  situacao: z.enum(STATUS_VAGA).optional(),
  publicar: fields.publicar,
  carga_horaria: fields.carga_horaria,
  obs: fields.obs,
  horabase: fields.horabase,
  hora_saida_base: fields.hora_saida_base,
  segunda_entrada: fields.segunda_entrada,
  segunda_saida: fields.segunda_saida,
  terca_entrada: fields.terca_entrada,
  terca_saida: fields.terca_saida,
  quarta_entrada: fields.quarta_entrada,
  quarta_saida: fields.quarta_saida,
  quinta_entrada: fields.quinta_entrada,
  quinta_saida: fields.quinta_saida,
  sexta_entrada: fields.sexta_entrada,
  sexta_saida: fields.sexta_saida,
  sab_entrada: fields.sab_entrada,
  sab_saida: fields.sab_saida,
  domindo_entrada: fields.domindo_entrada,
  domindo_saida: fields.domindo_saida,
  texto_carga: fields.texto_carga,
  sexo: fields.sexo,
});

export const vagaListSchema = z.object({
  ...pageSchema,
  id_empresa: z.string().trim().optional(),
  grupo_id: z.string().uuid().optional(),
  cargo: z.string().trim().optional(),
  cargo_chave: z.string().trim().optional(),
  tipo_vaga: z.coerce.number().int().optional(),
  situacao: z.enum(STATUS_VAGA).optional(),
  q: z.string().trim().optional(),
});

export type VagaCreate = z.infer<typeof vagaCreateSchema>;
export type VagaPatch = z.infer<typeof vagaPatchSchema>;
export type VagaListQuery = z.infer<typeof vagaListSchema>;
