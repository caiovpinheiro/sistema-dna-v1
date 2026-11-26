import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { ligarBancoEmbutido } from "./apoio/banco-embutido.js";
import { INICIAR_UTF8, completarEsquemaLegado } from "./esquema-legado.js";
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
const embedded = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password, port, persistent: false, initdbFlags: INICIAR_UTF8 });

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
  await ligarBancoEmbutido(embedded, { port, user: "postgres", password });
  const admin = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  await admin.end();
  const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password, database });
  await client.connect();
  await client.query(fs.readFileSync(path.join(root, "database/schema/local-dev.sql"), "utf8"));
  // Por cima do esquema base, as mesmas migrations da produção: assim a base de teste acompanha as tabelas novas.
  const migrations = path.join(root, "prisma/migrations");
  for (const nome of fs.readdirSync(migrations).filter((item) => /^\d/.test(item)).sort()) {
    await client.query(fs.readFileSync(path.join(migrations, nome, "migration.sql"), "utf8"));
  }
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
    if (index === 0) {
      // Com a vaga ainda aberta: o mesmo candidato não entra duas vezes.
      const again = await call("POST", "/api/v1/contratacoes", {
        id_candidato: ids[0], id_vaga: idVaga, data_inicio: "2026-11-02",
      }, { "idempotency-key": `dup-${Date.now()}` });
      assert.equal(again.statusCode, 409);
      assert.equal(again.json().error.code, "VINCULO_DUPLICADO");
    }
  }
  const full = await call("GET", `/api/v1/vagas/${idVaga}`);
  assert.equal(full.json().data.ocupadas, 5);
  assert.equal(full.json().data.disponiveis, 0);
  // Regra vigente: ao ocupar a última posição, ContratacaoService grava VAGA_STATUS_OCUPADA (1) e statusDaVaga(1) = "contratada" (docs/mcp/diagnostico-ci.md).
  assert.equal(full.json().data.situacao, "contratada");
  const sixth = await call("POST", "/api/v1/contratacoes", {
    id_candidato: ids[5], id_vaga: idVaga, data_inicio: "2026-11-01",
  }, { "idempotency-key": `sexta-${Date.now()}` });
  assert.equal(sixth.statusCode, 409);
  // Cheia, a vaga é "contratada" e lotada: o sistema responde que não há posição (VAGA_SEM_POSICAO), não que está encerrada.
  assert.equal(sixth.json().error.code, "VAGA_SEM_POSICAO");

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

test("recusa por status e ocupação: pausada/fechada/contratada com vaga → VAGA_ENCERRADA; lotada → VAGA_SEM_POSICAO; nunca reabre", async () => {
  const company = await call("POST", "/api/v1/empresas", { razao_social: "Empresa Status Ltda", cnpj: cnpj(9), email: "status@example.com" });
  const idEmpresa = company.json().data.id_empresa as string;
  const vaga = await call("POST", "/api/v1/vagas", { id_empresa: idEmpresa, cargo: "Atendente Status", tipo_vaga: 2, quantidade_posicoes: 2, salario: "2000" });
  const idVaga = vaga.json().data.id_vaga as string;
  const pessoas: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const p = await call("POST", "/api/v1/candidatos", { nome: `Status ${index}`, cpf: cpf(900 + index), email: `status${index}@example.com` });
    pessoas.push(p.json().data.id_candidato);
  }
  const contratar = (i: number) => call("POST", "/api/v1/contratacoes", { id_candidato: pessoas[i], id_vaga: idVaga, data_inicio: "2026-11-01" }, { "idempotency-key": `status-${i}-${Date.now()}-${Math.random()}` });
  const situacao = async () => (await call("GET", `/api/v1/vagas/${idVaga}`)).json().data.situacao;
  assert.equal((await contratar(0)).statusCode, 201);
  for (const s of ["pausada", "fechada", "contratada"]) {
    assert.equal((await call("PATCH", `/api/v1/vagas/${idVaga}`, { situacao: s })).statusCode, 200, s);
    const r = await contratar(1);
    assert.equal(r.statusCode, 409, s);
    assert.equal(r.json().error.code, "VAGA_ENCERRADA", `${s} com posição livre`);
    assert.equal(await situacao(), s, "o status não muda ao recusar");
  }
  assert.equal((await call("PATCH", `/api/v1/vagas/${idVaga}`, { situacao: "aberta" })).statusCode, 200);
  assert.equal((await contratar(1)).statusCode, 201);
  assert.equal(await situacao(), "contratada", "ao lotar, vira contratada");
  const lotada = await contratar(2);
  assert.equal(lotada.statusCode, 409);
  assert.equal(lotada.json().error.code, "VAGA_SEM_POSICAO");
  assert.equal(lotada.json().error.message, "Todas as posições desta vaga já estão ocupadas.");
  assert.equal(await situacao(), "contratada", "não reabre sozinha");
  assert.equal((await call("GET", `/api/v1/vagas/${idVaga}`)).json().data.ocupadas, 2);
  // Pausar uma vaga lotada continua sendo "encerrada" (não é a lotação que impede, é o status).
  assert.equal((await call("PATCH", `/api/v1/vagas/${idVaga}`, { situacao: "pausada" })).statusCode, 200);
  assert.equal((await contratar(2)).json().error.code, "VAGA_ENCERRADA");
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
  // Quem perde a corrida recebe "sem posição" (a vencedora lotou a vaga, que virou contratada).
  assert.equal(results.find((item) => item.statusCode === 409)!.json().error.code, "VAGA_SEM_POSICAO");
  const detail = await call("GET", `/api/v1/vagas/${vaga.json().data.id_vaga}`);
  assert.equal(detail.json().data.ocupadas, 1);
  assert.equal(detail.json().data.regime, "estagio");
});

test("troca a vaga de uma contratação ativa: a posição sai da antiga e entra na nova", async () => {
  const unidadeA = await call("POST", "/api/v1/empresas", { razao_social: "Polo Unidade A Ltda", cnpj: cnpj(20), email: "a@example.com" });
  const unidadeB = await call("POST", "/api/v1/empresas", { razao_social: "Polo Unidade B Ltda", cnpj: cnpj(21), email: "b@example.com" });
  const idA = unidadeA.json().data.id_empresa as string;
  const idB = unidadeB.json().data.id_empresa as string;
  const errada = await call("POST", "/api/v1/vagas", { id_empresa: idA, cargo: "Suporte Comercial", tipo_vaga: 2, quantidade_posicoes: 1, salario: "2000" });
  const certa = await call("POST", "/api/v1/vagas", { id_empresa: idB, cargo: "Suporte Comercial", tipo_vaga: 2, quantidade_posicoes: 2, salario: "2100" });
  const estagio = await call("POST", "/api/v1/vagas", { id_empresa: idB, cargo: "Estágio Comercial", tipo_vaga: 1, quantidade_posicoes: 1 });
  const idErrada = errada.json().data.id_vaga as string;
  const idCerta = certa.json().data.id_vaga as string;
  const person = await call("POST", "/api/v1/candidatos", { nome: "Troca Candidata", cpf: cpf(400), email: "troca@example.com" });
  const hired = await call("POST", "/api/v1/contratacoes", {
    id_candidato: person.json().data.id_candidato, id_vaga: idErrada, data_inicio: "2026-11-30",
  }, { "idempotency-key": `troca-${Date.now()}` });
  assert.equal(hired.statusCode, 201, hired.body);
  const id = hired.json().data.id_contratacao as number;
  // Regra vigente: ao ocupar a última posição, ContratacaoService grava VAGA_STATUS_OCUPADA (1) e statusDaVaga(1) = "contratada" (docs/mcp/diagnostico-ci.md).
  assert.equal((await call("GET", `/api/v1/vagas/${idErrada}`)).json().data.situacao, "contratada");

  const regime = await call("POST", `/api/v1/contratacoes/${id}/trocar-vaga`, { id_vaga: estagio.json().data.id_vaga });
  assert.equal(regime.statusCode, 409);
  assert.equal(regime.json().error.code, "REGIME_DIVERGENTE");
  const mesma = await call("POST", `/api/v1/contratacoes/${id}/trocar-vaga`, { id_vaga: idErrada });
  assert.equal(mesma.json().error.code, "MESMA_VAGA");

  const trocada = await call("POST", `/api/v1/contratacoes/${id}/trocar-vaga`, { id_vaga: idCerta });
  assert.equal(trocada.statusCode, 200, trocada.body);
  assert.equal(trocada.json().data.id_vaga, idCerta);
  assert.equal(trocada.json().data.id_empresa, idB);
  const antiga = (await call("GET", `/api/v1/vagas/${idErrada}`)).json().data;
  assert.equal(antiga.ocupadas, 0);
  assert.equal(antiga.situacao, "aberta");
  const nova = (await call("GET", `/api/v1/vagas/${idCerta}`)).json().data;
  assert.equal(nova.ocupadas, 1);
  assert.equal(nova.disponiveis, 1);
  const colaborador = await db.query("SELECT id_empresa, cargo FROM dna_work.colaborador WHERE id_contratacao = $1", [id]);
  assert.equal(colaborador.rows[0].id_empresa, idB);

  // Trocar para uma vaga "contratada" e lotada: VAGA_SEM_POSICAO (409), sem mexer em nenhuma das duas vagas.
  const lotada = await call("POST", "/api/v1/vagas", { id_empresa: idA, cargo: "Suporte Comercial", tipo_vaga: 2, quantidade_posicoes: 1, salario: "2000" });
  const idLotada = lotada.json().data.id_vaga as string;
  const outra = await call("POST", "/api/v1/candidatos", { nome: "Ocupa Vaga", cpf: cpf(950), email: "ocupa@example.com" });
  assert.equal((await call("POST", "/api/v1/contratacoes", { id_candidato: outra.json().data.id_candidato, id_vaga: idLotada, data_inicio: "2026-11-30" }, { "idempotency-key": `ocupa-${Date.now()}` })).statusCode, 201);
  const paraLotada = await call("POST", `/api/v1/contratacoes/${id}/trocar-vaga`, { id_vaga: idLotada });
  assert.equal(paraLotada.statusCode, 409);
  assert.equal(paraLotada.json().error.code, "VAGA_SEM_POSICAO");
  assert.equal((await call("GET", `/api/v1/vagas/${idLotada}`)).json().data.situacao, "contratada");
  assert.equal((await call("GET", `/api/v1/vagas/${idCerta}`)).json().data.ocupadas, 1);
  // Trocar para uma vaga pausada continua VAGA_ENCERRADA.
  assert.equal((await call("PATCH", `/api/v1/vagas/${idErrada}`, { situacao: "pausada" })).statusCode, 200);
  assert.equal((await call("POST", `/api/v1/contratacoes/${id}/trocar-vaga`, { id_vaga: idErrada })).json().error.code, "VAGA_ENCERRADA");
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

test("aba Rescisão: quem foi demitido com rescisão continua na busca e a rescisão pode ser editada até ser assinada", async () => {
  const company = await call("POST", "/api/v1/empresas", {
    razao_social: "Empresa Rescisão Ltda", cnpj: cnpj(7), email: "resc@example.com",
  });
  const vaga = await call("POST", "/api/v1/vagas", {
    id_empresa: company.json().data.id_empresa, cargo: "Estágio", tipo_vaga: 1, quantidade_posicoes: 3,
  });
  const contratar = async (nome: string, numero: number) => {
    const person = await call("POST", "/api/v1/candidatos", { nome, cpf: cpf(numero), email: `resc${numero}@example.com` });
    const hired = await call("POST", "/api/v1/contratacoes", {
      id_candidato: person.json().data.id_candidato, id_vaga: vaga.json().data.id_vaga, data_inicio: "2026-11-01",
    }, { "idempotency-key": `resc-${numero}-${Date.now()}` });
    return hired.json().data.id_contratacao as number;
  };
  const ativo = await contratar("Rescisão Ativa Teste", 401);
  const demitida = await contratar("Rescisão Demitida Teste", 402);
  const semRescisao = await contratar("Rescisão Sem Documento Teste", 403);
  const comRescisao = await call("POST", `/api/v1/contratacoes/${demitida}/encerrar`, {
    data_encerramento: "2026-12-10", motivo: "Término do contrato", avaliacao: "Bom",
  });
  assert.equal(comRescisao.statusCode, 200);
  await call("POST", `/api/v1/contratacoes/${semRescisao}/encerrar`, { data_encerramento: "2026-12-10" });

  const lista = await call("GET", `/api/v1/contratacoes?status=1&rescisao=1&q=${encodeURIComponent("Rescisão Teste")}`);
  assert.equal(lista.statusCode, 200);
  const porId = new Map((lista.json().data as Array<{ id_contratacao: number; rescisao: { assinatura: string } | null }>).map((item) => [item.id_contratacao, item]));
  assert.equal(porId.get(ativo)?.rescisao, null);
  assert.equal(porId.get(demitida)?.rescisao?.assinatura, "Não assina digitalmente");
  assert.equal(porId.has(semRescisao), false);
  assert.equal(lista.json().meta.total, 2);

  // Sem rescisao=1 continua só com os ativos.
  const ativos = await call("GET", `/api/v1/contratacoes?status=1&q=${encodeURIComponent("Rescisão Teste")}`);
  assert.deepEqual(ativos.json().data.map((item: { id_contratacao: number }) => item.id_contratacao), [ativo]);

  // Editar a rescisão: refaz o documento, muda a data de demissão e zera a assinatura.
  await db.query("UPDATE dna_work.rescisao_documento SET assinatura = 'Aguardando', zapsign_token = 'tok-antigo', sign_url = 'https://exemplo' WHERE id_contratacao = $1", [demitida]);
  const editada = await call("PATCH", `/api/v1/contratacoes/${demitida}/rescisao`, {
    data_encerramento: "2026-12-12", motivo: "Empresa solicitou o desligamento", avaliacao: "Regular", resumo: "Atendimento ao cliente",
  });
  assert.equal(editada.statusCode, 200);
  assert.equal(editada.json().data.data_demissao, "2026-12-12");
  assert.equal(editada.json().data.assinatura, "Não assina digitalmente");
  const doc = await db.query("SELECT motivo, avaliacao, zapsign_token, sign_url, texto FROM dna_work.rescisao_documento WHERE id_contratacao = $1", [demitida]);
  assert.equal(doc.rows[0].motivo, "Empresa solicitou o desligamento");
  assert.equal(doc.rows[0].avaliacao, "Regular");
  assert.equal(doc.rows[0].zapsign_token, null);
  assert.equal(doc.rows[0].sign_url, null);
  assert.match(doc.rows[0].texto, /12\/12\/2026/);
  const contratacao = await call("GET", `/api/v1/contratacoes/${demitida}`);
  assert.equal(contratacao.json().data.data_encerramento, "2026-12-12");
  const antesDoInicio = await call("PATCH", `/api/v1/contratacoes/${demitida}/rescisao`, { data_encerramento: "2026-10-01", motivo: "Término" });
  assert.equal(antesDoInicio.statusCode, 422);
  await db.query("UPDATE dna_work.rescisao_documento SET assinatura = 'Assinado' WHERE id_contratacao = $1", [demitida]);
  const assinada = await call("PATCH", `/api/v1/contratacoes/${demitida}/rescisao`, { data_encerramento: "2026-12-13", motivo: "Término" });
  assert.equal(assinada.statusCode, 409);
  assert.equal(assinada.json().error.code, "RESCISAO_ASSINADA");
  assert.equal((await call("GET", `/api/v1/contratacoes/${demitida}/rescisao`)).json().data.editavel, false);
  const semDoc = await call("PATCH", `/api/v1/contratacoes/${semRescisao}/rescisao`, { data_encerramento: "2026-12-13", motivo: "Término" });
  assert.equal(semDoc.statusCode, 404);
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

test("gera acesso ao portal, mostra a senha só na resposta e não a guarda", async () => {
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
      atualiza_senha integer,
      senha_envio text
    )
  `);
  // Senha em texto guardada por uma versão antiga: precisa ser apagada.
  await db.query(`
    insert into dna_work.usuario_empresa (id_u, nome_u, email_u, senha_u, senha_hash, empresa_u, status, tipo, atualiza_senha, senha_envio)
    values ('usuario-antigo', 'Antigo', 'antigo@example.com', 'md5', 'hash', 'empresa-antiga', 1, 1, 0, 'SenhaEmTexto1')
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
  const gravado = await db.query(`select senha_envio, senha_u, senha_hash, atualiza_senha from dna_work.usuario_empresa where empresa_u = $1`, [id]);
  assert.equal(gravado.rows[0].senha_envio, null);
  assert.equal(gravado.rows[0].senha_u, null);
  assert.match(gravado.rows[0].senha_hash, /^\$argon2id\$/);
  assert.equal(gravado.rows[0].atualiza_senha, 1);
  const restantes = await db.query(`select count(*)::int as n from dna_work.usuario_empresa where senha_envio is not null`);
  assert.equal(restantes.rows[0].n, 0);
  const antigo = await db.query(`select senha_u, senha_hash from dna_work.usuario_empresa where id_u = 'usuario-antigo'`);
  assert.deepEqual(antigo.rows[0], { senha_u: "md5", senha_hash: "hash" });
  const ficha = await call("GET", `/api/v1/empresas/${id}`);
  assert.equal(ficha.json().data.portal.email, "portal@example.com");
  assert.equal("senha" in ficha.json().data.portal, false);
  assert.equal(JSON.stringify(ficha.json()).includes(gerado.json().data.senha), false);
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
  assert.equal(JSON.stringify(atualizada.json()).includes(nova.json().data.senha), false);
  const redefinida = await db.query(`select senha_envio, senha_u, atualiza_senha from dna_work.usuario_empresa where empresa_u = $1`, [id]);
  assert.deepEqual(redefinida.rows[0], { senha_envio: null, senha_u: null, atualiza_senha: 1 });
});
