export function parseMoney(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("vazio");
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
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
