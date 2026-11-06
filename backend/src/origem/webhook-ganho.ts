import { resposta, type Resposta } from './resposta.js';
import { crmRequest } from './crm-dna.js';
import { normalizePhone } from './phone.js';
import {
  atualizarTipoVagaLead,
  getTrackerLeadByPhone,
  salvarPassagemEnviada,
  upsertTrackerLead,
} from './tracker-db.js';
import { campaignDisplayName } from './campaign-label.js';
import { STAGE_ATENDIMENTO_CANDIDATURA_ID, STAGE_ATENDIMENTO_IA_ID, STAGE_GANHO_ID, STAGE_SELETIVO_ID } from './crm-entradas.js';
import { getContactTrackingById, type ContactTrackingRecord } from './crm-tracking.js';
import type { TipoVaga } from './tipo-vaga.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
  }
  return null;
}

function campanhaDoNegocio(fields: unknown): string | null {
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    const item = asRecord(field);
    if (!item) continue;
    const key = `${readText(item.name, item.slug) || ''}`.toLowerCase();
    if (!key.includes('campanha')) continue;
    const value = readText(item.value);
    if (value) return value;
  }
  return null;
}

export async function webhookGanho(body: unknown): Promise<Resposta> {
  try {
    const root = asRecord(body) || {};
    const data = asRecord(root.data) || {};
    const deal = asRecord(root.deal) || asRecord(data.deal) || {};
    const contact = asRecord(root.contact) || asRecord(data.contact) || {};

    const dealId = readText(root.dealId, data.dealId, deal.id);
    let stageId = readText(root.stageId, data.stageId, deal.stageId);
    const contactId = readText(root.contactId, data.contactId, contact.id, deal.contactId);
    let telefone = readText(root.telefone, root.phone, data.telefone, data.phone, contact.telefone, contact.phone);
    let origemFallback = readText(root.origem, root.source, data.origem, data.source, contact.source);
    let campanhaFallback = readText(root.campanha, root.campaign, data.campanha, data.campaign);
    let headlineFallback: string | null = null;
    let tipoVaga: TipoVaga | null = null;
    let trackingSalvo: ContactTrackingRecord | null = null;

    if (!dealId && !telefone && !contactId) {
      return resposta(
        { success: false, message: 'Informe o dealId, o contactId ou o telefone.' },
        { status: 400 }
      );
    }

    if (dealId && (!telefone || !stageId)) {
      try {
        const detalhe = asRecord(await crmRequest<unknown>(`/api/deals/${dealId}`));
        const negocio = asRecord(detalhe?.deal) || asRecord(detalhe?.data) || detalhe;
        const contato = asRecord(negocio?.contact);
        stageId = stageId || readText(negocio?.stageId);
        telefone = telefone || readText(contato?.phone, contato?.telefone);
        origemFallback = origemFallback || readText(contato?.source);
        campanhaFallback = campanhaFallback || campanhaDoNegocio(negocio?.customFields);
      } catch (error) {
        console.warn('Não foi possível ler o negócio do ganho:', error);
      }
    }

    const atendimentoIa = stageId === STAGE_ATENDIMENTO_IA_ID;
    const passagem =
      stageId === STAGE_GANHO_ID
        ? 'ganho'
        : stageId === STAGE_SELETIVO_ID
          ? 'seletivo'
          : stageId === STAGE_ATENDIMENTO_CANDIDATURA_ID
            ? 'atendimento'
            : null;
    if (!passagem && !atendimentoIa) {
      return resposta({ success: true, ignored: true });
    }

    if (contactId) {
      try {
        const tracking = await getContactTrackingById(contactId);
        trackingSalvo = tracking;
        tipoVaga = tracking?.tipoVaga || null;
        telefone = telefone || tracking?.telefone || null;
        origemFallback = origemFallback || tracking?.origem || null;
        campanhaFallback = campanhaFallback || tracking?.campanha || null;
        headlineFallback = tracking?.headline || null;
      } catch (error) {
        console.warn('Não foi possível ler o contato do ganho:', error);
      }
    }

    const telefoneNormalizado = telefone ? normalizePhone(telefone) : '';
    const lead = telefoneNormalizado ? await getTrackerLeadByPhone(telefoneNormalizado) : null;

    let origem: string | null;
    let campanha: string | null;
    if (lead) {
      origem = lead.origem;
      campanha = lead.campanha || lead.headline;
      telefone = telefone || lead.telefone;
    } else {
      if (dealId && telefone && !campanhaFallback) {
        try {
          const detalhe = asRecord(await crmRequest<unknown>(`/api/deals/${dealId}`));
          const negocio = asRecord(detalhe?.deal) || asRecord(detalhe?.data) || detalhe;
          campanhaFallback = campanhaDoNegocio(negocio?.customFields);
          origemFallback = origemFallback || readText(asRecord(negocio?.contact)?.source);
        } catch (error) {
          console.warn('Não foi possível ler o negócio do ganho:', error);
        }
      }
      if (contactId && (!origemFallback || !campanhaFallback)) {
        try {
          const tracking = await getContactTrackingById(contactId);
          origemFallback = origemFallback || tracking?.origem || null;
          campanhaFallback = campanhaFallback || tracking?.campanha || null;
          headlineFallback = headlineFallback || tracking?.headline || null;
          telefone = telefone || tracking?.telefone || null;
          tipoVaga = tipoVaga || tracking?.tipoVaga || null;
        } catch (error) {
          console.warn('Não foi possível ler o contato do ganho:', error);
        }
      }
      origem = origemFallback;
      campanha = campanhaFallback || headlineFallback;
    }

    const campanhaVisivel = campaignDisplayName(campanha, lead?.headline || headlineFallback);
    const campanhaSalva = campanhaVisivel && campanhaVisivel !== 'Sem campanha' ? campanhaVisivel : campanha;
    if (telefoneNormalizado && !lead && (atendimentoIa || tipoVaga)) {
      await upsertTrackerLead({
        telefone: telefone || trackingSalvo?.telefone || telefoneNormalizado,
        telefone_normalizado: telefoneNormalizado,
        origem: trackingSalvo?.origem || origemFallback,
        campanha: trackingSalvo?.campanha || campanhaFallback,
        headline: trackingSalvo?.headline || headlineFallback,
        ctwa_clid: trackingSalvo?.ctwa_clid || null,
        fbclid: trackingSalvo?.fbclid || null,
        gclid: trackingSalvo?.gclid || null,
        referrer: trackingSalvo?.referrer || null,
        ad_id: trackingSalvo?.adId || null,
      });
    }
    if (tipoVaga && telefoneNormalizado) {
      await atualizarTipoVagaLead(telefoneNormalizado, tipoVaga);
    }
    if (trackingSalvo?.adId && telefoneNormalizado && lead) {
      await upsertTrackerLead({
        telefone: telefone || lead.telefone,
        telefone_normalizado: telefoneNormalizado,
        origem: lead.origem,
        campanha: lead.campanha,
        headline: lead.headline,
        ctwa_clid: lead.ctwa_clid,
        fbclid: lead.fbclid,
        gclid: lead.gclid,
        referrer: lead.referrer,
        ad_id: trackingSalvo.adId,
      });
    }
    if (atendimentoIa) {
      return resposta({
        success: true,
        tipo: tipoVaga,
        telefone: telefoneNormalizado || null,
      });
    }

    const entrouEm = new Date().toISOString();
    const referencia = dealId || contactId || telefoneNormalizado;
    if (!referencia || !passagem) {
      return resposta(
        { success: false, message: 'Informe o dealId, o contactId ou o telefone.' },
        { status: 400 }
      );
    }
    const salvo = await salvarPassagemEnviada({
      passagem,
      deal_id: referencia,
      contact_id: contactId,
      telefone: telefone || null,
      telefone_normalizado: telefoneNormalizado || null,
      origem,
      campanha: campanhaSalva,
      tipo_vaga: tipoVaga,
      ad_id: trackingSalvo?.adId || null,
      entrou_em: entrouEm,
    });

    return resposta({
      success: true,
      passagem,
      id: salvo.id,
      ganhoEm: salvo.ganho_em,
      tipo: tipoVaga,
      dealId,
      telefone: telefoneNormalizado || null,
      origem,
      campanha: campanhaVisivel || campanha,
    });
  } catch (error) {
    console.error('Erro ao gravar ganho:', error);
    return resposta(
      { success: false, message: 'Não foi possível gravar o ganho.' },
      { status: 500 }
    );
  }
}
