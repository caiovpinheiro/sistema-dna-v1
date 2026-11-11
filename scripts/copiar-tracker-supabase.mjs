// Copia tracker_leads e tracker_ganhos do Supabase para o Postgres (public), com os mesmos ids.
// Pode rodar várias vezes: nada é duplicado.
//
//   node scripts/copiar-tracker-supabase.mjs                      só insere o que falta
//   node scripts/copiar-tracker-supabase.mjs --corte=2026-11-11T15:00:00-03:00
//        também atualiza tracker_leads com os dados do Supabase, mas só nas linhas do Postgres
//        com updated_at anterior ao corte (o que o sistema já alterou no Postgres não é sobrescrito).
//
// Lê SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL do .env da raiz. Não imprime dados pessoais.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raiz = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${raiz}.env`)) process.loadEnvFile(`${raiz}.env`);

const corteArg = process.argv.find((arg) => arg.startsWith("--corte="))?.slice("--corte=".length);
const corte = corteArg ? new Date(corteArg) : null;
if (corteArg && Number.isNaN(corte.getTime())) throw new Error(`--corte inválido: ${corteArg}`);

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.");
if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL no .env.");

const LEADS = ["id", "telefone", "telefone_normalizado", "origem", "campanha", "headline", "ctwa_clid", "fbclid", "gclid", "referrer", "created_at", "tipo_vaga", "ad_id"];
const GANHOS = ["id", "deal_id", "contact_id", "telefone", "telefone_normalizado", "origem", "campanha", "ganho_em", "tipo_vaga", "passagem", "ad_id"];

async function todasDoSupabase(tabela, colunas) {
  const linhas = [];
  for (let offset = 0; ; offset += 1000) {
    const resposta = await fetch(`${url}/rest/v1/${tabela}?select=${colunas.join(",")}&order=id&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!resposta.ok) throw new Error(`Supabase ${tabela}: HTTP ${resposta.status}`);
    const pagina = await resposta.json();
    linhas.push(...pagina);
    if (pagina.length < 1000) return linhas;
  }
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function gravar(tabela, colunas, linhas, conflito, valoresExtras = []) {
  let afetadas = 0;
  for (let indice = 0; indice < linhas.length; indice += 500) {
    const lote = linhas.slice(indice, indice + 500);
    const valores = [...valoresExtras];
    const tuplas = lote.map((linha) => {
      const marcadores = colunas.map((coluna) => {
        valores.push(linha[coluna] ?? null);
        return `$${valores.length}`;
      });
      return `(${marcadores.join(", ")})`;
    });
    const resultado = await db.query(
      `INSERT INTO public.${tabela} AS t (${colunas.join(", ")}) VALUES ${tuplas.join(", ")} ${conflito}`,
      valores,
    );
    afetadas += resultado.rowCount ?? 0;
  }
  return afetadas;
}

async function idsDoPostgres(tabela) {
  const { rows } = await db.query(`SELECT id::text AS id FROM public.${tabela}`);
  return new Set(rows.map((row) => row.id));
}

const leads = await todasDoSupabase("tracker_leads", LEADS);
const ganhos = await todasDoSupabase("tracker_ganhos", GANHOS);

const conflitoLeads = corte
  ? `ON CONFLICT (id) DO UPDATE SET ${LEADS.filter((coluna) => coluna !== "id").map((coluna) => `${coluna} = EXCLUDED.${coluna}`).join(", ")}
     WHERE t.updated_at < $1::timestamptz`
  : "ON CONFLICT (id) DO NOTHING";
const gravadasLeads = await gravar("tracker_leads", LEADS, leads, conflitoLeads, corte ? [corte.toISOString()] : []);
const gravadasGanhos = await gravar("tracker_ganhos", GANHOS, ganhos, "ON CONFLICT (id) DO NOTHING");

const [noPgLeads, noPgGanhos] = await Promise.all([idsDoPostgres("tracker_leads"), idsDoPostgres("tracker_ganhos")]);
const soSupabaseLeads = leads.filter((linha) => !noPgLeads.has(linha.id)).length;
const soSupabaseGanhos = ganhos.filter((linha) => !noPgGanhos.has(linha.id)).length;

console.log(corte ? `Corte: ${corte.toISOString()}` : "Sem corte: só inserções.");
console.table([
  { tabela: "tracker_leads", supabase: leads.length, postgres: noPgLeads.size, gravadas_agora: gravadasLeads, so_no_supabase: soSupabaseLeads },
  { tabela: "tracker_ganhos", supabase: ganhos.length, postgres: noPgGanhos.size, gravadas_agora: gravadasGanhos, so_no_supabase: soSupabaseGanhos },
]);
await db.end();
if (soSupabaseLeads || soSupabaseGanhos) process.exitCode = 1;
