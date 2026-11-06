import { crmRequest, CrmApiError } from './crm-dna.js';
import type { ContactTracking } from './crm-tracking.js';
import {
  INFOJOBS_ORIGEM,
  isInfojobsTag,
  parseInfojobsNote,
} from './lead-origin.js';

interface CrmTag {
  id?: string | null;
  name?: string | null;
}

interface CrmNote {
  content?: string | null;
  text?: string | null;
}

interface CrmCustomField {
  name?: string | null;
  slug?: string | null;
  value?: unknown;
}

interface CrmDealDetail {
  id?: string;
  tags?: CrmTag[] | string[];
  notes?: CrmNote[] | string[];
  customFields?: CrmCustomField[];
}

interface CrmDealList {
  items?: Array<{ id?: string }>;
}

interface CrmNotesResponse {
  items?: CrmNote[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapDeal(payload: unknown): CrmDealDetail | null {
  const root = asRecord(payload);
  if (!root) return null;
  const nested = asRecord(root.deal) || asRecord(root.data);
  const deal = (nested || root) as CrmDealDetail;
  if (deal.id || deal.tags || deal.notes || deal.customFields) return deal;
  return null;
}

function campaignFromFields(fields?: CrmCustomField[]): string | null {
  for (const field of fields || []) {
    const key = `${field.name || ''} ${field.slug || ''}`.toLowerCase();
    if (!key.includes('campanha')) continue;
    if (typeof field.value === 'string' && field.value.trim()) return field.value.trim();
  }
  return null;
}

function tagsOf(deal: CrmDealDetail): Array<{ id?: string | null; name?: string | null } | string> {
  return deal.tags || [];
}

function noteTexts(notes?: CrmNote[] | string[]): string[] {
  return (notes || []).map((note) =>
    typeof note === 'string' ? note : note.content || note.text || ''
  );
}

async function readNotes(dealId: string): Promise<string[]> {
  try {
    const payload = await crmRequest<CrmNotesResponse | CrmNote[]>(`/api/deals/${dealId}/notes`);
    const items = Array.isArray(payload) ? payload : payload.items || [];
    return noteTexts(items);
  } catch (error) {
    if (error instanceof CrmApiError && error.status === 404) return [];
    console.warn('Não foi possível ler as notas do negócio:', error);
    return [];
  }
}

function hintsFromDeal(deal: CrmDealDetail, notes: string[]): ContactTracking | null {
  const tagged = tagsOf(deal).some((tag) => isInfojobsTag(tag));
  const fromNotes = notes.map(parseInfojobsNote).find(Boolean) || null;
  const fromFields = campaignFromFields(deal.customFields);

  if (!tagged && !fromNotes) return null;

  return {
    origem: INFOJOBS_ORIGEM,
    campanha: fromNotes || fromFields || 'Infojobs',
    headline: null,
    ctwa_clid: null,
    fbclid: null,
    gclid: null,
    referrer: null,
  };
}

async function dealHints(dealId: string): Promise<ContactTracking | null> {
  try {
    const deal = unwrapDeal(await crmRequest<unknown>(`/api/deals/${dealId}`));
    if (!deal) return null;
    const embeddedNotes = noteTexts(deal.notes);
    const notes = embeddedNotes.length > 0 ? embeddedNotes : await readNotes(dealId);
    return hintsFromDeal(deal, notes);
  } catch (error) {
    console.warn('Não foi possível ler o negócio para origem Infojobs:', error);
    return null;
  }
}

export async function getInfojobsDealTracking(input: {
  dealId?: string | null;
  contactId?: string | null;
}): Promise<ContactTracking | null> {
  if (input.dealId) {
    const fromDeal = await dealHints(input.dealId);
    if (fromDeal) return fromDeal;
  }

  if (!input.contactId) return null;

  try {
    const list = await crmRequest<CrmDealList>(
      `/api/deals?contactId=${encodeURIComponent(input.contactId)}&perPage=5`
    );
    for (const item of list.items || []) {
      if (!item.id) continue;
      const hints = await dealHints(item.id);
      if (hints?.origem === INFOJOBS_ORIGEM) return hints;
    }
  } catch (error) {
    console.warn('Não foi possível listar negócios para origem Infojobs:', error);
  }

  return null;
}
