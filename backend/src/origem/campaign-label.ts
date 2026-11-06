import { infojobsVacancyId, titleForInfojobsId } from './infojobs-vacancies.js';

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

const CARGO_PATTERNS: RegExp[] = [
  /operador(?:a)?\s+de\s+loja/i,
  /operador(?:a)?\s+de\s+caixa/i,
  /balconista\s+de\s+padaria/i,
  /balconista/i,
  /a[cç]ougueiro(?:a)?/i,
  /repositor(?:a)?/i,
  /auxiliar\s+de\s+[a-záéíóúãõç]+/i,
  /assistente\s+de\s+[a-záéíóúãõç]+/i,
  /atendente/i,
  /vendedor(?:a)?/i,
  /padeiro(?:a)?/i,
  /confeiteiro(?:a)?/i,
];

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function resolveInfojobsCampaign(value?: string | null): string {
  const decoded = decodeHtmlEntities(value);
  if (!decoded) return '';
  return titleForInfojobsId(infojobsVacancyId(decoded)) || decoded;
}

export function decodeHtmlEntities(value?: string | null): string {
  if (!value) return '';
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .trim();
}

export function looksLikeMachineId(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return true;
  if (/\s/.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9_-]{8,15}$/.test(trimmed)) return true;
  return false;
}

export function campaignDisplayName(
  campanha?: string | null,
  headline?: string | null
): string {
  const campanhaDecoded = resolveInfojobsCampaign(campanha);
  const headlineDecoded = resolveInfojobsCampaign(headline);
  if (campanhaDecoded && !looksLikeMachineId(campanhaDecoded)) return campanhaDecoded;
  if (headlineDecoded && !looksLikeMachineId(headlineDecoded)) return headlineDecoded;
  if (campanhaDecoded) return campanhaDecoded;
  return 'Sem campanha';
}

export function isNamedCampaign(name?: string | null): boolean {
  const trimmed = name?.trim();
  return Boolean(trimmed) && trimmed !== 'Sem campanha';
}

export function firstHumanCampaign(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const trimmed = resolveInfojobsCampaign(value);
    if (trimmed && !looksLikeMachineId(trimmed)) return trimmed;
  }
  return null;
}

function titleCasePt(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

function foldOcr(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\(a\)/gi, ' ')
    .replace(/ac\s*ougueiro/gi, 'acougueiro')
    .replace(/depadaria/gi, 'de padaria')
    .replace(/deloza|deloia/gi, 'de loja')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCargo(text: string): string | null {
  const softened = foldOcr(text).replace(/\b[a-z]\b/gi, ' ').replace(/\s+/g, ' ');
  if (/(?:o)?perador/i.test(softened) && /loja/i.test(softened)) return 'Operador de Loja';
  if (/balconista/i.test(softened) && /padaria/i.test(softened)) return 'Balconista de Padaria';
  if (/operador/i.test(softened) && /caixa/i.test(softened)) return 'Operador de Caixa';
  if (/ajudante\s+geral/i.test(softened)) return 'Ajudante Geral';
  if (/acougueiro/i.test(softened)) return 'Açougueiro';
  for (const pattern of CARGO_PATTERNS) {
    const match = softened.match(pattern);
    if (match?.[0]) return titleCasePt(match[0]);
  }
  return null;
}

const PLACES: Array<[RegExp, string]> = [
  [/zona\s+norte/i, 'Zona Norte'],
  [/zona\s+sul/i, 'Zona Sul'],
  [/zona\s+leste/i, 'Zona Leste'],
  [/zona\s+oeste/i, 'Zona Oeste'],
  [/zona\s+central/i, 'Zona Central'],
  [/s[aã]o\s+vicente/i, 'São Vicente'],
  [/mongagu[aá]/i, 'Mongaguá'],
  [/guaruj[aá]/i, 'Guarujá'],
  [/praia\s+grande/i, 'Praia Grande'],
  [/santo\s+andr[eé]/i, 'Santo André'],
  [/s[aã]o\s+bernardo/i, 'São Bernardo'],
  [/osasco/i, 'Osasco'],
  [/guarulhos/i, 'Guarulhos'],
  [/cumbica/i, 'Guarulhos'],
];

function extractPlace(ocrText: string, headline?: string | null): string | null {
  const blob = `${ocrText} ${headline || ''}`;
  for (const [pattern, name] of PLACES) {
    if (pattern.test(blob)) return name;
  }
  return null;
}

export function parseCampaignLabel(
  ocrText: string,
  headline?: string | null
): string | null {
  const cargo = extractCargo(ocrText) || extractCargo(headline || '');
  const place = extractPlace(ocrText, headline);
  if (cargo && place) return `${cargo}, ${place}`;
  if (cargo) return cargo;
  return firstHumanCampaign(headline);
}

export function campaignOcrHasCargo(ocrText: string): boolean {
  return Boolean(extractCargo(ocrText));
}
