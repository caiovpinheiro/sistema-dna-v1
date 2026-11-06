/** Resposta no formato das rotas do app candidaturas: corpo JSON e código HTTP (200 quando não informado). */
export type Resposta = { status: number; body: Record<string, unknown> };

export function resposta(body: Record<string, unknown>, init?: { status?: number }): Resposta {
  return { status: init?.status ?? 200, body };
}
