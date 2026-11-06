import { crmRequest } from './crm-dna.js';

const CAMPAIGN_FIELD = 'campanha';

interface CrmDeal {
  id?: string;
  stageId?: string;
  status?: string;
  updatedAt?: string;
}

interface CrmDealList {
  items?: CrmDeal[];
}

function toCrmPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `+${digits}` : trimmed;
}

async function pickDeal(items?: CrmDeal[]): Promise<CrmDeal | null> {
  const open = (items || []).filter((deal) => deal.id && deal.stageId);
  return open.find((deal) => deal.status === 'OPEN') || open[0] || null;
}

async function findDealToUpdate(input: {
  contactId?: string | null;
  dealId?: string | null;
  telefone: string;
}): Promise<CrmDeal | null> {
  if (input.dealId) {
    try {
      const deal = await crmRequest<CrmDeal>(`/api/deals/${input.dealId}`);
      if (deal?.id && deal.stageId) return deal;
    } catch (error) {
      console.warn('Não foi possível ler o negócio informado no webhook:', error);
    }
  }

  if (input.contactId) {
    const list = await crmRequest<CrmDealList>(
      `/api/deals?contactId=${encodeURIComponent(input.contactId)}&perPage=10`
    );
    const deal = await pickDeal(list.items);
    if (deal) return deal;
  }

  const digits = input.telefone.replace(/\D/g, '');
  const list = await crmRequest<CrmDealList>(
    `/api/deals?search=${encodeURIComponent(digits)}&perPage=10`
  );
  return pickDeal(list.items);
}

export async function saveDealCampaign(input: {
  telefone: string;
  campanha: string;
  origem?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}): Promise<void> {
  const campanha = input.campanha.trim();
  const telefone = toCrmPhone(input.telefone);
  if (!campanha || !telefone) return;

  const deal = await findDealToUpdate({
    contactId: input.contactId,
    dealId: input.dealId,
    telefone,
  });
  if (!deal?.id || !deal.stageId) {
    console.warn('Sem negócio para gravar a campanha no CRM.');
    return;
  }

  const origem = input.origem?.trim();

  await crmRequest('/api/leads', {
    method: 'POST',
    body: JSON.stringify({
      contact: {
        phone: telefone,
        ...(origem ? { source: origem } : {}),
      },
      deal: {
        stageId: deal.stageId,
        customFields: [{ name: CAMPAIGN_FIELD, value: campanha }],
      },
      options: {
        reuseOpenDeal: true,
        fillEmptyContactFieldsOnly: true,
      },
    }),
  });
}
