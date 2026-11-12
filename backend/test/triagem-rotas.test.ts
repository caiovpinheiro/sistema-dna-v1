import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/sem_banco";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
process.env.ADMIN_EMAIL = "admin@dnawork.local";
process.env.ADMIN_PASSWORD = "Teste-Seguro-123";
process.env.ADMIN_PASSWORD_HASH = "";
process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "";
process.env.JEV_API_URL = "";
process.env.JEV_API_KEY = "";

/** Banco falso: só responde o que as rotas da triagem e o controle de acesso pedem. */
const db = {
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes("FROM dna_work.app_usuario WHERE id")) {
      return { rows: params[0] === "sem-triagem" || params[0] === "com-triagem" ? [{ id: params[0], ativo: true, admin: false }] : [] };
    }
    if (sql.includes("app_usuario_pagina")) return { rows: params[0] === "com-triagem" ? [{ pagina: "triagem" }] : [{ pagina: "painel" }] };
    if (sql.includes("FROM public.vaga v") && sql.includes("tipo_vaga = ANY")) {
      return { rows: [{ id: "v1", vaga_id: "g1", tipo_vaga: 2, cargo: "Atendente", salario: "2000", beneficios: null, sexo: "I", idade: null, idade_ate: null, horario: null, tipo_trabalho: null, latitude: -23.55, longitude: -46.63, nome_fantasia: "Loja", local: "Centro - São Paulo / SP" }] };
    }
    if (sql.includes("FROM public.vaga v")) {
      return { rows: [{ id: "v1", cargo: "Atendente", atividades: "Atendimento ao cliente no balcão", descricao: null, requisitos: null, escolaridade: null, carga_horaria: "44", horario: null, tipo_vaga: 2, cargo_descricao: null, cargo_requisitos: null }] };
    }
    throw Object.assign(new Error("tabela ausente no teste"), { code: "42P01" });
  },
} as unknown as Pool;

let app: FastifyInstance;
const fetchOriginal = globalThis.fetch;

before(async () => {
  globalThis.fetch = (async () => { throw new Error("sem rede no teste"); }) as typeof fetch;
  const { loadConfig } = await import("../src/config.js");
  const { buildApp } = await import("../src/app.js");
  app = await buildApp({ config: loadConfig(), db, capabilities: { quantidadePosicoes: true, colaboradorContratacao: true, idempotencia: true, sequence: true, missing: [] } });
});

after(async () => {
  globalThis.fetch = fetchOriginal;
  await app?.close();
});

function cookie(sub: string, email: string) {
  return `dnawork_session=${app.jwt.sign({ sub, email, role: "admin" })}`;
}

const admin = () => cookie("bootstrap-admin", "admin@dnawork.local");

test("rotas novas exigem login e a página triagem", async () => {
  for (const [method, url] of [["GET", "/api/v1/triagem/ia/status"], ["POST", "/api/v1/triagem/curriculo"], ["POST", "/api/v1/triagem/compatibilidade"]] as const) {
    assert.equal((await app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode, 401, url);
  }
  const negado = await app.inject({ method: "GET", url: "/api/v1/triagem/ia/status", headers: { cookie: cookie("sem-triagem", "op@dna.local") } });
  assert.equal(negado.statusCode, 403);
  const liberado = await app.inject({ method: "GET", url: "/api/v1/triagem/ia/status", headers: { cookie: cookie("com-triagem", "op@dna.local") } });
  assert.equal(liberado.statusCode, 200);
});

test("status informa Luna e JEV sem expor chaves", async () => {
  const resposta = await app.inject({ method: "GET", url: "/api/v1/triagem/ia/status", headers: { cookie: admin() } });
  const corpo = resposta.json();
  assert.equal(corpo.data.luna.configurada, false);
  assert.equal(corpo.data.luna.modelo, "gpt-6-luna");
  assert.equal(corpo.data.jev.pronto, false);
  assert.equal(corpo.data.jev.modelo, "jev-latest");
  assert.deepEqual(corpo.data.jev.escala, { min: 0, max: 4 });
});

test("busca rápida mantém o contrato de /triagem/vagas", async () => {
  const resposta = await app.inject({ method: "POST", url: "/api/v1/triagem/vagas", headers: { cookie: admin() }, payload: { cep: "01001-000", raioKm: 10, tipos: ["CLT"], lat: -23.55, lng: -46.63 } });
  assert.equal(resposta.statusCode, 200);
  const corpo = resposta.json();
  assert.equal(corpo.success, true);
  assert.deepEqual(Object.keys(corpo.data).sort(), ["jobs", "originLabel"]);
  assert.equal(corpo.data.jobs[0].id, "v1");
  assert.equal("jev" in corpo.data.jobs[0], false);
});

test("currículo: valida o corpo e responde 503 sem a chave da OpenAI", async () => {
  const vazio = await app.inject({ method: "POST", url: "/api/v1/triagem/curriculo", headers: { cookie: admin() }, payload: {} });
  assert.equal(vazio.statusCode, 422);
  const tipoErrado = await app.inject({ method: "POST", url: "/api/v1/triagem/curriculo", headers: { cookie: admin() }, payload: { arquivo: { nome: "cv.pdf", base64: Buffer.from("MZ binário").toString("base64") } } });
  assert.equal(tipoErrado.statusCode, 415);
  const semChave = await app.inject({ method: "POST", url: "/api/v1/triagem/curriculo", headers: { cookie: admin() }, payload: { texto: "Atendente de loja há três anos, com vendas e caixa." } });
  assert.equal(semChave.statusCode, 503);
  assert.equal(semChave.json().error.code, "LUNA_NAO_CONFIGURADA");
});

test("compatibilidade: sem JEV devolve vagas como indisponíveis, sem score", async () => {
  const resposta = await app.inject({
    method: "POST",
    url: "/api/v1/triagem/compatibilidade",
    headers: { cookie: admin() },
    payload: { perfil: { escolaridade: "medio_completo", turno: "tarde", curriculo: "Experiência profissional:\n- Atendente — Loja A — 3 anos: atendimento ao cliente." }, vagaIds: ["v1"] },
  });
  assert.equal(resposta.statusCode, 200);
  const avaliacao = resposta.json().data.avaliacoes[0];
  assert.equal(avaliacao.status, "indisponivel");
  assert.equal(avaliacao.jev, null);
  assert.equal(avaliacao.explicacao.origem, "dna_work_comparacao_textual");
  const semTurnoDeEstudo = await app.inject({
    method: "POST",
    url: "/api/v1/triagem/compatibilidade",
    headers: { cookie: admin() },
    payload: { perfil: { escolaridade: "cursando_medio", habilidades: "Excel" }, vagaIds: ["v1"] },
  });
  assert.equal(semTurnoDeEstudo.statusCode, 422);
  assert.match(semTurnoDeEstudo.json().error.message, /turno em que a pessoa estuda/);
  const escolaridadeInvalida = await app.inject({ method: "POST", url: "/api/v1/triagem/compatibilidade", headers: { cookie: admin() }, payload: { perfil: { escolaridade: "doutorado", habilidades: "Excel" }, vagaIds: ["v1"] } });
  assert.equal(escolaridadeInvalida.statusCode, 422);
  const semVagas = await app.inject({ method: "POST", url: "/api/v1/triagem/compatibilidade", headers: { cookie: admin() }, payload: { perfil: {}, vagaIds: [] } });
  assert.equal(semVagas.statusCode, 422);
});
