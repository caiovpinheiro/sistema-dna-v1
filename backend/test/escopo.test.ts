import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import type { FastifyInstance } from "fastify";

const port = 55433;
const password = "postgres";
const database = "dnawork_test";
process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${port}/${database}`;
process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
process.env.ADMIN_EMAIL = "admin@dnawork.local";
process.env.ADMIN_PASSWORD = "Teste-Seguro-123";
process.env.ADMIN_PASSWORD_HASH = "";
process.env.ALLOW_MULTIPLE_ACTIVE_LINKS = "false";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.COOKIE_SECURE = "false";
process.env.VAGA_STATUS_BLOQUEADAS = "2";
process.env.NODE_ENV = "test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnawork-pg-"));
const embedded = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password, port, persistent: false });

let app: FastifyInstance;
let db: pg.Pool;
let auth = "";

function cpf(seed: number): string {
  const base = String(seed).padStart(9, "0").slice(-9);
  const digit = (value: string) => {
    let sum = 0;
    for (let index = 0; index < value.length; index += 1) sum += Number(value[index]) * (value.length + 1 - index);
    const mod = (sum * 10) % 11;
    return String(mod === 10 ? 0 : mod);
  };
  const first = digit(base);
  return `${base}${first}${digit(base + first)}`;
}

function cnpj(seed: number): string {
  const base = String(seed).padStart(12, "0").slice(-12);
  const calc = (value: string) => {
    const weights = value.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < value.length; index += 1) sum += Number(value[index]) * weights[index];
    const mod = sum % 11;
    return String(mod < 2 ? 0 : 11 - mod);
  };
  const first = calc(base);
  return `${base}${first}${calc(base + first)}`;
}

async function call(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: method as "GET",
    url,
    payload,
    headers: { ...(auth ? { cookie: auth } : {}), ...headers },
  });
}

before(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname.includes("dnaworkia")) {
    throw new Error("Teste recusado fora do PostgreSQL local.");
  }
  await embedded.initialise();
  await embedded.start();
  const admin = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database });
  await client.connect();
  await client.query(fs.readFileSync(path.join(root, "database/schema/local-dev.sql"), "utf8"));
  await client.end();

  const { loadConfig } = await import("../src/config.js");
  const { createPool } = await import("../src/db/pool.js");
  const { loadCapabilities } = await import("../src/db/capabilities.js");
  const { buildApp } = await import("../src/app.js");
  const config = loadConfig();
  db = createPool(config);
  const capabilities = await loadCapabilities(db);
  assert.deepEqual(capabilities.missing, []);
  app = await buildApp({ config, db, capabilities });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "admin@dnawork.local", password: "Teste-Seguro-123" },
  });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.find((item) => item.name === "dnawork_session");
  assert.ok(cookie);
  auth = `${cookie.name}=${cookie.value}`;
});

after(async () => {
  await app?.close();
  await db?.end();
  await embedded.stop();
});

test("bloqueia acesso sem autenticação e senha inválida", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/v1/candidatos" });
  assert.equal(anon.statusCode, 401);
  const bad = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email: "admin@dnawork.local", password: "errada" },
  });
  assert.equal(bad.statusCode, 401);
  const me = await call("GET", "/api/v1/auth/me");
  assert.equal(me.statusCode, 200);
});

test("cadastra candidato e bloqueia CPF duplicado", async () => {
  const document = cpf(1);
  const created = await call("POST", "/api/v1/candidatos", {
    nome: "Ana Candidata",
    cpf: document,
    email: "ana@example.com",
    celular: "11987654321",
  });
  assert.equal(created.statusCode, 201);
  const body = created.json();
  assert.equal(body.success, true);
  assert.equal(body.data.cpf, document);
  const duplicate = await call("POST", "/api/v1/candidatos", {
    nome: "Ana Outra",
    cpf: document,
    email: "ana2@example.com",
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "CPF_DUPLICADO");
});

test("cadastra empresa e bloqueia CNPJ duplicado", async () => {
  const document = cnpj(1);
  const created = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa ABC Ltda",
    nome_fantasia: "ABC",
    cnpj: document,
    email: "abc@example.com",
    cidade: "São Paulo",
    uf: "SP",
  });
  assert.equal(created.statusCode, 201);
  const duplicate = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa ABC Filial",
    cnpj: document,
    email: "filial@example.com",
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "CNPJ_DUPLICADO");
});

test("cria vagas semelhantes com IDs diferentes e cinco posições", async () => {
  const company = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Vagas Ltda",
    cnpj: cnpj(2),
    email: "vagas@example.com",
  });
  const idEmpresa = company.json().data.id_empresa as string;
  const first = await call("POST", "/api/v1/vagas", {
    id_empresa: idEmpresa, cargo: "Auxiliar Administrativo", tipo_vaga: 2, salario: "1800,00", quantidade_posicoes: 5,
  });
  const second = await call("POST", "/api/v1/vagas", {
    id_empresa: idEmpresa, cargo: "Auxiliar Administrativo", tipo_vaga: 2, salario: "1800.00", quantidade_posicoes: 5,
  });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.notEqual(first.json().data.id_vaga, second.json().data.id_vaga);
  assert.equal(first.json().data.quantidade_posicoes, 5);
  assert.equal(first.json().data.disponiveis, 5);
  assert.equal(first.json().data.regime, "clt");
});

test("contrata até o limite, bloqueia a sexta, a duplicada, a sem vaga e a empresa divergente", async () => {
  const company = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Contratante Ltda", cnpj: cnpj(3), email: "contrata@example.com",
  });
  const other = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Errada Ltda", cnpj: cnpj(4), email: "errada@example.com",
  });
  const idEmpresa = company.json().data.id_empresa as string;
  const idErrada = other.json().data.id_empresa as string;
  const vaga = await call("POST", "/api/v1/vagas", {
    id_empresa: idEmpresa, cargo: "Auxiliar Administrativo", tipo_vaga: 2, quantidade_posicoes: 5, salario: "2000",
  });
  const idVaga = vaga.json().data.id_vaga as string;
  const ids: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const person = await call("POST", "/api/v1/candidatos", {
      nome: `Candidato ${index}`, cpf: cpf(100 + index), email: `c${index}@example.com`,
    });
    ids.push(person.json().data.id_candidato);
  }
  for (let index = 0; index < 5; index += 1) {
    const hired = await call("POST", "/api/v1/contratacoes", {
      id_candidato: ids[index], id_vaga: idVaga, data_inicio: "2026-11-01",
    }, { "idempotency-key": `lote-${index}-${Date.now()}` });
    assert.equal(hired.statusCode, 201, hired.body);
    assert.equal(hired.json().data.id_empresa, idEmpresa);
    assert.ok(hired.json().data.id_contratacao);
  }
  const full = await call("GET", `/api/v1/vagas/${idVaga}`);
  assert.equal(full.json().data.ocupadas, 5);
  assert.equal(full.json().data.disponiveis, 0);
  assert.equal(full.json().data.situacao, "contratada");
  const sixth = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[5], id_vaga: idVaga, data_inicio: "2026-11-01",
  }, { "idempotency-key": `sexta-${Date.now()}` });
  assert.equal(sixth.statusCode, 409);
  assert.equal(sixth.json().error.code, "VAGA_ENCERRADA");

  // Ao preencher a última posição a vaga passa a "contratada" e a checagem de status vem primeiro.
  // Reaberta à mão, a capacidade e o vínculo duplicado continuam barrando.
  await db.query("UPDATE dna_work.vaga SET status = 0 WHERE id_vaga = $1", [idVaga]);
  const semPosicao = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[5], id_vaga: idVaga, data_inicio: "2026-11-01",
  }, { "idempotency-key": `sexta-reaberta-${Date.now()}` });
  assert.equal(semPosicao.statusCode, 409);
  assert.equal(semPosicao.json().error.code, "VAGA_SEM_POSICAO");

  const again = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[0], id_vaga: idVaga, data_inicio: "2026-11-02",
  }, { "idempotency-key": `dup-${Date.now()}` });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, "VINCULO_DUPLICADO");

  const missing = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[5], data_inicio: "2026-11-01",
  }, { "idempotency-key": `sem-vaga-${Date.now()}` });
  assert.equal(missing.statusCode, 422);

  const wrong = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[5], id_vaga: idVaga, id_empresa: idErrada, data_inicio: "2026-11-01",
  }, { "idempotency-key": `empresa-errada-${Date.now()}` });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.json().error.code, "EMPRESA_DIVERGENTE");
});

test("duas contratações concorrentes não ultrapassam a última posição", async () => {
  const company = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Corrida Ltda", cnpj: cnpj(5), email: "corrida@example.com",
  });
  const vaga = await call("POST", "/api/v1/vagas", {
    id_empresa: company.json().data.id_empresa, cargo: "Última vaga", tipo_vaga: 1, quantidade_posicoes: 1, salario: "800,00",
  });
  const people = await Promise.all([0, 1].map(async (index) => {
    const person = await call("POST", "/api/v1/candidatos", {
      nome: `Corrida ${index}`, cpf: cpf(200 + index), email: `corrida${index}@example.com`, curso: "Administração",
    });
    return person.json().data.id_candidato as string;
  }));
  const results = await Promise.all(people.map((id, index) => call("POST", "/api/v1/contratacoes", {
    id_candidato: id, id_vaga: vaga.json().data.id_vaga, data_inicio: "2026-11-01",
  }, { "idempotency-key": `corrida-${index}-${Date.now()}` })));
  const statuses = results.map((item) => item.statusCode).sort();
  assert.deepEqual(statuses, [201, 409]);
  const detail = await call("GET", `/api/v1/vagas/${vaga.json().data.id_vaga}`);
  assert.equal(detail.json().data.ocupadas, 1);
  assert.equal(detail.json().data.regime, "estagio");
});

test("encerra contratação e preserva o histórico", async () => {
  const company = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Histórico Ltda", cnpj: cnpj(6), email: "hist@example.com",
  });
  const person = await call("POST", "/api/v1/candidatos", {
    nome: "Histórico Candidato", cpf: cpf(300), email: "hist@example.com",
  });
  const vaga = await call("POST", "/api/v1/vagas", {
    id_empresa: company.json().data.id_empresa, cargo: "Estágio", tipo_vaga: 1, quantidade_posicoes: 1,
  });
  const hired = await call("POST", "/api/v1/contratacoes", {
    id_candidato: person.json().data.id_candidato, id_vaga: vaga.json().data.id_vaga, data_inicio: "2026-11-01",
  }, { "idempotency-key": `hist-${Date.now()}` });
  const id = hired.json().data.id_contratacao as number;
  const ended = await call("POST", `/api/v1/contratacoes/${id}/encerrar`, { data_encerramento: "2026-12-15" });
  assert.equal(ended.statusCode, 200);
  assert.equal(ended.json().data.situacao, "encerrada");
  assert.equal(ended.json().data.data_encerramento, "2026-12-15");
  const still = await call("GET", `/api/v1/contratacoes/${id}`);
  assert.equal(still.statusCode, 200);
  assert.equal(still.json().data.candidato_nome, "Histórico Candidato");
  const candidate = await call("GET", `/api/v1/candidatos/${person.json().data.id_candidato}`);
  assert.equal(candidate.statusCode, 200);
});

test("pesquisa candidatos e empresas com filtro e paginação", async () => {
  const candidates = await call("GET", "/api/v1/candidatos?nome=Ana&page=1&pageSize=10");
  assert.equal(candidates.statusCode, 200);
  assert.equal(candidates.json().meta.pageSize, 10);
  assert.ok(candidates.json().meta.total >= 1);
  assert.ok(candidates.json().data.some((item: { nome: string }) => item.nome === "Ana Candidata"));
  const companies = await call("GET", "/api/v1/empresas?q=ABC&page=1&pageSize=5");
  assert.equal(companies.statusCode, 200);
  assert.equal(companies.json().meta.pageSize, 5);
  assert.ok(companies.json().meta.total >= 1);
  const contracts = await call("GET", "/api/v1/contratacoes?regime=clt&page=1&pageSize=20");
  assert.equal(contracts.statusCode, 200);
  assert.ok(contracts.json().meta.total >= 5);
  assert.equal(companies.json().data[0].acesso_portal, false);
});

test("gera acesso ao portal e mostra e-mail e senha na empresa", async () => {
  await db.query(`
    create table if not exists dna_work.usuario_empresa (
      id_u varchar(40) primary key,
      nome_u varchar(255),
      email_u varchar(255),
      senha_u varchar(40),
      senha_hash text,
      telefone_u varchar(20),
      empresa_u varchar(40),
      status integer,
      tipo integer,
      data_senha varchar(20),
      atualiza_senha integer
    )
  `);
  await db.query(`create table if not exists dna_work.vinculo_empresa_usuario (id_usuario varchar(40), id_empresa varchar(40))`);
  await db.query(`create table if not exists dna_work.paginas_usuario_empresa (id_usuario varchar(42), menu text, sub1 text, sub2 text, paginas text)`);
  const created = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Portal Ltda",
    nome_fantasia: "Portal",
    cnpj: cnpj(880),
    email: "portal@example.com",
    responsavel: "Marina Portal",
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().data.id_empresa as string;
  const sem = await call("GET", `/api/v1/empresas/${id}`);
  assert.equal(sem.json().data.acesso_portal, false);
  const invalido = await call("POST", `/api/v1/empresas/${id}/acesso-portal`, { email: "sem-arroba" });
  assert.equal(invalido.statusCode, 422);
  const gerado = await call("POST", `/api/v1/empresas/${id}/acesso-portal`, {});
  assert.equal(gerado.statusCode, 200);
  assert.equal(gerado.json().data.email, "portal@example.com");
  assert.equal(gerado.json().data.criado, true);
  assert.equal(String(gerado.json().data.senha).length, 12);
  const ficha = await call("GET", `/api/v1/empresas/${id}`);
  assert.equal(ficha.json().data.portal.email, "portal@example.com");
  assert.equal(ficha.json().data.portal.senha, gerado.json().data.senha);
  const lista = await call("GET", "/api/v1/empresas?q=Empresa%20Portal&page=1&pageSize=5");
  assert.equal(lista.json().data.find((item: { id_empresa: string }) => item.id_empresa === id).acesso_portal, true);
  const nunca = await call("GET", "/api/v1/empresas?q=Empresa%20Portal&acesso=nunca&page=1&pageSize=5");
  assert.equal(nunca.json().data.some((item: { id_empresa: string }) => item.id_empresa === id), true);
  await db.query(`
    insert into dna_work.portal_empresa_acesso (id_empresa, id_usuario, email, primeiro_login, ultimo_login, ultimo_uso, logins)
    values ($1, 'usuario-portal', 'portal@example.com', now(), now(), now(), 2)
  `, [id]);
  const acessou = await call("GET", "/api/v1/empresas?q=Empresa%20Portal&acesso=acessou&page=1&pageSize=5");
  const encontrada = acessou.json().data.find((item: { id_empresa: string }) => item.id_empresa === id);
  assert.equal(encontrada.uso_portal.logins, 2);
  const semUso = await call("GET", "/api/v1/empresas?q=Empresa%20Portal&acesso=nunca&page=1&pageSize=5");
  assert.equal(semUso.json().data.some((item: { id_empresa: string }) => item.id_empresa === id), false);
  const fichaUso = await call("GET", `/api/v1/empresas/${id}`);
  assert.equal(fichaUso.json().data.uso_portal.logins, 2);
  const repetido = await call("POST", `/api/v1/empresas/${id}/acesso-portal`, {});
  assert.equal(repetido.statusCode, 409);
  const nova = await call("POST", `/api/v1/empresas/${id}/acesso-portal`, { redefinir: true });
  assert.equal(nova.statusCode, 200);
  assert.notEqual(nova.json().data.senha, gerado.json().data.senha);
  const atualizada = await call("GET", `/api/v1/empresas/${id}`);
  assert.equal(atualizada.json().data.portal.senha, nova.json().data.senha);
});
