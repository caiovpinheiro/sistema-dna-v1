import { crmRequest } from './crm-dna.js';
import { firstHumanCampaign } from './campaign-label.js';
import { canonicalOrigem } from './lead-origin.js';
import { tipoVagaDoContato, type TipoVaga } from './tipo-vaga.js';

export interface ContactTracking {
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  ctwa_clid: string | null;
  fbclid: string | null;
  gclid: string | null;
  referrer: string | null;
}

export interface ContactTrackingRecord extends ContactTracking {
  telefone: string;
  tipoVaga: TipoVaga | null;
  adId: string | null;
}

interface CrmContactTracking {
  id?: string;
  phone?: string | null;
  source?: string | null;
  referrer?: string | null;
  utmReferrer?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  adUtmSource?: string | null;
  adUtmCampaign?: string | null;
  adHeadline?: string | null;
  adCtwaClid?: string | null;
  adId?: string | null;
  adSourceId?: string | null;
  adResolvedId?: string | null;
  adResolvedCampaignName?: string | null;
  adResolvedName?: string | null;
  ttadId?: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function detectOrigem(input: {
  referrer?: string | null;
  source?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  ttadId?: string | null;
  adUtmSource?: string | null;
  adSourceType?: string | null;
  adCtwaClid?: string | null;
}): string | null {
  const utm = (input.adUtmSource || '').trim().toLowerCase();
  const blob = [input.referrer, input.adUtmSource, input.adCtwaClid]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    input.adSourceType?.trim().toLowerCase() === 'ad' ||
    input.adCtwaClid ||
    input.fbclid ||
    ['ig', 'fb', 'an', 'meta', 'instagram', 'facebook'].includes(utm) ||
    blob.includes('instagram') ||
    blob.includes('facebook') ||
    blob.includes('fb.me') ||
    blob.includes('fb.com')
  ) {
    return 'meta';
  }
  if (blob.includes('google') || blob.includes('gclid') || input.gclid) return 'google';
  if (blob.includes('tiktok') || input.ttadId) return 'tiktok';
  if (blob.includes('infojobs') || blob.includes('pandape') || blob.includes('pandapé')) {
    return 'infojobs';
  }
  if (blob.includes('whatsapp')) return 'whatsapp';
  return canonicalOrigem(input.source) || text(input.source);
}

function toTracking(contact: CrmContactTracking): ContactTracking {
  const referrer = text(contact.referrer) || text(contact.utmReferrer);
  const headline = text(contact.adHeadline) || text(contact.adResolvedName);
  const campanha = firstHumanCampaign(
    text(contact.adResolvedCampaignName),
    headline,
    text(contact.adUtmCampaign)
  );

  return {
    origem: detectOrigem({
      referrer,
      source: contact.source,
      gclid: contact.gclid,
      fbclid: contact.fbclid,
      ttadId: contact.ttadId,
      adUtmSource: contact.adUtmSource,
    }),
    campanha,
    headline,
    ctwa_clid: text(contact.adCtwaClid),
    fbclid: text(contact.fbclid),
    gclid: text(contact.gclid),
    referrer,
  };
}

interface CrmContactsResponse {
  items?: CrmContactTracking[];
}

function withPhone(contact: CrmContactTracking, fallbackPhone?: string | null): ContactTrackingRecord | null {
  const telefone = text(contact.phone) || text(fallbackPhone);
  if (!telefone) return null;
  return {
    telefone,
    tipoVaga: tipoVagaDoContato(contact),
    adId: text(contact.adId) || text(contact.adSourceId) || text(contact.adResolvedId),
    ...toTracking(contact),
  };
}

export async function getContactTrackingById(contactId: string): Promise<ContactTrackingRecord | null> {
  const detail = await crmRequest<CrmContactTracking>(`/api/contacts/${contactId}`);
  return withPhone(detail);
}

export async function getContactTrackingByPhone(phone: string): Promise<ContactTrackingRecord | null> {
  const list = await crmRequest<CrmContactsResponse>(
    `/api/contacts?phone=${encodeURIComponent(phone)}&includeTracking=1&perPage=1`
  );
  const summary = list.items?.[0];
  if (!summary?.id) return null;

  try {
    const detail = await crmRequest<CrmContactTracking>(`/api/contacts/${summary.id}`);
    return withPhone({ ...summary, ...detail }, phone);
  } catch (error) {
    console.warn('Não foi possível ler o detalhe de tracking do CRM:', error);
    return withPhone(summary, phone);
  }
}
