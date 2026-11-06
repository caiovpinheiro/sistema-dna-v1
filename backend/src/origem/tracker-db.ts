import { supabaseRest } from "../lib/supabase-rest.js";

/**
 * Tabelas tracker_leads e tracker_ganhos: só no Supabase (o Postgres não tem cópia).
 * Mesmas leituras e gravações do app candidaturas (src/lib/supabase-server.ts), pela API REST.
 */
function rest() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.");
  return supabaseRest({ url, key });
}

const enc = encodeURIComponent;

/** Brasília: o período é de 00:00 do dia inicial a 23:59:59.999 do final, em -03:00. */
function filtroPeriodo(coluna: string, range?: { from?: string | null; to?: string | null }) {
  const partes: string[] = [];
  if (range?.from) partes.push(`${coluna}=gte.${enc(`${range.from}T00:00:00.000-03:00`)}`);
  if (range?.to) partes.push(`${coluna}=lte.${enc(`${range.to}T23:59:59.999-03:00`)}`);
  return partes.length ? `&${partes.join("&")}` : "";
}

/** Lê todas as páginas (1000 por vez). */
async function todas<T>(caminho: string): Promise<T[]> {
  const linhas: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const pagina = await rest().get<T[]>(`${caminho}&limit=1000&offset=${offset}`);
    if (!pagina?.length) break;
    linhas.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return linhas;
}

export interface TrackerLeadRecord {
  id: string;
  telefone: string;
  telefone_normalizado: string;
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  ctwa_clid: string | null;
  fbclid: string | null;
  gclid: string | null;
  referrer: string | null;
}

export async function getTrackerLeadByPhone(telefoneNormalizado: string): Promise<TrackerLeadRecord | null> {
  const linhas = await rest().get<TrackerLeadRecord[]>(
    `tracker_leads?select=id,telefone,telefone_normalizado,origem,campanha,headline,ctwa_clid,fbclid,gclid,referrer&telefone_normalizado=eq.${enc(telefoneNormalizado)}&limit=1`,
  );
  return linhas[0] ?? null;
}

async function idDoLead(telefoneNormalizado: string): Promise<string | null> {
  const linhas = await rest().get<Array<{ id: string }>>(`tracker_leads?select=id&telefone_normalizado=eq.${enc(telefoneNormalizado)}&limit=1`);
  return linhas[0]?.id ?? null;
}

export async function upsertTrackerLead(input: {
  telefone: string;
  telefone_normalizado: string;
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  ctwa_clid: string | null;
  fbclid: string | null;
  gclid: string | null;
  referrer: string | null;
  ad_id?: string | null;
}): Promise<void> {
  const payload = {
    telefone: input.telefone,
    telefone_normalizado: input.telefone_normalizado,
    origem: input.origem,
    campanha: input.campanha,
    headline: input.headline,
    ctwa_clid: input.ctwa_clid,
    fbclid: input.fbclid,
    gclid: input.gclid,
    referrer: input.referrer,
    ...(input.ad_id ? { ad_id: input.ad_id } : {}),
  };
  const id = await idDoLead(input.telefone_normalizado);
  if (id) {
    await rest().update(`tracker_leads?id=eq.${enc(id)}`, payload);
    return;
  }
  await rest().insert("tracker_leads", payload);
}

export interface TrackerLeadRow {
  id: string;
  telefone: string;
  telefone_normalizado: string;
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  referrer: string | null;
  tipo_vaga: string | null;
  created_at: string;
}

export async function updateTrackerLeadCampaign(telefoneNormalizado: string, campanha: string): Promise<void> {
  await rest().update(`tracker_leads?telefone_normalizado=eq.${enc(telefoneNormalizado)}`, { campanha });
}

export interface PassagemEnviadaRow {
  id: string;
  telefone_normalizado: string | null;
  origem: string | null;
  campanha: string | null;
  tipo_vaga: string | null;
  entrou_em: string;
}

async function listPassagens(
  passagem: "seletivo" | "ganho" | "atendimento",
  range?: { from?: string | null; to?: string | null },
): Promise<PassagemEnviadaRow[]> {
  const linhas = await todas<{
    id: string; telefone_normalizado: string | null; origem: string | null; campanha: string | null; tipo_vaga: string | null; ganho_em: string;
  }>(`tracker_ganhos?select=id,telefone_normalizado,origem,campanha,tipo_vaga,ganho_em&passagem=eq.${passagem}&order=ganho_em.desc${filtroPeriodo("ganho_em", range)}`);
  return linhas.map((row) => ({
    id: row.id,
    telefone_normalizado: row.telefone_normalizado,
    origem: row.origem,
    campanha: row.campanha,
    tipo_vaga: row.tipo_vaga,
    entrou_em: row.ganho_em,
  }));
}

/** Processo seletivo realizado (no JSON a chave se chama "enviadas", como no outro app). */
export function listPassagensEnviadas(range?: { from?: string | null; to?: string | null }) {
  return listPassagens("seletivo", range);
}

export function listPassagensGanhos(range?: { from?: string | null; to?: string | null }) {
  return listPassagens("ganho", range);
}

export function listPassagensAtendimento(range?: { from?: string | null; to?: string | null }) {
  return listPassagens("atendimento", range);
}

/** Uma linha por passagem. deal_id = {idDoNegocio}:{ganho_em}; se a chave já existe, devolve a linha sem duplicar. */
export async function salvarPassagemEnviada(input: {
  passagem: "seletivo" | "ganho" | "atendimento";
  deal_id: string;
  contact_id: string | null;
  telefone: string | null;
  telefone_normalizado: string | null;
  origem: string | null;
  campanha: string | null;
  tipo_vaga: "clt" | "estagio" | null;
  ad_id: string | null;
  entrou_em: string;
}): Promise<{ id: string; ganho_em: string }> {
  const dealKey = `${input.deal_id}:${input.entrou_em}`;
  const existentes = await rest().get<Array<{ id: string; ganho_em: string | null }>>(`tracker_ganhos?select=id,ganho_em&deal_id=eq.${enc(dealKey)}&limit=1`);
  const existente = existentes[0];
  if (existente?.id) return { id: existente.id, ganho_em: existente.ganho_em || input.entrou_em };
  const criadas = await rest().insert<Array<{ id: string; ganho_em: string }>>("tracker_ganhos", {
    deal_id: dealKey,
    contact_id: input.contact_id,
    telefone: input.telefone,
    telefone_normalizado: input.telefone_normalizado,
    origem: input.origem,
    campanha: input.campanha,
    tipo_vaga: input.tipo_vaga,
    ad_id: input.ad_id,
    passagem: input.passagem,
    ganho_em: input.entrou_em,
  });
  const criada = criadas[0];
  return { id: criada.id, ganho_em: criada.ganho_em };
}

export async function atualizarTipoVagaLead(telefoneNormalizado: string, tipo: "clt" | "estagio"): Promise<void> {
  await rest().update(`tracker_leads?telefone_normalizado=eq.${enc(telefoneNormalizado)}`, { tipo_vaga: tipo });
}

export async function listTrackerRedes(
  phones: string[],
): Promise<Array<{ telefone_normalizado: string; origem: string | null; referrer: string | null }>> {
  const unicos = [...new Set(phones.filter(Boolean))];
  const linhas: Array<{ telefone_normalizado: string; origem: string | null; referrer: string | null }> = [];
  for (let indice = 0; indice < unicos.length; indice += 100) {
    const lote = unicos.slice(indice, indice + 100).map((telefone) => `"${telefone}"`).join(",");
    linhas.push(...await rest().get<typeof linhas>(`tracker_leads?select=telefone_normalizado,origem,referrer&telefone_normalizado=in.(${enc(lote)})`));
  }
  return linhas;
}

export function listTrackerLeads(range?: { from?: string | null; to?: string | null }): Promise<TrackerLeadRow[]> {
  return todas<TrackerLeadRow>(
    `tracker_leads?select=id,telefone,telefone_normalizado,origem,campanha,headline,referrer,tipo_vaga,created_at&order=created_at.desc${filtroPeriodo("created_at", range)}`,
  );
}
