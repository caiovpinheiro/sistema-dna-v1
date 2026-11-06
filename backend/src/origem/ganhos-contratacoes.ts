import type { Pool } from "pg";
import { DATA_LEGADO } from "../lib/dashboard-periodo.js";
import { getContactTrackingByPhone } from "./crm-tracking.js";
import { normalizePhone } from "./phone.js";
import { supabaseRest } from "../lib/supabase-rest.js";

/** Uma contratação do período com a origem achada (tracker_leads, CRM ou "Só contrato"). */
export interface ContaContratacao {
  origem: string | null;
  campanha: string | null;
  headline: string | null;
  referrer: string | null;
  tipo: "clt" | "estagio" | null;
}

export const SO_CONTRATO = "Só contrato";
const CONTRATACAO = DATA_LEGADO("cv.data_contratacao");
const INTERVALO_CRM_MS = 260; // abaixo de 4 chamadas por segundo; cada busca no CRM faz até 2 chamadas

const espera = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LeadSalvo = { telefone_normalizado: string; origem: string | null; campanha: string | null; headline: string | null; referrer: string | null };

async function leadsPorTelefone(telefones: string[]): Promise<Map<string, LeadSalvo>> {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const mapa = new Map<string, LeadSalvo>();
  if (!url || !key || !telefones.length) return mapa;
  const rest = supabaseRest({ url, key });
  for (let indice = 0; indice < telefones.length; indice += 100) {
    const lote = telefones.slice(indice, indice + 100).map((telefone) => `"${telefone}"`).join(",");
    const linhas = await rest.get<LeadSalvo[]>(`tracker_leads?select=telefone_normalizado,origem,campanha,headline,referrer&telefone_normalizado=in.(${encodeURIComponent(lote)})`);
    for (const linha of linhas) mapa.set(linha.telefone_normalizado, linha);
  }
  return mapa;
}

/** Contato no CRM pelo telefone: primeiro 55DDNNNNNNNNN, depois +55…. Sem contato, null. */
async function rastreioNoCrm(telefone: string) {
  for (const formato of [telefone, `+${telefone}`]) {
    try {
      const contato = await getContactTrackingByPhone(formato);
      await espera(INTERVALO_CRM_MS * 2);
      if (contato) return contato;
    } catch {
      await espera(INTERVALO_CRM_MS * 2);
    }
  }
  return null;
}

/**
 * Ganhos pelas contratações realizadas no período (a mesma conta do card "Contratações realizadas" do Painel),
 * em vez da fase Ganho do CRM. A origem vem de tracker_leads pelo telefone do candidato; se não estiver lá, do contato
 * no CRM; se a pessoa não existir no CRM, "Só contrato".
 */
export async function contasDasContratacoes(db: Pool, range: { from: string; to: string }): Promise<ContaContratacao[]> {
  const { rows } = await db.query<{ celular: string | null; telefonefixo: string | null; tipo_vaga: number | null }>(
    `SELECT c.celular, c.telefonefixo, v.tipo_vaga
     FROM dna_work.conratacaovaga cv
     LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
     LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
     WHERE ${CONTRATACAO} >= $1::date AND ${CONTRATACAO} <= $2::date`,
    [range.from, range.to],
  );
  const contratacoes = rows.map((row) => ({
    telefone: normalizePhone(row.celular || "") || normalizePhone(row.telefonefixo || ""),
    tipo: row.tipo_vaga === 1 ? "estagio" as const : row.tipo_vaga === 2 ? "clt" as const : null,
  }));
  const salvos = await leadsPorTelefone([...new Set(contratacoes.map((item) => item.telefone).filter((telefone): telefone is string => Boolean(telefone)))]);
  const doCrm = new Map<string, ContaContratacao | null>();
  const contas: ContaContratacao[] = [];
  for (const item of contratacoes) {
    const salvo = item.telefone ? salvos.get(item.telefone) : undefined;
    if (salvo) {
      contas.push({ origem: salvo.origem, campanha: salvo.campanha, headline: salvo.headline, referrer: salvo.referrer, tipo: item.tipo });
      continue;
    }
    if (item.telefone && !doCrm.has(item.telefone)) {
      const contato = await rastreioNoCrm(item.telefone);
      doCrm.set(item.telefone, contato
        ? { origem: contato.origem, campanha: contato.campanha, headline: contato.headline, referrer: contato.referrer, tipo: null }
        : null);
    }
    const crm = item.telefone ? doCrm.get(item.telefone) : null;
    contas.push(crm
      ? { ...crm, tipo: item.tipo }
      : { origem: SO_CONTRATO, campanha: null, headline: null, referrer: null, tipo: item.tipo });
  }
  return contas;
}
