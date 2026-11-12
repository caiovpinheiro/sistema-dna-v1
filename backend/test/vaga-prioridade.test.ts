import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { VagaRepository } from "../src/repositories/vaga.repository.js";
import { vagaListSchema, vagaPrioridadeSchema } from "../src/schemas/vaga.js";
import { presentVaga } from "../src/services/presenters.js";

const port = 55437;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const embedded = new EmbeddedPostgres({
  databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "dnawork-prioridade-")),
  user: "postgres", password: "postgres", port, persistent: false,
});
let db: pg.Pool;
const repo = new VagaRepository(1, [2]);
const consulta = { page: 1, pageSize: 20 } as Parameters<VagaRepository["list"]>[1];

before(async () => {
  await embedded.initialise();
  await embedded.start();
  db = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  await db.query(fs.readFileSync(path.join(root, "database/schema/local-dev.sql"), "utf8"));
  // O que a lista de /vagas lê e o schema local não tem (em produção vem do espelho do Lightsail e do MIRROR_SQL).
  await db.query(`
    ALTER TABLE dna_work.vaga ADD COLUMN IF NOT EXISTS codigo text, ADD COLUMN IF NOT EXISTS texto_carga text,
      ADD COLUMN IF NOT EXISTS horabase text, ADD COLUMN IF NOT EXISTS hora_saida_base text, ADD COLUMN IF NOT EXISTS sexo text,
      ADD COLUMN IF NOT EXISTS idade text, ADD COLUMN IF NOT EXISTS idadeate text, ADD COLUMN IF NOT EXISTS beneficios_texto text,
      ADD COLUMN IF NOT EXISTS comparador text;
    CREATE TABLE IF NOT EXISTS dna_work.vaga_endereco (comparador text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text, cep text);
    CREATE TABLE IF NOT EXISTS dna_work.beneficio (id int, beneficios text);
    CREATE TABLE IF NOT EXISTS dna_work.beneficio_vaga (id_vaga text, id_beneficio int);
    CREATE TABLE IF NOT EXISTS public.grupo (id uuid PRIMARY KEY, nome text);
    CREATE TABLE IF NOT EXISTS public.empresa (id uuid PRIMARY KEY, grupo_id uuid, nome_fantasia text);
  `);
  await db.query(`
    INSERT INTO dna_work.vaga (id_vaga, cargo, status, dataabertura) VALUES
      ('v1', 'Cozinheiro', 0, '2026-11-10'), ('v2', 'Operador', 0, '2026-11-11'), ('v3', 'Estagiário', 0, '2026-11-12')
  `);
  await db.query(fs.readFileSync(path.join(root, "prisma/migrations/20261112200000_vaga_prioridade/migration.sql"), "utf8"));
});

after(async () => {
  await db?.end();
  await embedded.stop();
});

async function prioridades() {
  const { rows } = await repo.list(db, consulta);
  return Object.fromEntries(rows.map((row) => [row.id_vaga, presentVaga(row).prioridade]));
}

test("toda vaga começa com prioridade média", async () => {
  assert.deepEqual(await prioridades(), { v1: "media", v2: "media", v3: "media" });
});

test("grava alta e baixa, volta para média e a ficha lê a mesma prioridade", async () => {
  await repo.salvarPrioridade(db, "v1", "alta");
  await repo.salvarPrioridade(db, "v2", "baixa");
  assert.deepEqual(await prioridades(), { v1: "alta", v2: "baixa", v3: "media" });
  assert.equal(presentVaga((await repo.findById(db, "v1"))!).prioridade, "alta");

  await repo.salvarPrioridade(db, "v1", "media");
  assert.equal((await prioridades()).v1, "media");
  const linha = await db.query("SELECT prioridade FROM dna_work.vaga WHERE id_vaga = 'v2'");
  assert.equal(linha.rows[0].prioridade, "baixa");
});

test("só aceita alta, media ou baixa (na API e no banco)", async () => {
  assert.equal(vagaPrioridadeSchema.safeParse({ prioridade: "alta" }).success, true);
  assert.equal(vagaPrioridadeSchema.safeParse({ prioridade: "urgente" }).success, false);
  await assert.rejects(repo.salvarPrioridade(db, "v3", "nula"), /vaga_prioridade_valida/);
});

test("filtra a lista pela prioridade", async () => {
  await repo.salvarPrioridade(db, "v1", "alta");
  await repo.salvarPrioridade(db, "v2", "baixa");
  await repo.salvarPrioridade(db, "v3", "media");
  const filtrar = async (prioridade: "alta" | "media" | "baixa") => {
    const { rows, total } = await repo.list(db, { ...consulta, prioridade });
    return { ids: rows.map((row) => row.id_vaga), total };
  };
  assert.deepEqual(await filtrar("alta"), { ids: ["v1"], total: 1 });
  assert.deepEqual(await filtrar("baixa"), { ids: ["v2"], total: 1 });
  assert.deepEqual(await filtrar("media"), { ids: ["v3"], total: 1 });
  assert.equal(vagaListSchema.safeParse({ prioridade: "urgente" }).success, false);
});
