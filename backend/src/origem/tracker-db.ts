import type { Pool } from "pg";

/**
 * Tabelas public.tracker_leads e public.tracker_ganhos, no Postgres da DNA Work.
 * O Pool é o mesmo do sistema: o app chama usarBancoTracker(db) ao subir.
 */
let banco: Pool | null = null;

export function usarBancoTracker(db: Pool) {
  banco = db;
}

function db(): Pool {
  if (!banco) throw new Error("Banco do tracker não configurado.");
  return banco;
}

/** Brasília: o período é de 00:00 do dia inicial a 23:59:59.999 do final, em -03:00. */
function filtroPeriodo(coluna: string, range: { from?: string | null; to?: string | null } | undefined, valores: unknown[]) {
  const partes: string[] = [];
  if (range?.from) {
    valores.push(`${range.from}T00:00:00.000-03:00`);
    partes.push(`${coluna} >= $${valores.length}::timestamptz`);
  }
  if (range?.to) {
    valores.push(`${range.to}T23:59:59.999-03:00`);
    partes.push(`${coluna} <= $${valores.length}::timestamptz`);
  }
  return partes.length ? ` AND ${partes.join(" AND ")}` : "";
}

/** Datas no mesmo formato texto (ISO) que a API do banco antigo devolvia. */
function iso(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString();
  return valor == null ? "" : String(valor);
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
  const { rows } = await db().query<TrackerLeadRecord>(
    `SELECT id::text AS id, telefone, telefone_normalizado, origem, campanha, headline, ctwa_clid, fbclid, gclid, referrer
     FROM public.tracker_leads WHERE telefone_normalizado = $1 LIMIT 1`,
    [telefoneNormalizado],
  );
  return rows[0] ?? null;
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
  const valores = [
    input.telefone, input.telefone_normalizado, input.origem, input.campanha, input.headline,
    input.ctwa_clid, input.fbclid, input.gclid, input.referrer,
  ];
  const { rows } = await db().query<{ id: string }>(
    "SELECT id::text AS id FROM public.tracker_leads WHERE telefone_normalizado = $1 LIMIT 1",
    [input.telefone_normalizado],
  );
  const id = rows[0]?.id;
  if (id) {
    // Sem ad_id novo, mantém o que já estava gravado.
    await db().query(
      `UPDATE public.tracker_leads SET telefone = $2, telefone_normalizado = $3, origem = $4, campanha = $5, headline = $6,
         ctwa_clid = $7, fbclid = $8, gclid = $9, referrer = $10, ad_id = COALESCE($11, ad_id), updated_at = now()
       WHERE id = $1::uuid`,
      [id, ...valores, input.ad_id || null],
    );
    return;
  }
  await db().query(
    `INSERT INTO public.tracker_leads (telefone, telefone_normalizado, origem, campanha, headline, ctwa_clid, fbclid, gclid, referrer, ad_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [...valores, input.ad_id || null],
  );
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
  await db().query(
    "UPDATE public.tracker_leads SET campanha = $2, updated_at = now() WHERE telefone_normalizado = $1",
    [telefoneNormalizado, campanha],
  );
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
  const valores: unknown[] = [passagem];
  const filtro = filtroPeriodo("ganho_em", range, valores);
  const { rows } = await db().query<{
    id: string; telefone_normalizado: string | null; origem: string | null; campanha: string | null; tipo_vaga: string | null; ganho_em: Date | string | null;
  }>(
    `SELECT id::text AS id, telefone_normalizado, origem, campanha, tipo_vaga, ganho_em
     FROM public.tracker_ganhos WHERE passagem = $1${filtro}
     ORDER BY ganho_em DESC NULLS LAST`,
    valores,
  );
  return rows.map((row) => ({
    id: row.id,
    telefone_normalizado: row.telefone_normalizado,
    origem: row.origem,
    campanha: row.campanha,
    tipo_vaga: row.tipo_vaga,
    entrou_em: iso(row.ganho_em),
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
  const existentes = await db().query<{ id: string; ganho_em: Date | string | null }>(
    "SELECT id::text AS id, ganho_em FROM public.tracker_ganhos WHERE deal_id = $1 LIMIT 1",
    [dealKey],
  );
  const existente = existentes.rows[0];
  if (existente?.id) return { id: existente.id, ganho_em: iso(existente.ganho_em) || input.entrou_em };
  const criadas = await db().query<{ id: string; ganho_em: Date | string | null }>(
    `INSERT INTO public.tracker_ganhos (deal_id, contact_id, telefone, telefone_normalizado, origem, campanha, tipo_vaga, ad_id, passagem, ganho_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
     RETURNING id::text AS id, ganho_em`,
    [dealKey, input.contact_id, input.telefone, input.telefone_normalizado, input.origem, input.campanha, input.tipo_vaga, input.ad_id, input.passagem, input.entrou_em],
  );
  const criada = criadas.rows[0];
  return { id: criada.id, ganho_em: iso(criada.ganho_em) };
}

export async function atualizarTipoVagaLead(telefoneNormalizado: string, tipo: "clt" | "estagio"): Promise<void> {
  await db().query(
    "UPDATE public.tracker_leads SET tipo_vaga = $2, updated_at = now() WHERE telefone_normalizado = $1",
    [telefoneNormalizado, tipo],
  );
}

export async function listTrackerRedes(
  phones: string[],
): Promise<Array<{ telefone_normalizado: string; origem: string | null; referrer: string | null }>> {
  const unicos = [...new Set(phones.filter(Boolean))];
  if (!unicos.length) return [];
  const { rows } = await db().query<{ telefone_normalizado: string; origem: string | null; referrer: string | null }>(
    "SELECT telefone_normalizado, origem, referrer FROM public.tracker_leads WHERE telefone_normalizado = ANY($1::text[])",
    [unicos],
  );
  return rows;
}

/** Leads salvos pelos telefones, para as contratações (ganhos-contratacoes). */
export async function listTrackerLeadsPorTelefone(
  telefones: string[],
): Promise<Array<{ telefone_normalizado: string; origem: string | null; campanha: string | null; headline: string | null; referrer: string | null }>> {
  const unicos = [...new Set(telefones.filter(Boolean))];
  if (!unicos.length) return [];
  const { rows } = await db().query<{ telefone_normalizado: string; origem: string | null; campanha: string | null; headline: string | null; referrer: string | null }>(
    "SELECT telefone_normalizado, origem, campanha, headline, referrer FROM public.tracker_leads WHERE telefone_normalizado = ANY($1::text[])",
    [unicos],
  );
  return rows;
}

export async function listTrackerLeads(range?: { from?: string | null; to?: string | null }): Promise<TrackerLeadRow[]> {
  const valores: unknown[] = [];
  const filtro = filtroPeriodo("created_at", range, valores);
  const { rows } = await db().query<Omit<TrackerLeadRow, "created_at"> & { created_at: Date | string }>(
    `SELECT id::text AS id, telefone, telefone_normalizado, origem, campanha, headline, referrer, tipo_vaga, created_at
     FROM public.tracker_leads WHERE true${filtro}
     ORDER BY created_at DESC`,
    valores,
  );
  return rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
}
