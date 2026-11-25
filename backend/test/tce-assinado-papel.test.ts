import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import pg from "pg";
import type { AppConfig } from "../src/config.js";
import { TceService } from "../src/services/tce.service.js";
import { TermoService } from "../src/services/termo.service.js";

// Precisa de um PostgreSQL local vazio (ex.: TCE_PG_URL=postgres://postgres@127.0.0.1:55440/postgres); sem ele, é pulado.
const url = process.env.TCE_PG_URL;
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "tce-papel-"));
const config = { PDF_STORAGE_DIR: pasta } as unknown as AppConfig;
let db: pg.Pool;
let tce: TceService;
let termos: TermoService;

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const ids = { gerado: "11111111-1111-4111-8111-111111111111", enviado: "22222222-2222-4222-8222-222222222222", digital: "33333333-3333-4333-8333-333333333333" };

before(async () => {
  if (!url) return;
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Teste recusado fora do PostgreSQL local.");
  db = new pg.Pool({ connectionString: url, max: 2 });
  const migracao = fs.readdirSync(path.resolve("../prisma/migrations")).find((nome) => nome.endsWith("_tce_assinado_papel"));
  assert.ok(migracao, "falta a migration _tce_assinado_papel");
  await db.query(`
    DROP SCHEMA IF EXISTS dna_work CASCADE; DROP TABLE IF EXISTS public.tces;
    CREATE SCHEMA dna_work;
    CREATE TABLE dna_work.conratacaovaga (id_contratacao integer PRIMARY KEY, id_candidato varchar, id_empresa varchar);
    CREATE TABLE dna_work.candidato (id_candidato varchar PRIMARY KEY, nome varchar);
    CREATE TABLE dna_work.empresa (id_empresa varchar PRIMARY KEY, nome_fantasia varchar, razao_social varchar);
    ${fs.readFileSync(path.resolve("../prisma/migrations/20261022120000_termo_estagio/migration.sql"), "utf8")}
    ALTER TABLE dna_work.termo_estagio ALTER COLUMN id_contratacao DROP NOT NULL;
    ALTER TABLE dna_work.termo_estagio ADD COLUMN IF NOT EXISTS candidato_nome varchar, ADD COLUMN IF NOT EXISTS empresa_nome varchar, ADD COLUMN IF NOT EXISTS tce_id uuid;
    ${fs.readFileSync(path.resolve(`../prisma/migrations/${migracao}/migration.sql`), "utf8")}
    CREATE TABLE public.tces (id uuid PRIMARY KEY, pdf_path text, payload jsonb);
  `);
  const assinantes = JSON.stringify([{ nome: "Maria", email: "m@x.com", status: "new", url: "https://zapsign/1" }, { nome: "Loja", email: "l@x.com", status: "signed", url: "https://zapsign/2" }]);
  await db.query("INSERT INTO dna_work.termo_estagio (id, nome, status, signatarios, zapsign_token) VALUES ($1, 'TCE - Maria', 'gerado', '[]', NULL)", [ids.gerado]);
  await db.query("INSERT INTO dna_work.termo_estagio (id, nome, status, signatarios, zapsign_token) VALUES ($1, 'TCE - Ana', 'enviado', $2::jsonb, 'tok-enviado')", [ids.enviado, assinantes]);
  await db.query("INSERT INTO dna_work.termo_estagio (id, nome, status, signatarios, zapsign_token, arquivo_assinado) VALUES ($1, 'TCE - Bia', 'assinado', '[]', 'tok-digital', 'https://zapsign/assinado.pdf')", [ids.digital]);
  termos = new TermoService(db, config);
  tce = new TceService(db, config, termos);
});

after(async () => {
  if (!db) return;
  await db.query("DROP SCHEMA IF EXISTS dna_work CASCADE; DROP TABLE IF EXISTS public.tces;");
  await db.end();
});

const pular = { skip: !url && "sem TCE_PG_URL" };

test("anexar o termo assinado em papel marca como assinado e guarda o arquivo", pular, async () => {
  const termo = await tce.anexarAssinadoPapel(ids.gerado, { nome: "termo assinado.pdf", base64: PDF.toString("base64") }, "operador@dna");
  assert.equal(termo.status, "assinado");
  assert.equal(termo.arquivo_assinado, `/api/v1/tce/${ids.gerado}/assinado-papel`);
  assert.ok(termo.assinado_papel_em);
  const arquivo = await tce.lerAssinadoPapel(ids.gerado);
  assert.equal(arquivo.tipo, "application/pdf");
  assert.deepEqual(Buffer.from(arquivo.conteudo), PDF);
  assert.match(arquivo.nome, /\.pdf$/);
});

test("depois de enviado à ZapSign: aceita foto, marca todos como assinados e o webhook não desfaz", pular, async () => {
  const termo = await tce.anexarAssinadoPapel(ids.enviado, { nome: "foto.png", base64: PNG.toString("base64") }, "operador@dna");
  assert.equal(termo.status, "assinado");
  assert.ok(termo.signatarios.every((s) => s.status === "signed"));
  assert.equal((await tce.lerAssinadoPapel(ids.enviado)).tipo, "image/png");
  const r = await termos.receberWebhook({ token: "tok-enviado", event_type: "doc_refused", status: "refused", signers: [] });
  assert.equal(r.atualizado, false);
  assert.equal((await termos.get(ids.enviado)).status, "assinado");
});

test("trocar o arquivo do papel substitui o anterior", pular, async () => {
  await tce.anexarAssinadoPapel(ids.gerado, { nome: "nova.png", base64: PNG.toString("base64") }, "operador@dna");
  assert.equal((await tce.lerAssinadoPapel(ids.gerado)).tipo, "image/png");
  assert.equal(fs.readdirSync(pasta).filter((nome) => nome.startsWith(`${ids.gerado}-assinado-papel`)).length, 1);
});

test("recusa tipo errado, arquivo vazio e termo já assinado na ZapSign", pular, async () => {
  await assert.rejects(() => tce.anexarAssinadoPapel(ids.gerado, { nome: "x.docx", base64: DOCX.toString("base64") }, "op"), /PDF, JPG ou PNG/);
  await assert.rejects(() => tce.anexarAssinadoPapel(ids.gerado, { nome: "x.pdf", base64: "" }, "op"), /ARQUIVO_INVALIDO|base64|vazio/i);
  await assert.rejects(() => tce.anexarAssinadoPapel(ids.digital, { nome: "x.pdf", base64: PDF.toString("base64") }, "op"), /assinado pela ZapSign/);
  await assert.rejects(() => tce.lerAssinadoPapel(ids.digital), /não tem termo assinado em papel/);
});
