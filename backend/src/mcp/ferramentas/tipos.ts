import type { z, ZodTypeAny } from "zod";
import { ESCOPO_LEITURA } from "../oauth.js";
import type { ContextoFerramenta, Ferramenta, ResultadoFerramenta } from "../registro.js";

/** Cria uma ferramenta somente leitura com os padrões da integração (escopo, tipo) e tipagem da entrada. */
export function definir<E extends ZodTypeAny>(
  f: Omit<Ferramenta<E>, "tipo" | "escopo" | "executar"> & { escopo?: string; executar(contexto: ContextoFerramenta, entrada: z.infer<E>): Promise<ResultadoFerramenta> },
): Ferramenta {
  return { tipo: "leitura", escopo: ESCOPO_LEITURA, ...f } as unknown as Ferramenta;
}

export const semAcento = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
