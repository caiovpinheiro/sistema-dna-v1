import assert from "node:assert/strict";
import test from "node:test";
import { chaveCargo, nomePadronizado } from "../src/lib/cargo.js";
import { AppError } from "../src/lib/errors.js";
import { CargoService } from "../src/services/cargo.service.js";
import { vagaCadastroSchema } from "../src/schemas/cadastro.js";
import { CargosSyncService, planoDeCargos } from "../src/services/cargos-sync.service.js";
import { cargoDoModelo } from "../../frontend/src/lib/cargo.js";

test("chave junta variações de maiúscula, acento, espaço e pontuação", () => {
  assert.equal(chaveCargo("Operador De Loja"), "operador de loja");
  assert.equal(chaveCargo("  operador   de loja "), "operador de loja");
  assert.equal(chaveCargo("Açougueiro:"), "acougueiro");
  assert.notEqual(chaveCargo("Operadora de Loja"), chaveCargo("Operador de Loja"));
  assert.equal(chaveCargo("—:"), "");
});

test("nome padronizado", () => {
  assert.equal(nomePadronizado("Operador De Loja"), "Operador de Loja");
  assert.equal(nomePadronizado("operador de caixa"), "Operador de Caixa");
  assert.equal(nomePadronizado("Açougueiro:"), "Açougueiro");
  assert.equal(nomePadronizado("REPOSITOR DE HORTIFRUTI"), "Repositor de Hortifruti");
  assert.equal(nomePadronizado("Auxiliar de Produção e Logística"), "Auxiliar de Produção e Logística");
});

type Linha = { id: string; nome: string; chave: string; descricao: string | null; requisitos: string | null };

function supabaseFalso(iniciais: Linha[] = [], opcoes: { duplicarNoInsert?: Linha } = {}) {
  const linhas = [...iniciais];
  return {
    linhas,
    rest: () => ({
      async get<T>(path: string) {
        const chave = decodeURIComponent(path.match(/chave=eq\.([^&]+)/)?.[1] ?? "");
        return (chave ? linhas.filter((l) => l.chave === chave) : linhas) as T;
      },
      async insert<T>(_tabela: string, body: Linha) {
        if (opcoes.duplicarNoInsert) {
          linhas.push(opcoes.duplicarNoInsert);
          throw new AppError(502, "SUPABASE", 'duplicate key value violates unique constraint "cargo_chave_unica"');
        }
        linhas.push(body);
        return [body] as T;
      },
      async update() {},
      async remove() {},
    }),
  };
}

function dbFalso() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return { queries, db: { query: async (sql: string, params: unknown[] = []) => { queries.push({ sql, params }); return { rows: [], rowCount: 1 }; } } };
}

const configFalsa = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "y" } as never;
const operador: Linha = { id: "11111111-1111-1111-1111-111111111111", nome: "Operador de Loja", chave: "operador de loja", descricao: "Desc", requisitos: "Req" };

test("cargo novo com nome que já existe reaproveita o existente sem mudar os textos", async () => {
  const sb = supabaseFalso([operador]);
  const { db } = dbFalso();
  const r = await new CargoService(db as never, configFalsa, sb.rest as never).resolverNovo({ nome: "operador de loja", descricao: "Outra", requisitos: "Outro" });
  assert.equal(r.reaproveitado, true);
  assert.equal(r.cargo.id, operador.id);
  assert.equal(r.cargo.descricao, "Desc");
  assert.equal(sb.linhas.length, 1);
});

test("cargo novo é criado com nome padronizado e espelhado no Postgres com o mesmo id", async () => {
  const sb = supabaseFalso([operador]);
  const { db, queries } = dbFalso();
  const r = await new CargoService(db as never, configFalsa, sb.rest as never).resolverNovo({ nome: "telemarketing", descricao: "Atende", requisitos: "Fala bem" });
  assert.equal(r.reaproveitado, false);
  assert.equal(r.cargo.nome, "Telemarketing");
  assert.equal(r.cargo.chave, "telemarketing");
  assert.equal(r.cargo.descricao, "Atende");
  const insertPg = queries.find((q) => /INSERT INTO public\.cargo/.test(q.sql));
  assert.ok(insertPg);
  assert.equal(insertPg.params[0], r.cargo.id);
});

test("criação concorrente: chave repetida no Supabase devolve o cargo que já existe", async () => {
  const outro: Linha = { id: "22222222-2222-2222-2222-222222222222", nome: "Telemarketing", chave: "telemarketing", descricao: "Primeiro", requisitos: "Primeiro" };
  const sb = supabaseFalso([], { duplicarNoInsert: outro });
  const { db } = dbFalso();
  const r = await new CargoService(db as never, configFalsa, sb.rest as never).resolverNovo({ nome: "Telemarketing", descricao: "Segundo", requisitos: "Segundo" });
  assert.equal(r.cargo.id, outro.id);
  assert.equal(r.reaproveitado, true);
});

test("nome que vira chave vazia é recusado com 422", async () => {
  const { db } = dbFalso();
  await assert.rejects(
    new CargoService(db as never, configFalsa, supabaseFalso().rest as never).resolverNovo({ nome: "—:", descricao: "abc", requisitos: "abc" }),
    (error: unknown) => error instanceof AppError && error.statusCode === 422,
  );
});

const vagaBase = {
  empresa_id: "33333333-3333-3333-3333-333333333333", tipo: "clt", carga_horaria: "44", salario: "1800,00",
  horario_entrada: "08:00", horario_saida: "17:00", sexo: "I", idade: 18, idade_ate: 40, atividades: "Atender clientes", quantidade: 1,
};

test("abrir vaga exige um cargo da lista ou um cargo novo, nunca os dois", () => {
  assert.equal(vagaCadastroSchema.safeParse(vagaBase).success, false);
  assert.equal(vagaCadastroSchema.safeParse({ ...vagaBase, cargo_id: operador.id }).success, true);
  const novo = { nome: "Telemarketing", descricao: "Atende ligações", requisitos: "Boa comunicação" };
  assert.equal(vagaCadastroSchema.safeParse({ ...vagaBase, novo_cargo: novo }).success, true);
  assert.equal(vagaCadastroSchema.safeParse({ ...vagaBase, cargo_id: operador.id, novo_cargo: novo }).success, false);
  assert.equal(vagaCadastroSchema.safeParse({ ...vagaBase, novo_cargo: { ...novo, descricao: "" } }).success, false);
});

test("modelo antigo encontra o cargo pelo id ou pela chave do texto", () => {
  const cargos = [operador];
  assert.equal(cargoDoModelo({ cargo: "Qualquer", cargo_id: operador.id }, cargos)?.id, operador.id);
  assert.equal(cargoDoModelo({ cargo: "Operador De Loja", cargo_id: null }, cargos)?.id, operador.id);
  assert.equal(cargoDoModelo({ cargo: "Telemarketing", cargo_id: null }, cargos), null);
});

const vazio = { id: "44444444-4444-4444-4444-444444444444", nome: "Padeiro", chave: "padeiro", descricao: null, requisitos: null };

test("sync de cargos: vincula, aponta cargo faltando e completa só texto vazio", () => {
  const cargos = new Map([[operador.chave, operador], [vazio.chave, vazio]]);
  const linhas = [
    { tabela: "vaga" as const, id: "v1", cargo: "Operador De Loja", cargo_id: null, descricao: null, requisitos: null },
    { tabela: "vaga" as const, id: "v2", cargo: "Telemarketing", cargo_id: null, descricao: null, requisitos: null },
    { tabela: "vaga_repetida" as const, id: "r1", cargo: "Operador de loja", cargo_id: operador.id, descricao: "Já escrita", requisitos: "" },
    { tabela: "vaga" as const, id: "v3", cargo: "—", cargo_id: null, descricao: null, requisitos: null },
    { tabela: "vaga" as const, id: "v4", cargo: "Padeiro", cargo_id: null, descricao: null, requisitos: null },
  ];
  const plano = planoDeCargos(linhas, cargos);
  assert.deepEqual(plano.cargosFaltando, ["Telemarketing"]);
  const porId = new Map(plano.atualizacoes.map((a) => [a.id, a]));
  assert.deepEqual(porId.get("v1")?.campos, { cargo_id: operador.id, descricao: "Desc", requisitos: "Req" });
  assert.deepEqual(porId.get("r1")?.campos, { requisitos: "Req" });
  assert.equal(porId.has("v2"), false);
  assert.equal(porId.has("v3"), false);
  assert.deepEqual(porId.get("v4")?.campos, { cargo_id: vazio.id });
});

test("#1 cargo ausente no Postgres: é espelhado antes da vaga; com chave em outro id, a vaga vai sem cargo_id no Postgres", async () => {
  const consultas: string[] = [];
  const presente = { query: async (sql: string) => { consultas.push(sql); return { rows: /SELECT id/.test(sql) ? [{ id: operador.id }] : [], rowCount: 1 }; } };
  const servico = new CargoService(presente as never, configFalsa, supabaseFalso([operador]).rest as never);
  assert.equal(await servico.idNoPostgres(presente as never, operador), operador.id);
  assert.ok(consultas.some((sql) => /INSERT INTO public\.cargo[\s\S]*ON CONFLICT DO NOTHING/.test(sql)));
  const ausente = { query: async () => ({ rows: [], rowCount: 0 }) };
  assert.equal(await servico.idNoPostgres(ausente as never, operador), null);
});

test("#8 cargo_id vazio dá a mensagem amigável", () => {
  const r = vagaCadastroSchema.safeParse({ ...vagaBase, cargo_id: "" });
  assert.equal(r.success, false);
  assert.equal(r.error?.issues[0]?.message, "Escolha um cargo da lista ou cadastre um novo.");
});

test("#2 #9 sync grava o Postgres antes do Supabase, com guarda de texto vazio; falha no Postgres não toca o Supabase", async () => {
  const patches: string[] = [];
  const sb = supabaseFalso([operador]);
  const linhasVaga = [{ id: "v1", cargo: "Operador de Loja", cargo_id: null, descricao: null, requisitos: null }];
  const rest = () => ({ ...sb.rest(), get: async (path: string) => (path.startsWith("vaga?") ? linhasVaga : path.startsWith("vaga_repetida?") ? [] : sb.rest().get(path)), update: async (path: string) => { patches.push(path); } });
  const sqls: string[] = [];
  const db = { query: async (sql: string) => { sqls.push(sql); if (/^UPDATE public\.vaga/.test(sql)) throw new Error("fk"); return { rows: [{ id: operador.id }], rowCount: 1 }; } };
  const log = { info() {}, warn() {}, error() {} };
  const r = await new CargosSyncService(db as never, configFalsa, new CargoService(db as never, configFalsa, rest as never), log, rest as never).executar(false, "t");
  assert.equal(r.erros, 1);
  assert.equal(patches.length, 0);
  const update = sqls.find((sql) => /^UPDATE public\.vaga/.test(sql))!;
  assert.match(update, /descricao IS NULL OR btrim\(descricao\) = ''/);
  assert.match(update, /COALESCE\(cargo_id/);
});

test("novo cargo sem descrição ou requisitos é recusado com mensagem em português", () => {
  const r = vagaCadastroSchema.safeParse({ ...vagaBase, novo_cargo: { nome: "Telemarketing", descricao: "", requisitos: "" } });
  assert.equal(r.success, false);
  const mensagens = r.error!.issues.map((issue) => issue.message);
  assert.ok(mensagens.includes("Escreva a descrição do novo cargo."));
  assert.ok(mensagens.includes("Escreva os requisitos do novo cargo."));
});
