import { z } from "zod";
import { isRealIsoDate } from "../lib/dates.js";
import { isValidCep, isValidCnpj, isValidCpf, isValidPhone, onlyDigits } from "../lib/normalize.js";
import { parseMoney } from "../lib/money.js";

export const isoDateSchema = z.string().refine(isRealIsoDate, "Data inválida. Use AAAA-MM-DD.");

export const cpfSchema = z.string().transform(onlyDigits).refine(isValidCpf, "CPF inválido.");
export const cnpjSchema = z.string().transform(onlyDigits).refine(isValidCnpj, "CNPJ inválido.");

export const optionalPhone = z
  .string()
  .optional()
  .transform((value) => (value ? onlyDigits(value) : undefined))
  .refine((value) => value === undefined || isValidPhone(value), "Telefone inválido.");

export const optionalCep = z
  .string()
  .optional()
  .transform((value) => (value ? onlyDigits(value) : undefined))
  .refine((value) => value === undefined || isValidCep(value), "CEP inválido.");

export const optionalEmail = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value.toLowerCase() : undefined))
  .refine((value) => value === undefined || z.string().email().safeParse(value).success, "E-mail inválido.");

export const moneySchema = z.string().refine((value) => {
  try {
    parseMoney(value);
    return true;
  } catch {
    return false;
  }
}, "Valor inválido.");

export const pageSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
};

export const ufSchema = z
  .string()
  .trim()
  .length(2)
  .transform((value) => value.toUpperCase())
  .optional();

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
    meta: z.record(z.unknown()).optional(),
  });
}
