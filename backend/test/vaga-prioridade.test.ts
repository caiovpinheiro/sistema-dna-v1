import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { ligarBancoEmbutido } from "./apoio/banco-embutido.js";
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
  await ligarBancoEmbutido(embedded, { port, user: "postgres", password: "postgres" });
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

test("vagas do grupo: vagas e posições disponíveis por situação somando as empresas, e lista filtrada", async () => {
  await db.query(`
    INSERT INTO public.grupo (id, nome) VALUES ('11111111-1111-1111-1111-111111111111', 'Grupo A'), ('22222222-2222-2222-2222-222222222222', 'Grupo B');
    INSERT INTO public.empresa (id, grupo_id, nome_fantasia, razao_social) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Empresa A1', 'Empresa A1 Ltda'),
      ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empresa A2', 'Empresa A2 Ltda'),
      ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Empresa B1', 'Empresa B1 Ltda');
    INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, status, dataabertura) VALUES
      ('ga1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Caixa', 0, '2026-11-01'),
      ('ga2', 'aaaaaaaa-0000-0000-0000-000000000002', 'Repositor', 3, '2026-11-02'),
      ('gp1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fiscal', 8, '2026-11-03'),
      ('gc1', 'aaaaaaaa-0000-0000-0000-000000000002', 'Garçom', 1, '2026-11-04'),
      ('gf1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Açougueiro', 6, '2026-11-05'),
      ('gf2', 'aaaaaaaa-0000-0000-0000-000000000002', 'Padeiro', NULL, '2026-11-06'),
      ('gb1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Outro grupo', 0, '2026-11-07'),
      -- Mesma vaga que ga1 (mesma empresa, cargo e dados) aberta de novo: junta com ga1.
      ('ga3', 'aaaaaaaa-0000-0000-0000-000000000001', ' caixa ', 4, '2026-11-08');
    -- ga1 tem 2 posições e 1 contratação ativa (status 1): sobra 1. ga2 sem quantidade conta 1.
    -- gp1 tem 3 posições; a contratação dele está encerrada (status 2), então as 3 seguem livres.
    UPDATE dna_work.vaga SET quantidade_posicoes = 2 WHERE id_vaga = 'ga1';
    UPDATE dna_work.vaga SET quantidade_posicoes = 3 WHERE id_vaga = 'gp1';
    INSERT INTO dna_work.conratacaovaga (id_contratacao, id_vaga, status) VALUES (901, 'ga1', 1), (902, 'gp1', 2);
  `);
  const contagem = await repo.contarPorSituacao(db, "11111111-1111-1111-1111-111111111111");
  // Abertas: ga1 + ga3 viram uma vaga (Caixa, A1) e ga2 é outra: 2 vagas. Posições livres: ga1 1 + ga3 1 + ga2 1 = 3.
  assert.deepEqual(contagem.vagas, { aberta: 2, pausada: 1, contratada: 1, fechada: 2, total: 6 });
  assert.deepEqual(contagem.disponiveis, { aberta: 3, pausada: 3, contratada: 1, fechada: 2, total: 9 });
  const juntas = await repo.vagasJuntasDoGrupo(db, "11111111-1111-1111-1111-111111111111", { situacao: "aberta", page: 1, pageSize: 20 });
  assert.equal(juntas.total, 2);
  const caixa = juntas.rows.find((row) => row.empresa === "Empresa A1")!;
  assert.deepEqual({ linhas: caixa.linhas, posicoes: caixa.posicoes, ocupadas: caixa.ocupadas, disponiveis: caixa.disponiveis, id_vaga: caixa.id_vaga },
    { linhas: 2, posicoes: 3, ocupadas: 1, disponiveis: 2, id_vaga: "ga3" });
  // Situações diferentes não se juntam, e a página 2 vazia ainda informa o total.
  const todas = await repo.vagasJuntasDoGrupo(db, "11111111-1111-1111-1111-111111111111", { page: 2, pageSize: 5 });
  assert.equal(todas.total, 6);
  assert.equal(todas.rows.length, 1);
  const abertas = await repo.list(db, { ...consulta, grupo_id: "11111111-1111-1111-1111-111111111111", situacao: "aberta" });
  // A lista de Consultar Vagas não junta: uma linha por registro.
  assert.deepEqual(abertas.rows.map((row) => row.id_vaga).sort(), ["ga1", "ga2", "ga3"]);
  assert.equal(abertas.total, 3);
  const zero = { aberta: 0, pausada: 0, contratada: 0, fechada: 0, total: 0 };
  assert.deepEqual(await repo.contarPorSituacao(db, "33333333-3333-3333-3333-333333333333"), { vagas: zero, disponiveis: zero });
});

test("pesquisa inteligente: palavras em qualquer ordem, sem acento, e número contra os dígitos", async () => {
  const { condicaoPorPalavras, palavrasDaBusca } = await import("../src/lib/busca-texto.js");
  assert.deepEqual(palavrasDaBusca("  Paraná   ITACO "), ["parana", "itaco"]);
  assert.deepEqual(palavrasDaBusca("17.580.852/0001-06"), ["17580852000106"]);
  assert.deepEqual(palavrasDaBusca("50%_off"), [String.raw`50\%\_off`]); // % e _ escapados para o LIKE
  assert.deepEqual(palavrasDaBusca(""), []);
  const empresas = `(VALUES ('Paraná Supermercados - Jardim Itacolomi', '17.580.852/0001-06'), ('AMIGÃO SAÚDE', '38.483.839/0001-09'), ('Padaria 50%_off', NULL)) AS e(nome, cnpj)`;
  const achar = async (texto: string) => (await db.query(
    `SELECT nome FROM ${empresas} WHERE ${condicaoPorPalavras(["e.nome"], "$1", ["e.cnpj"])} ORDER BY nome`, [palavrasDaBusca(texto)],
  )).rows.map((row: { nome: string }) => row.nome);
  assert.deepEqual(await achar("itaco parana"), ["Paraná Supermercados - Jardim Itacolomi"]);
  assert.deepEqual(await achar("amigao saude"), ["AMIGÃO SAÚDE"]);
  assert.deepEqual(await achar("SUPERMERCADOS jardim"), ["Paraná Supermercados - Jardim Itacolomi"]);
  assert.deepEqual(await achar("17580852"), ["Paraná Supermercados - Jardim Itacolomi"]);
  assert.deepEqual(await achar("38.483.839/0001-09"), ["AMIGÃO SAÚDE"]);
  assert.deepEqual(await achar("parana saude"), []);
  assert.deepEqual(await achar("50%"), ["Padaria 50%_off"]);
  assert.deepEqual(await achar("50%_off"), ["Padaria 50%_off"]);
  // % e _ no meio da palavra são texto, não curinga: sem o escape, "5%0" acharia "50".
  assert.deepEqual(await achar("5%0"), []);
  assert.equal((await achar("")).length, 3);
});
