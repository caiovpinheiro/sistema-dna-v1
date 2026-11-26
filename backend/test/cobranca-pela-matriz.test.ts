import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { ligarBancoEmbutido } from "./apoio/banco-embutido.js";
import { cnpjParaDocumento, cobrarDaPropria, cobrarPela, listarPagadoras, pagadoraDe } from "../src/lib/cobranca-pela-matriz.js";

const port = 55441;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const embedded = new EmbeddedPostgres({
  databaseDir: fs.mkdtempSync(path.join(os.tmpdir(), "dnawork-cobranca-")),
  user: "postgres", password: "postgres", port, persistent: false,
});
let db: pg.Pool;

const GRUPO = "11111111-1111-1111-1111-111111111111";
const OUTRO_GRUPO = "22222222-2222-2222-2222-222222222222";
const PAGA = "aaaaaaaa-0000-0000-0000-000000000001";
const OUTRA = "aaaaaaaa-0000-0000-0000-000000000002";
const SEM_FATURA = "aaaaaaaa-0000-0000-0000-000000000003";
const UNIDADE = "aaaaaaaa-0000-0000-0000-000000000004";
const COM_CNPJ = "aaaaaaaa-0000-0000-0000-000000000005";

before(async () => {
  await ligarBancoEmbutido(embedded, { port, user: "postgres", password: "postgres" });
  db = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "postgres" });
  // Só as colunas que a cobrança usa (em produção vêm do cadastro antigo).
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS dna_work;
    CREATE TABLE dna_work.empresa (
      id_empresa varchar(40) PRIMARY KEY, razao_social text, nome_fantasia text, cnpj varchar(20), status integer,
      matriz varchar(40), usa_asaas integer, tipo_empresa integer, sede integer, datafechamento varchar(5)
    );
    CREATE TABLE dna_work.faturamento_empresa (
      id integer NOT NULL, id_empresa varchar(40), tipo integer, id_tabela integer, cobra_recorrente integer, valor text,
      modalidade_vaga integer, proporcional integer, folha integer, data_corte integer, ultiliza integer, data_conte_final integer,
      dias_cortesia integer, cobra_selecao integer, tipo_selecao text, valor_selecao text, valor_folha text, cobra_comissao integer,
      tipo_comissao text, valor_comissao text, treinamento integer, tipo_treinamento text, valor_treinamento text,
      comissao_recrutamento integer, tipo_comissao_recrutamento text, valor_comissao_recrutamento text
    );
    CREATE TABLE public.empresa (id uuid PRIMARY KEY, grupo_id uuid);
  `);
  await db.query(fs.readFileSync(path.join(root, "prisma/migrations/20261106190000_valor_empresas/migration.sql"), "utf8"));
  await db.query(`
    INSERT INTO dna_work.empresa VALUES
      ($1, 'Eduit Serviços Ltda', 'Eduit', '24.753.523/0001-77', 1, $1, 1, 1, 10, '20'),
      ($2, 'Outra Empresa Ltda', 'Outra', '11.222.333/0001-81', 1, $2, 1, 1, 10, '31'),
      ($3, 'Sem Fatura Ltda', 'Sem Fatura', '52.423.602/0001-55', 1, $3, NULL, 1, 10, '31'),
      ($4, 'Polo Morumbi', 'Polo Morumbi', NULL, 1, $4, NULL, 1, 10, NULL),
      ($5, 'Unidade Com CNPJ Ltda', 'Unidade', '52.440.764/0001-00', 1, $5, NULL, 1, 10, NULL)
  `, [PAGA, OUTRA, SEM_FATURA, UNIDADE, COM_CNPJ]);
  await db.query("INSERT INTO public.empresa VALUES ($1, $3), ($2, $4), ($5, $3)", [PAGA, OUTRA, GRUPO, OUTRO_GRUPO, UNIDADE]);
  await db.query(`
    INSERT INTO dna_work.faturamento_empresa (id, id_empresa, tipo, id_tabela, cobra_recorrente, valor, modalidade_vaga, data_corte) VALUES
      (10, $1, 0, 0, 1, '165,00', 1, 0), (11, $1, 0, 0, 0, '', 2, 5), (12, $2, 0, 0, 1, '99,00', 1, 0)
  `, [PAGA, OUTRA]);
  await db.query(`
    INSERT INTO public.valor_empresas (id_empresa, cnpj, nome, razao_social, tipo, clt_modelo, clt_valor, clt_status, est_modelo, est_mensal, est_status)
    VALUES ($1, '24753523000177', 'Eduit', 'Eduit Serviços Ltda', 'Matriz', 'Percentual', 50, 'ok', 'Mensal', 165, 'ok')
  `, [PAGA]);
});

after(async () => {
  await db?.end();
  await embedded.stop();
});

async function naTransacao<T>(acao: (client: pg.PoolClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const resultado = await acao(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("lista só quem pode pagar: com CNPJ e faturada por ela mesma, o grupo primeiro", async () => {
  const lista = await listarPagadoras(db, { grupo: GRUPO });
  assert.deepEqual(lista.map((item) => item.nome), ["Eduit", "Outra"]);
  assert.equal(lista[0].mesmo_grupo, true);
  assert.deepEqual((await listarPagadoras(db, { grupo: OUTRO_GRUPO })).map((item) => item.nome), ["Outra", "Eduit"]);
  assert.deepEqual((await listarPagadoras(db, { q: "24753523" })).map((item) => item.nome), ["Eduit"]);
  assert.deepEqual((await listarPagadoras(db, { excluir: PAGA })).map((item) => item.nome), ["Outra"]);
});

test("empresa sem CNPJ cobrada pela Eduit: vira unidade dela e copia as condições de cobrança", async () => {
  const pagadora = await naTransacao((client) => cobrarPela(client, UNIDADE, PAGA, "Polo Morumbi"));
  assert.equal(pagadora.id, PAGA);
  const { rows: [empresa] } = await db.query("SELECT matriz, usa_asaas, tipo_empresa, sede, datafechamento FROM dna_work.empresa WHERE id_empresa = $1", [UNIDADE]);
  assert.deepEqual(empresa, { matriz: PAGA, usa_asaas: 2, tipo_empresa: 2, sede: 10, datafechamento: "20" });
  const { rows: linhas } = await db.query("SELECT id, modalidade_vaga, valor FROM dna_work.faturamento_empresa WHERE id_empresa = $1 ORDER BY modalidade_vaga", [UNIDADE]);
  assert.deepEqual(linhas, [{ id: 13, modalidade_vaga: 1, valor: "165,00" }, { id: 14, modalidade_vaga: 2, valor: "" }]);
  const { rows: [valor] } = await db.query("SELECT cnpj, nome, tipo, est_mensal::text, est_status FROM public.valor_empresas WHERE id_empresa = $1", [UNIDADE]);
  assert.deepEqual(valor, { cnpj: "24753523000177", nome: "Polo Morumbi", tipo: "Filial", est_mensal: "165.00", est_status: "ok" });
  assert.equal((await pagadoraDe(db, UNIDADE))?.nome, "Eduit");
  assert.equal(await pagadoraDe(db, PAGA), null);

  // Documento (TCE, termos): sem CNPJ próprio, sai o de quem paga.
  const { rows: [doc] } = await db.query(`SELECT ${cnpjParaDocumento("e")} AS cnpj FROM dna_work.empresa e WHERE e.id_empresa = $1`, [UNIDADE]);
  assert.equal(doc.cnpj, "24.753.523/0001-77");
  const { rows: [propria] } = await db.query(`SELECT ${cnpjParaDocumento("empresa")} AS cnpj FROM dna_work.empresa WHERE id_empresa = $1`, [PAGA]);
  assert.equal(propria.cnpj, "24.753.523/0001-77");
});

test("trocar de quem paga não apaga as condições que a unidade já tem", async () => {
  await naTransacao((client) => cobrarPela(client, UNIDADE, OUTRA, "Polo Morumbi"));
  const { rows } = await db.query("SELECT modalidade_vaga, valor FROM dna_work.faturamento_empresa WHERE id_empresa = $1 ORDER BY modalidade_vaga", [UNIDADE]);
  assert.deepEqual(rows, [{ modalidade_vaga: 1, valor: "165,00" }, { modalidade_vaga: 2, valor: "" }]);
  assert.equal((await pagadoraDe(db, UNIDADE))?.nome, "Outra");
});

test("recusa pagadora sem fatura própria, sem CNPJ ou a própria empresa", async () => {
  await assert.rejects(naTransacao((client) => cobrarPela(client, COM_CNPJ, SEM_FATURA, "Unidade")), /não é faturada por ela mesma/);
  await assert.rejects(naTransacao((client) => cobrarPela(client, COM_CNPJ, UNIDADE, "Unidade")), /não tem CNPJ/);
  await assert.rejects(naTransacao((client) => cobrarPela(client, COM_CNPJ, COM_CNPJ, "Unidade")), /por ela mesma/);
  const { rows: [intacta] } = await db.query("SELECT matriz, usa_asaas FROM dna_work.empresa WHERE id_empresa = $1", [COM_CNPJ]);
  assert.deepEqual(intacta, { matriz: COM_CNPJ, usa_asaas: null });
});

test("voltar a cobrar a própria empresa só vale para quem tem CNPJ", async () => {
  await assert.rejects(naTransacao((client) => cobrarDaPropria(client, UNIDADE)), /precisa ser cobrada pelo CNPJ de outra/);
  await naTransacao((client) => cobrarPela(client, COM_CNPJ, PAGA, "Unidade"));
  await naTransacao((client) => cobrarDaPropria(client, COM_CNPJ));
  const { rows: [empresa] } = await db.query("SELECT matriz, usa_asaas, tipo_empresa FROM dna_work.empresa WHERE id_empresa = $1", [COM_CNPJ]);
  assert.deepEqual(empresa, { matriz: COM_CNPJ, usa_asaas: 1, tipo_empresa: 1 });
  assert.equal(await pagadoraDe(db, COM_CNPJ), null);
});
