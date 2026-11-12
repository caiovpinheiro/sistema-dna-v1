import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { AppError } from "../src/lib/errors.js";
import { PROMPT_DOSSIE_CLT, PROMPT_DOSSIE_ESTAGIO } from "../src/lib/dossie/prompts.js";
import { DossieService, interpretarDossie, montarDadosDoCandidato, type CandidatoDados, type CrmFn } from "../src/services/dossie.service.js";

const config = { OPENAI_API_KEY: "sk-teste", OPENAI_API_URL: "https://openai.test/v1", LUNA_MODEL: "luna-teste", LUNA_TIMEOUT_MS: 10_000 };

const vagaClt = {
  id: "101", cargo: "Atendente", tipo_vaga: 2, atividades: "Atendimento no balcão", descricao: null, requisitos: "Ensino médio",
  horario: null, cargo_descricao: null, cargo_requisitos: null, nome_fantasia: "Loja X", local: "Centro - São Paulo / SP", empresa_id: "7",
};
const vagaEstagio = { ...vagaClt, id: "202", cargo: "Estagiário administrativo", tipo_vaga: 1 };

const linha: CandidatoDados = {
  id: 1, created_at: "2026-11-11", dealId: "deal-1", telefone: 5511999990000, resumo_cv: "Atendente por 2 anos na Loja Y.", nome: "Maria Souza",
  cep: 1310000, sexo: "F", escolaridade: "Ensino médio completo", turno: null, idade: 22, tipo_de_vaga: "CLT",
  "teste comportamental": "Perfil analítico", info_conducoes: "40 min, 1 condução", descricao_vaga: "Vaga antiga", id_vaga_escolhida: "999",
  id_empresa: "1", resumo_entrevista: "",
};

function banco(opcoes: { vagas?: typeof vagaClt[]; candidato?: CandidatoDados | null; semTabela?: boolean } = {}) {
  const consultas: string[] = [];
  const db = {
    async query(sql: string, params: unknown[] = []) {
      consultas.push(sql);
      if (sql.includes("FROM public.candidatos_dados")) {
        if (opcoes.semTabela) throw Object.assign(new Error("sem tabela"), { code: "42P01" });
        return { rows: opcoes.candidato && params[0] === opcoes.candidato.dealId ? [opcoes.candidato] : [] };
      }
      if (sql.includes("FROM public.vaga v")) {
        const vagas = opcoes.vagas ?? [vagaClt, vagaEstagio];
        return { rows: params.length ? vagas.filter((vaga) => vaga.id === params[0]) : vagas };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    },
  } as unknown as Pool;
  return { db, consultas };
}

function openai(texto: string) {
  const pedidos: Array<{ url: string; body: any }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    pedidos.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: texto }] }] }), { status: 200 });
  };
  return { fetcher, pedidos };
}

const semCrm: CrmFn = async () => { throw new Error("CRM não deveria ser chamado"); };

test("dados do candidato: tira telefone e CEP, troca a vaga pela escolhida e aplica as correções", () => {
  const dados = montarDadosDoCandidato({ linha, vaga: vagaClt, manual: { nome: "Maria S. Souza", turno: "" } });
  assert.equal(dados.nome, "Maria S. Souza");
  assert.equal(dados.telefone, undefined);
  assert.equal(dados.cep, undefined);
  assert.equal(dados.resumo_entrevista, undefined);
  assert.equal(dados.cargo_vaga, "Atendente");
  assert.equal(dados.id_vaga_escolhida, "101");
  assert.equal(dados.id_empresa, "7");
  assert.match(String(dados.descricao_vaga), /Atividades: Atendimento no balcão/);
  assert.doesNotMatch(String(dados.descricao_vaga), /Vaga antiga/);
  assert.equal(dados["teste comportamental"], "Perfil analítico");
  assert.equal(dados.resumo_cv, "Atendente por 2 anos na Loja Y.");
});

test("currículo enviado substitui o resumo_cv do banco", () => {
  assert.equal(montarDadosDoCandidato({ linha, vaga: vagaClt, resumoCv: "Novo currículo colado" }).resumo_cv, "Novo currículo colado");
  assert.equal(montarDadosDoCandidato({ linha, vaga: vagaClt, resumoCv: null }).resumo_cv, undefined);
});

test("ERRO_DADOS_INCONSISTENTES vira erro com o motivo, como no n8n", () => {
  assert.deepEqual(interpretarDossie("ERRO_DADOS_INCONSISTENTES: currículo de outra pessoa"), { ok: false, motivo: "currículo de outra pessoa" });
  assert.deepEqual(interpretarDossie("  "), { ok: false, motivo: "A IA não retornou nenhum texto." });
  assert.deepEqual(interpretarDossie("Perfil: Maria - Atendente\n\nTexto"), { ok: true, dossie: "Perfil: Maria - Atendente\n\nTexto" });
});

test("gerar usa o prompt CLT para vaga CLT e o de estágio para vaga de estágio", async () => {
  for (const [vagaId, prompt] of [["101", PROMPT_DOSSIE_CLT], ["202", PROMPT_DOSSIE_ESTAGIO]] as const) {
    const { db } = banco({ candidato: linha });
    const ia = openai("Perfil: Maria Souza - Vaga\n\nMaria tem 22 anos.");
    const servico = new DossieService(db, config, semCrm, ia.fetcher, () => new Date("2026-11-12T12:00:00Z"));
    const resultado = await servico.gerar({ vagaId, dealId: "deal-1" });
    assert.equal(resultado.dossie, "Perfil: Maria Souza - Vaga\n\nMaria tem 22 anos.");
    assert.equal(resultado.curriculo, "banco");
    const texto = ia.pedidos[0].body.input[0].content.at(-1).text as string;
    assert.ok(texto.startsWith(prompt));
    assert.match(texto, /DATA DE REFERÊNCIA:\n2026-11-12/);
    assert.doesNotMatch(texto, /5511999990000/);
    assert.equal(ia.pedidos[0].body.model, "luna-teste");
  }
});

test("PDF enviado vai anexado e o resumo_cv do banco sai do JSON", async () => {
  const { db } = banco({ candidato: linha });
  const ia = openai("Perfil: Maria Souza - Atendente");
  const servico = new DossieService(db, config, semCrm, ia.fetcher);
  const resultado = await servico.gerar({ vagaId: "101", dealId: "deal-1", curriculo: { tipo: "pdf", nome: "cv.pdf", base64: "JVBERi0=" } });
  assert.equal(resultado.curriculo, "enviado");
  const [arquivo, texto] = ia.pedidos[0].body.input[0].content;
  assert.equal(arquivo.type, "input_file");
  assert.match(texto.text, /CURRÍCULO ANEXADO/);
  assert.doesNotMatch(texto.text, /Atendente por 2 anos na Loja Y/);
});

test("sem negócio no CRM, gera com nome manual e currículo; sem currículo nem nome, recusa", async () => {
  const { db } = banco();
  const ia = openai("Perfil: João - Atendente");
  const servico = new DossieService(db, config, semCrm, ia.fetcher);
  const resultado = await servico.gerar({ vagaId: "101", manual: { nome: "João" }, curriculo: { tipo: "texto", texto: "Experiência como atendente por 1 ano." } });
  assert.equal(resultado.dossie, "Perfil: João - Atendente");
  await assert.rejects(servico.gerar({ vagaId: "101", curriculo: { tipo: "texto", texto: "Experiência como atendente." } }), (erro: AppError) => erro.code === "SEM_NOME");
  await assert.rejects(servico.gerar({ vagaId: "101", manual: { nome: "João" } }), (erro: AppError) => erro.code === "SEM_CURRICULO");
  await assert.rejects(servico.gerar({ vagaId: "999", manual: { nome: "João" } }), (erro: AppError) => erro.code === "VAGA_NAO_ENCONTRADA");
});

test("resposta ERRO_DADOS_INCONSISTENTES da IA responde 422 com o motivo", async () => {
  const { db } = banco({ candidato: linha });
  const servico = new DossieService(db, config, semCrm, openai("ERRO_DADOS_INCONSISTENTES: nomes diferentes").fetcher);
  await assert.rejects(servico.gerar({ vagaId: "101", dealId: "deal-1" }), (erro: AppError) => erro.statusCode === 422 && erro.details?.motivo === "nomes diferentes");
});

test("busca pelo telefone: só dígitos no CRM, negócio aberto e mais recente primeiro, depois candidatos_dados", async () => {
  const { db } = banco({ candidato: linha });
  const chamadas: string[] = [];
  const crm = (async (path: string) => {
    chamadas.push(path);
    return {
      items: [
        { id: "antigo", title: "Negócio Maria", status: "LOST", updatedAt: "2026-11-11T00:00:00Z", contact: { name: "Maria", phone: "+5511999990000" } },
        { id: "deal-1", title: "Negócio Maria", status: "OPEN", updatedAt: "2026-11-01T00:00:00Z", stage: { name: "Entrevista", pipeline: { name: "Candidaturas" } }, contact: { name: "Maria", phone: "+5511999990000" } },
      ],
    };
  }) as CrmFn;
  const servico = new DossieService(db, config, crm);
  const resultado = await servico.buscarCandidato({ telefone: "(11) 99999-0000" });
  assert.equal(chamadas[0], "/api/deals?search=11999990000&perPage=10");
  assert.deepEqual(resultado.negocios.map((negocio) => negocio.id), ["deal-1", "antigo"]);
  assert.equal(resultado.negocio?.etapa, "Entrevista");
  assert.equal(resultado.candidato?.nome, "Maria Souza");

  const outro = await servico.buscarCandidato({ telefone: "11999990000", dealId: "antigo" });
  assert.equal(outro.negocio?.id, "antigo");
  assert.equal(outro.candidato, null);
});

test("banco sem candidatos_dados não derruba a busca", async () => {
  const { db } = banco({ semTabela: true });
  const crm = (async () => ({ items: [{ id: "deal-1", title: "N", status: "OPEN" }] })) as CrmFn;
  const resultado = await new DossieService(db, config, crm).buscarCandidato({ telefone: "11999990000" });
  assert.equal(resultado.negocio?.id, "deal-1");
  assert.equal(resultado.candidato, null);
});

test("salvar nota posta o conteúdo no negócio", async () => {
  const { db } = banco();
  const chamadas: Array<{ path: string; init?: RequestInit }> = [];
  const crm = (async (path: string, init?: RequestInit) => { chamadas.push({ path, init }); return {}; }) as CrmFn;
  await new DossieService(db, config, crm).salvarNota("deal-1", "Perfil: Maria");
  assert.equal(chamadas[0].path, "/api/deals/deal-1/notes");
  assert.equal(chamadas[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(chamadas[0].init?.body)), { content: "Perfil: Maria" });
});

test("sem OPENAI_API_KEY a geração responde 503", async () => {
  const { db } = banco();
  await assert.rejects(new DossieService(db, { ...config, OPENAI_API_KEY: "" }, semCrm).gerar({ vagaId: "101" }), (erro: AppError) => erro.statusCode === 503);
});
