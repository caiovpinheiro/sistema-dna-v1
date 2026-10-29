import { z } from "zod";

const cnpj = z.string().trim().min(14, "Informe o CNPJ.").max(18);
const email = z.string().trim().email("Informe um e-mail válido.");
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data.");
const modalidade = z.enum(["direta", "estagio", "ambas"]);

const regimes = z.object({
  clt_indeterminado: z.boolean(),
  clt_determinado: z.boolean(),
  clt_intermitente: z.boolean(),
  autonomo: z.boolean(),
  pj: z.boolean(),
  outros: z.boolean(),
  outros_texto: z.string().trim().max(80).optional(),
});

export const documentoContratoSchema = z.object({
  modelo: z.literal("contrato"),
  razao_social: z.string().trim().min(3, "Informe a razão social da contratante."),
  cnpj,
  endereco: z.string().trim().min(8, "Informe o endereço completo."),
  email,
  data,
  modalidade,
  regimes,
  taxa_recrutamento_percentual: z.string().trim().max(12).optional(),
  vencimento_dias: z.string().trim().max(4).default("5"),
  garantia: z.enum(["sim", "nao"]).default("sim"),
  garantia_dias: z.string().trim().max(4).optional(),
  taxa_administrativa: z.string().trim().max(20).optional(),
  taxa_recrutamento_estagio: z.string().trim().max(20).optional(),
  vencimento_diverso: z.string().trim().max(80).optional(),
  conversao_12: z.enum(["isento", "percentual"]).default("isento"),
  conversao_percentual: z.string().trim().max(10).optional(),
  registro: z.string().trim().max(400).optional(),
  observacoes: z.string().trim().max(400).optional(),
});

export const documentoAdesaoSchema = z.object({
  modelo: z.literal("adesao"),
  razao_social: z.string().trim().min(3, "Informe a razão social da aderente."),
  cnpj,
  endereco: z.string().trim().min(8, "Informe o endereço da aderente."),
  email,
  contrato_data: data,
  contratante_razao: z.string().trim().min(3, "Informe a razão social da contratante signatária."),
  contratante_cnpj: cnpj,
  modalidade,
  condicoes: z.enum(["anexo_contrato", "anexo_especifico"]),
  responsavel: z.string().trim().min(3, "Informe o responsável."),
  cargo: z.string().trim().min(2, "Informe o cargo."),
  email_faturamento: email,
  telefone: z.string().trim().min(8, "Informe o telefone."),
  endereco_faturamento: z.string().trim().min(8, "Informe o endereço de faturamento."),
  local: z.string().trim().min(2, "Informe o local.").max(80),
  data,
});

export const documentoSchema = z.discriminatedUnion("modelo", [documentoContratoSchema, documentoAdesaoSchema]);

export type DocumentoGerado = z.infer<typeof documentoSchema>;
