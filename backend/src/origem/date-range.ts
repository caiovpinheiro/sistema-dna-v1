export const MAX_RANGE_MONTHS = 3;

export type PeriodPreset = '7d' | '1m' | '3m';

const BRASILIA = 'America/Sao_Paulo';

export function brasiliaTodayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isoToBr(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function formatBrasilia(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRASILIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00.000-03:00`);
  date.setDate(date.getDate() + days);
  return formatBrasilia(date);
}

export function addMonthsIso(iso: string, months: number): string {
  const date = new Date(`${iso}T12:00:00.000-03:00`);
  date.setMonth(date.getMonth() + months);
  return formatBrasilia(date);
}

export function rangeForPreset(preset: PeriodPreset): { from: string; to: string } {
  const to = brasiliaTodayIso();
  if (preset === '7d') return { from: addDaysIso(to, -6), to };
  if (preset === '1m') return { from: addMonthsIso(to, -1), to };
  return { from: addMonthsIso(to, -3), to };
}

export function clampOrigemRange(
  from?: string | null,
  to?: string | null
): { from: string; to: string } {
  if (!from && !to) return rangeForPreset('7d');

  const today = brasiliaTodayIso();
  let end = to && to <= today ? to : today;
  const minFrom = addMonthsIso(end, -MAX_RANGE_MONTHS);
  let start = from || addDaysIso(end, -6);
  if (start > end) start = end;
  if (start < minFrom) start = minFrom;
  return { from: start, to: end };
}
