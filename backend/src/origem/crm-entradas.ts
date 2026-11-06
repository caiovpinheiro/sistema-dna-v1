import { crmRequest, CrmApiError } from './crm-dna.js';
import { getTrackerLeadByPhone } from './tracker-db.js';
import { normalizePhone } from './phone.js';
import { firstHumanCampaign } from './campaign-label.js';
import { detectOrigem, type ContactTracking } from './crm-tracking.js';
import { isInfojobsTag, mergeLeadTracking } from './lead-origin.js';

export interface EntradaCrm extends ContactTracking {
  telefoneNormalizado: string | null;
}

interface CrmTag {
  id?: string | null;
  name?: string | null;
}

interface CrmCampo {
  name?: string | null;
  slug?: string | null;
  value?: unknown;
}

interface CrmContatoLista {
  id?: string;
  phone?: string | null;
  source?: string | null;
  createdAt?: string | null;
  referrer?: string | null;
  utmReferrer?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  adUtmSource?: string | null;
  adUtmCampaign?: string | null;
  adUtmContent?: string | null;
  adHeadline?: string | null;
  adResolvedCampaignName?: string | null;
  adResolvedName?: string | null;
  adCtwaClid?: string | null;
  adSourceType?: string | null;
  ttadId?: string | null;
  ttadName?: string | null;
  tags?: Array<CrmTag | string>;
  customFields?: unknown;
}

interface CrmLista {
  items?: CrmContatoLista[];
  totalPages?: number;
}

interface CrmNegocioLista {
  id?: string;
  createdAt?: string | null;
  contactId?: string | null;
  contact?: {
    id?: string | null;
    phone?: string | null;
    source?: string | null;
    tags?: CrmTag[] | string[];
  } | null;
  tags?: CrmTag[] | string[];
}

interface CrmNegociosLista {
  items?: CrmNegocioLista[];
  totalPages?: number;
}

const STAGE_LEAD_ENTRADA_ID = 'cmuwy4al20inhpq016r5o75gn';
export const STAGE_GANHO_ID = 'c4682cb0a16da46e88f3ad82b196e4e45';
export const STAGE_ENVIADA_ID = 'cmq0moi0n0a09p601iwxl56uz';
export const STAGE_SELETIVO_ID = 'cmq0lqtoo09zup601ofbwckk0';
export const STAGE_ATENDIMENTO_CANDIDATURA_ID = 'cmq0mnxrf0a05p601t9n73t1f';
export const STAGE_ATENDIMENTO_IA_ID = 'cmusnlu5416nrmg01rme7zzka';

interface CrmMarco {
  type?: string;
  createdAt?: string | null;
  meta?: { to?: { id?: string | null } | null } | null;
}

const LIMITE_POR_MINUTO = 240;
const JANELA_MS = 60_000;
const INTERVALO_MS = Math.ceil(JANELA_MS / LIMITE_POR_MINUTO);
const marcas: number[] = [];
let fila: Promise<void> = Promise.resolve();

function reservarChamada(): Promise<void> {
  const vez = fila.then(async () => {
    for (;;) {
      const agora = Date.now();
      while (marcas.length && agora - marcas[0] >= JANELA_MS) marcas.shift();
      const desdeUltima = marcas.length ? agora - marcas[marcas.length - 1] : INTERVALO_MS;
      if (marcas.length < LIMITE_POR_MINUTO && desdeUltima >= INTERVALO_MS) {
        marcas.push(Date.now());
        return;
      }
      const esperaJanela =
        marcas.length >= LIMITE_POR_MINUTO ? JANELA_MS - (agora - marcas[0]) + 25 : 0;
      const esperaIntervalo = Math.max(0, INTERVALO_MS - desdeUltima);
      await new Promise((resolve) => setTimeout(resolve, Math.max(esperaJanela, esperaIntervalo, 25)));
    }
  });
  fila = vez.then(
    () => undefined,
    () => undefined
  );
  return vez;
}

function texto(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function camposDe(fields: unknown): CrmCampo[] {
  if (Array.isArray(fields)) return fields;
  if (!fields || typeof fields !== 'object') return [];
  return Object.entries(fields as Record<string, unknown>).map(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const item = value as CrmCampo;
      return { name: texto(item.name) || key, slug: texto(item.slug) || key, value: item.value };
    }
    return { name: key, slug: key, value };
  });
}

function campanhaDosCampos(fields: unknown): string | null {
  for (const field of camposDe(fields)) {
    const key = `${field.name || ''} ${field.slug || ''}`.toLowerCase();
    if (!key.includes('campanha')) continue;
    const value = texto(field.value);
    if (value) return value;
  }
  return null;
}

function noPeriodo(createdAt: string | null | undefined, from: string, to: string): boolean {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return false;
  const inicio = new Date(`${from}T00:00:00.000-03:00`).getTime();
  const fim = new Date(`${to}T23:59:59.999-03:00`).getTime();
  return time >= inicio && time <= fim;
}

function valorCampo(fields: unknown, pattern: RegExp): string | null {
  for (const field of camposDe(fields)) {
    const key = `${field.slug || ''} ${field.name || ''}`;
    if (!pattern.test(key)) continue;
    const value = texto(field.value);
    if (value) return value;
  }
  return null;
}

export function entradaDoContato(contato: CrmContatoLista): EntradaCrm {
  const referrer = texto(contato.referrer) || texto(contato.utmReferrer) || valorCampo(contato.customFields, /referrer/i);
  const headline = texto(contato.adHeadline) || texto(contato.adResolvedName);
  const utmSource = texto(contato.adUtmSource) || valorCampo(contato.customFields, /utm[_ ]?source/i);
  const rastreio: ContactTracking = {
    origem: detectOrigem({
      referrer,
      source: contato.source,
      gclid: contato.gclid,
      fbclid: contato.fbclid,
      ttadId: contato.ttadId,
      adUtmSource: utmSource,
      adSourceType: texto(contato.adSourceType),
      adCtwaClid: texto(contato.adCtwaClid),
    }),
    campanha: firstHumanCampaign(
      texto(contato.adResolvedCampaignName),
      headline,
      texto(contato.adUtmCampaign),
      texto(contato.adUtmContent),
      texto(contato.ttadName),
      campanhaDosCampos(contato.customFields)
    ),
    headline,
    ctwa_clid: texto(contato.adCtwaClid),
    fbclid: texto(contato.fbclid),
    gclid: texto(contato.gclid),
    referrer,
  };
  const infojobs = (Array.isArray(contato.tags) ? contato.tags : []).some((tag) => isInfojobsTag(tag));
  const tracking = infojobs
    ? mergeLeadTracking(rastreio, {
        origem: 'infojobs',
        campanha: null,
        headline: null,
        ctwa_clid: null,
        fbclid: null,
        gclid: null,
        referrer: null,
      })
    : rastreio;

  return {
    ...tracking,
    telefoneNormalizado: normalizePhone(texto(contato.phone) || '') || null,
  };
}

async function paginaEntrada(from: string, to: string, page: number): Promise<CrmNegociosLista> {
  await reservarChamada();
  const params = new URLSearchParams({
    stageId: STAGE_LEAD_ENTRADA_ID,
    perPage: '200',
    page: String(page),
    createdFrom: from,
    createdTo: to,
  });
  return crmRequest<CrmNegociosLista>(`/api/deals?${params.toString()}`);
}

function contatoDoNegocio(negocio: CrmNegocioLista): CrmContatoLista {
  const contact = negocio.contact;
  return {
    id: negocio.contactId || contact?.id || undefined,
    phone: contact?.phone,
    source: contact?.source,
    createdAt: negocio.createdAt,
    tags: [...(negocio.tags || []), ...(contact?.tags || [])],
  };
}

function temRastro(contato: CrmContatoLista): boolean {
  return Boolean(
    texto(contato.referrer) ||
      texto(contato.utmReferrer) ||
      texto(contato.adCtwaClid) ||
      texto(contato.adSourceType) ||
      texto(contato.adUtmSource) ||
      texto(contato.fbclid)
  );
}

async function completarContato(contato: CrmContatoLista): Promise<CrmContatoLista> {
  if (!contato.id || temRastro(contato)) return contato;
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    await reservarChamada();
    try {
      const detalhe = await crmRequest<CrmContatoLista>(`/api/contacts/${contato.id}`);
      return {
        ...contato,
        ...detalhe,
        id: contato.id,
        createdAt: contato.createdAt,
        phone: detalhe.phone || contato.phone,
        source: detalhe.source || contato.source,
      };
    } catch (error) {
      if (error instanceof CrmApiError && error.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      console.warn('Não foi possível ler o contato para a origem.');
      return contato;
    }
  }
  return contato;
}

export async function listEntradasCrm(range: { from: string; to: string }): Promise<EntradaCrm[]> {
  const itens: CrmNegocioLista[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const resposta = await paginaEntrada(range.from, range.to, page);
    const lote = resposta.items || [];
    itens.push(...lote);
    if (resposta.totalPages && page >= resposta.totalPages) break;
    if (lote.length < 200) break;
  }

  const porChave = new Map<string, EntradaCrm>();
  for (const negocio of itens) {
    const contato = contatoDoNegocio(negocio);
    if (!noPeriodo(contato.createdAt, range.from, range.to)) continue;
    const completo = await completarContato(contato);
    const entrada = entradaDoContato(completo);
    const chave = entrada.telefoneNormalizado || `id:${contato.id || porChave.size}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, entrada);
      continue;
    }
    porChave.set(chave, {
      ...mergeLeadTracking(atual, entrada),
      telefoneNormalizado: atual.telefoneNormalizado || entrada.telefoneNormalizado,
    });
  }
  return [...porChave.values()];
}

async function crmComEspera<T>(path: string): Promise<T> {
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    await reservarChamada();
    try {
      return await crmRequest<T>(path);
    } catch (error) {
      if (error instanceof CrmApiError && error.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      throw error;
    }
  }
  throw new CrmApiError('Limite de requisições excedido. Tente novamente em breve.', 429);
}

function entrouNoEstagio(
  eventos: CrmMarco[],
  stageId: string,
  createdAt: string | null | undefined,
  from: string,
  to: string
): boolean {
  const entradas = eventos.filter(
    (evento) => evento.type === 'STAGE_CHANGED' && evento.meta?.to?.id === stageId
  );
  if (entradas.length) return entradas.some((evento) => noPeriodo(evento.createdAt, from, to));
  return noPeriodo(createdAt, from, to);
}

async function listarEstagioCrm(
  stageId: string,
  range: { from: string; to: string }
): Promise<EntradaCrm[]> {
  const negocios: CrmNegocioLista[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const params = new URLSearchParams({
      stageId,
      perPage: '200',
      page: String(page),
    });
    const resposta = await crmComEspera<CrmNegociosLista>(`/api/deals?${params.toString()}`);
    const lote = resposta.items || [];
    negocios.push(...lote);
    if (resposta.totalPages && page >= resposta.totalPages) break;
    if (lote.length < 200) break;
  }

  const porChave = new Map<string, EntradaCrm>();
  for (const negocio of negocios) {
    if (!negocio.id) continue;
    const linha = await crmComEspera<CrmMarco[] | { items?: CrmMarco[] }>(
      `/api/deals/${negocio.id}/timeline`
    ).catch(() => []);
    const eventos = Array.isArray(linha) ? linha : linha.items || [];
    if (!entrouNoEstagio(eventos, stageId, negocio.createdAt, range.from, range.to)) continue;

    const completo = await completarContato(contatoDoNegocio(negocio));
    let entrada = entradaDoContato(completo);
    if (entrada.telefoneNormalizado) {
      const salvo = await getTrackerLeadByPhone(entrada.telefoneNormalizado).catch(() => null);
      if (salvo) {
        entrada = {
          ...mergeLeadTracking(entrada, {
            origem: salvo.origem,
            campanha: salvo.campanha,
            headline: salvo.headline,
            ctwa_clid: salvo.ctwa_clid,
            fbclid: salvo.fbclid,
            gclid: salvo.gclid,
            referrer: salvo.referrer,
          }),
          telefoneNormalizado: entrada.telefoneNormalizado,
        };
      }
    }

    const chave = entrada.telefoneNormalizado || `id:${completo.id || negocio.id}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, entrada);
      continue;
    }
    porChave.set(chave, {
      ...mergeLeadTracking(atual, entrada),
      telefoneNormalizado: atual.telefoneNormalizado || entrada.telefoneNormalizado,
    });
  }
  return [...porChave.values()];
}

export function listarGanhosCrm(range: { from: string; to: string }): Promise<EntradaCrm[]> {
  return listarEstagioCrm(STAGE_GANHO_ID, range);
}
