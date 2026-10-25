export function parseMoney(value: string): number {
  const trimmed = value.trim().replace(/\s/g, "");
  if (!trimmed) throw new Error("vazio");
  let normalized = trimmed;
  if (trimmed.includes(",")) {
    const [inteiro, frac = ""] = trimmed.split(",");
    const milhar = frac.length === 3 && !inteiro.includes(".") && /^\d+$/.test(inteiro) && /^\d{3}$/.test(frac);
    normalized = milhar ? `${inteiro}${frac}` : `${inteiro.replace(/\./g, "")}.${frac}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error("invalido");
  return Number(normalized);
}

export function formatMoneyLegacy(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function moneyToNumber(value: string | null | undefined): number | null {
  if (!value || !value.trim()) return null;
  try {
    return parseMoney(value);
  } catch {
    return null;
  }
}
