/**
 * Normaliza um número de telefone brasileiro para o formato E.164.
 * Remove tudo que não for dígito, descarta prefixo 0 e adiciona 55 quando necessário.
 * Retorna null se o número não parecer válido (menos de 10 dígitos úteis).
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length === 11 || digits.length === 10) {
    digits = `55${digits}`;
  }

  if (digits.length < 12 || digits.length > 13) {
    return null;
  }

  if (!digits.startsWith('55')) {
    return null;
  }

  return digits;
}
