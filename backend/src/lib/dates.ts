export function legacyToday(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function isoToLegacy(iso: string): string {
  return iso.slice(0, 10).replaceAll("-", "/");
}

export function legacyToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "null//") return null;
  const ymd = trimmed.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const dmy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
