export type Intervalo = {
  inicio: string;
  fim: string;
  anteriorInicio: string;
  anteriorFim: string;
  dias: number;
};

function iso(data: Date) {
  return data.toISOString().slice(0, 10);
}

function diaUtc(valor: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!match) return null;
  const data = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (data.getUTCFullYear() !== Number(match[1]) || data.getUTCMonth() + 1 !== Number(match[2]) || data.getUTCDate() !== Number(match[3])) return null;
  return data;
}

function somarDias(data: Date, dias: number) {
  const copia = new Date(data);
  copia.setUTCDate(copia.getUTCDate() + dias);
  return copia;
}

function hojeSp(agora: Date) {
  const texto = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
  return diaUtc(texto) ?? new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

export function intervaloDe(input: { dias?: number; de?: string; ate?: string }, agora = new Date()): Intervalo {
  let inicio: Date;
  let fimExclusivo: Date;
  if (input.de || input.ate) {
    if (!input.de || !input.ate) throw new Error("INTERVALO");
    const de = diaUtc(input.de);
    const ate = diaUtc(input.ate);
    if (!de || !ate || de > ate) throw new Error("INTERVALO");
    inicio = de;
    fimExclusivo = somarDias(ate, 1);
  } else {
    const dias = input.dias ?? 30;
    if (!Number.isInteger(dias) || dias < 1 || dias > 366) throw new Error("INTERVALO");
    const hoje = hojeSp(agora);
    fimExclusivo = somarDias(hoje, 1);
    inicio = somarDias(fimExclusivo, -dias);
  }
  const dias = Math.round((fimExclusivo.getTime() - inicio.getTime()) / 86_400_000);
  const anteriorFim = inicio;
  const anteriorInicio = somarDias(inicio, -dias);
  return {
    inicio: iso(inicio),
    fim: iso(fimExclusivo),
    anteriorInicio: iso(anteriorInicio),
    anteriorFim: iso(anteriorFim),
    dias,
  };
}

export const VAGA_ABERTA = 0;

export const DATA_LEGADO = (coluna: string) =>
  `CASE WHEN ${coluna} ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}' THEN to_date(left(${coluna}, 10), 'YYYY/MM/DD') END`;
