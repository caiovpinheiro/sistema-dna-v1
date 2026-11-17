import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import pg from "pg";
import { contratacoesPorOrigem } from "../src/services/dashboard.service.js";

// Precisa de um PostgreSQL local vazio (ex.: DASHBOARD_PG_URL=postgres://postgres@127.0.0.1:55440/postgres).
// Sem a variável, o teste é pulado: os testes do projeto com embedded-postgres não rodam como root.
const url = process.env.DASHBOARD_PG_URL;
let db: pg.Pool;
const SCHEMA = `dash_origem_${process.pid}`;

before(async () => {
  if (!url) return;
  const destino = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(destino.hostname)) throw new Error("Teste recusado fora do PostgreSQL local.");
  db = new pg.Pool({ connectionString: url, max: 2 });
  await db.query(`
    CREATE SCHEMA dna_work;
    CREATE TABLE dna_work.candidato (id_candidato varchar PRIMARY KEY, celular varchar, telefonefixo varchar, atendimento jsonb);
    CREATE TABLE dna_work.conratacaovaga (id_contratacao integer PRIMARY KEY, id_candidato varchar, id_vaga varchar, data_contratacao varchar);
    CREATE TABLE dna_work.processo_seletivo (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_candidato varchar, id_vaga varchar,
      origem varchar, id_contratacao integer, criado_em timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.tracker_leads (telefone_normalizado text, origem text);
    CREATE TABLE public.tracker_ganhos (telefone_normalizado text, origem text);

    INSERT INTO dna_work.candidato VALUES
      ('c1', '11911110001', NULL, NULL),                          -- processo ligado à contratação (empresa)
      ('c2', '11911110002', NULL, NULL),                          -- processo do candidato em outra vaga (dnawork)
      ('c3', '11911110003', NULL, '{"captado_por":"dnawork"}'),  -- atendimento marcado pela DNA
      ('c4', '(11) 91111-0004', NULL, NULL),                      -- veio de campanha (tracker_leads)
      ('c5', NULL, '011 3333-0005', NULL),                        -- ganho no CRM pelo telefone fixo (tracker_ganhos)
      ('c6', '11911110006', NULL, NULL),                          -- nada: não identificado
      ('c7', '11911110007', NULL, NULL);                          -- fora do período
    INSERT INTO dna_work.conratacaovaga VALUES
      (1, 'c1', 'v1', '2026/11/10'), (2, 'c2', 'v2', '2026/11/10'), (3, 'c3', 'v3', '2026/11/11'),
      (4, 'c4', 'v4', '2026/11/12'), (5, 'c5', 'v5', '2026/11/12'), (6, 'c6', 'v6', '2026/11/13'), (7, 'c7', 'v7', '2026/10/01');
    INSERT INTO dna_work.processo_seletivo (id_candidato, id_vaga, origem, id_contratacao, criado_em) VALUES
      ('c1', 'v1', 'empresa', 1, now()),
      ('c1', 'v9', 'dnawork', NULL, now() + interval '1 day'),
      ('c2', 'v8', 'dnawork', NULL, now());
    INSERT INTO public.tracker_leads VALUES ('5511911110004', 'Instagram');
    INSERT INTO public.tracker_ganhos VALUES ('551133330005', 'Infojobs');
  `.replace("CREATE SCHEMA dna_work;", `CREATE SCHEMA ${SCHEMA};`).replaceAll("dna_work.", `${SCHEMA}.`).replaceAll("public.", `${SCHEMA}.`));
});

after(async () => {
  if (!db) return;
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

test("contratação sem processo ligado busca a origem no candidato, no atendimento e nas campanhas", { skip: !url && "sem DASHBOARD_PG_URL" }, async () => {
  const r = await contratacoesPorOrigem(db, "2026-11-01", "2026-11-30", { dnaWork: SCHEMA, publico: SCHEMA });
  assert.deepEqual(r, {
    dnawork: 4,
    empresa: 1,
    nao_identificado: 1,
    por_criterio: { processo_da_contratacao: 1, processo_do_candidato: 1, atendimento: 1, campanha: 2 },
  });
});
