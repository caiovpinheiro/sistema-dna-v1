/**
 * O Lightsail guarda o status antigo (0 a 9). O sistema novo mostra e filtra só estes quatro.
 * Nada muda no Lightsail: a conversão é feita na leitura, e a edição grava um código antigo equivalente.
 */
export const STATUS_VAGA = ["aberta", "pausada", "contratada", "fechada"] as const;
export type StatusVaga = (typeof STATUS_VAGA)[number];

export const CODIGOS_POR_STATUS: Record<StatusVaga, number[]> = {
  // 0 aberta, 3 candidato em análise, 4 confecção de contrato, 5 liberar vaga, 9 processo de venda.
  aberta: [0, 3, 4, 5, 9],
  pausada: [8],
  contratada: [1],
  // 2 demitida, 6 cancelada, 7 desativada.
  fechada: [2, 6, 7],
};

/** Código gravado quando a vaga muda para o status pela edição. */
const CODIGO_AO_EDITAR: Record<StatusVaga, number> = { aberta: 0, pausada: 8, contratada: 1, fechada: 6 };

export function statusDaVaga(codigo: number | string | null | undefined): StatusVaga {
  const numero = codigo == null || codigo === "" ? Number.NaN : Number(codigo);
  return STATUS_VAGA.find((status) => CODIGOS_POR_STATUS[status].includes(numero)) ?? "fechada";
}

/** Mantém o código atual se o status não mudou (por exemplo, uma vaga em "processo de venda" continua 9). */
export function codigoParaStatus(status: StatusVaga, codigoAtual?: number | string | null): number {
  if (codigoAtual != null && codigoAtual !== "" && statusDaVaga(codigoAtual) === status) return Number(codigoAtual);
  return CODIGO_AO_EDITAR[status];
}
