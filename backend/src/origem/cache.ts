import { resumoOrigem } from "./resumo.js";
import type { Resposta } from "./resposta.js";

/**
 * A conta de leads lê o CRM com teto de chamadas por minuto e pode levar minutos.
 * O mesmo período fica guardado por 10 minutos, e pedidos iguais em andamento esperam o mesmo resultado.
 */
const VALIDADE_MS = 10 * 60 * 1000;
const guardados = new Map<string, { em: number; resposta: Promise<Resposta> }>();

export function origemComCache(from: string | null, to: string | null): Promise<Resposta> {
  const chave = `${from ?? ""}|${to ?? ""}`;
  const atual = guardados.get(chave);
  if (atual && Date.now() - atual.em < VALIDADE_MS) return atual.resposta;
  const resposta = resumoOrigem(from, to).then((resultado) => {
    // Erro não fica guardado: a próxima abertura tenta de novo.
    if (resultado.status !== 200) guardados.delete(chave);
    return resultado;
  });
  guardados.set(chave, { em: Date.now(), resposta });
  return resposta;
}
