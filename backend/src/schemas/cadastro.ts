import { z } from "zod";
import { cnpjSchema, moneySchema, optionalCep, optionalEmail, optionalPhone } from "./common.js";

const contato = { email: optionalEmail, telefone: optionalPhone };

function exigeContato(value: { email?: string; telefone?: string }, ctx: z.RefinementCtx) {
  if (!value.email && !value.telefone) {
    ctx.addIssue({ code: "custom", message: "Informe e-mail ou telefone.", path: ["email"] });
  }
}

export const grupoCreateSchema = z.object({
  nome: z.string().trim().min(2).max(180),
  ...contato,
}).superRefine(exigeContato);

export const empresaCadastroSchema = z.object({
  grupo_id: z.string().uuid(),
  cnpj: cnpjSchema,
  razao_social: z.string().trim().min(3).max(180),
  nome_fantasia: z.string().trim().min(2).max(180),
  cep: optionalCep.refine((value) => Boolean(value), "Informe o CEP."),
  logradouro: z.string().trim().min(3).max(180),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(80).optional(),
  bairro: z.string().trim().min(2).max(80),
  cidade: z.string().trim().min(2).max(80),
  uf: z.string().trim().length(2),
  ...contato,
}).superRefine(exigeContato);

const hora = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM.");

export const vagaCadastroSchema = z.object({
  empresa_id: z.string().uuid(),
  tipo: z.enum(["estagio", "clt"]),
  carga_horaria: z.enum(["20", "30", "40", "44"]),
  cargo: z.string().trim().min(2).max(180),
  salario: moneySchema,
  horario_entrada: hora,
  horario_saida: hora,
  segunda_entrada: hora.optional(),
  segunda_saida: hora.optional(),
  terca_entrada: hora.optional(),
  terca_saida: hora.optional(),
  quarta_entrada: hora.optional(),
  quarta_saida: hora.optional(),
  quinta_entrada: hora.optional(),
  quinta_saida: hora.optional(),
  sexta_entrada: hora.optional(),
  sexta_saida: hora.optional(),
  sab_entrada: hora.optional(),
  sab_saida: hora.optional(),
  domingo_entrada: hora.optional(),
  domingo_saida: hora.optional(),
  sexo: z.enum(["M", "F", "I"]),
  idade: z.coerce.number().int().min(14).max(80),
  idade_ate: z.coerce.number().int().min(14).max(80).optional(),
  atividades: z.string().trim().min(3).max(4000),
  quantidade: z.coerce.number().int().min(1).max(20),
}).superRefine((value, ctx) => {
  const estagio = value.tipo === "estagio";
  const cargaOk = estagio ? value.carga_horaria === "20" || value.carga_horaria === "30" : value.carga_horaria === "40" || value.carga_horaria === "44";
  if (!cargaOk) ctx.addIssue({ code: "custom", message: estagio ? "Estágio usa carga 20 ou 30." : "CLT usa carga 40 ou 44.", path: ["carga_horaria"] });
  if (value.idade_ate !== undefined && value.idade_ate < value.idade) {
    ctx.addIssue({ code: "custom", message: "A idade final é menor que a inicial.", path: ["idade_ate"] });
  }
});

export type GrupoCreate = z.infer<typeof grupoCreateSchema>;
export type EmpresaCadastro = z.infer<typeof empresaCadastroSchema>;
export type VagaCadastro = z.infer<typeof vagaCadastroSchema>;
