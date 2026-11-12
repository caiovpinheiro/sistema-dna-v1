import assert from "node:assert/strict";
import test from "node:test";
import {
  idsParaRepetir,
  mesclarAvaliacoes,
  ordemDeExibicao,
  organizarVagas,
  perfilPreenchido,
  PERFIL_VAZIO,
  problemaDoPerfil,
  proximoLote,
  rotuloTurnos,
  rotuloConfianca,
  rotuloScore,
  selecaoValida,
  selecionadasNaOrdem,
  textoParaCandidato,
  type AvaliacaoJev,
  type AvaliacaoVaga,
  type Vaga,
} from "../src/lib/triagem-matching.ts";

const vaga = (id: string, distanceKm: number, extra: Partial<Vaga> = {}): Vaga => ({
  id, title: `Vaga ${id}`, company: "Empresa", location: "Centro, São Paulo SP", contractType: "CLT", salaryLabel: "R$ 2.000,00",
  hasBenefits: false, homeOffice: false, schedule: null, schedules: [], distanceKm, ...extra,
});

const jev = (score: number, escala = { min: 0, max: 4 }): AvaliacaoJev => ({
  score, escala, confianca: 0.7, nivel: "Moderada", descricaoNivel: null, probabilidadeNivel: null, probabilidades: null, legenda: {}, modelo: "jev-1.14.0",
  justificativa: null, evidencias: [], lacunas: [],
});

const avaliada = (id: string, score: number): AvaliacaoVaga => ({ id, status: "avaliada", motivo: null, jev: jev(score), explicacao: null });
const semScore = (id: string, status: AvaliacaoVaga["status"]): AvaliacaoVaga => ({ id, status, motivo: "x", jev: null, explicacao: null });

const VAGAS = [vaga("a", 1), vaga("b", 2), vaga("c", 3), vaga("d", 4), vaga("e", 5), vaga("f", 6)];

test("ordena por maior compatibilidade, com distância como desempate", () => {
  const avaliacoes = mesclarAvaliacoes({}, [avaliada("a", 1.5), avaliada("b", 3.2), avaliada("c", 3.2), avaliada("d", 0.4)]);
  const organizado = organizarVagas(VAGAS, avaliacoes);
  assert.deepEqual(organizado.avaliadas.map((item) => item.id), ["b", "c", "a", "d"]);
  assert.deepEqual(organizado.pendentes.map((item) => item.id), ["e", "f"]);
});

test("vagas sem avaliação ficam separadas, nunca descartadas", () => {
  const avaliacoes = mesclarAvaliacoes({}, [avaliada("c", 2), semScore("a", "falhou"), semScore("b", "dados_insuficientes"), semScore("d", "indisponivel")]);
  const organizado = organizarVagas(VAGAS, avaliacoes);
  assert.deepEqual(organizado.avaliadas.map((item) => item.id), ["c"]);
  assert.deepEqual(organizado.semAvaliacao.map((item) => item.id), ["a", "b", "d"]);
  assert.equal(ordemDeExibicao(organizado).length, VAGAS.length);
  assert.deepEqual(idsParaRepetir(avaliacoes), ["a"]);
});

test("lotes sob demanda: próximo lote pega as mais próximas ainda não analisadas", () => {
  assert.deepEqual(proximoLote(VAGAS, {}, 4), ["a", "b", "c", "d"]);
  const depois = mesclarAvaliacoes({}, ["a", "b", "c", "d"].map((id) => avaliada(id, 1)));
  assert.deepEqual(proximoLote(VAGAS, depois, 4), ["e", "f"]);
  assert.deepEqual(proximoLote(VAGAS, mesclarAvaliacoes(depois, [avaliada("e", 1), avaliada("f", 1)]), 4), []);
});

test("não limita a quatro vagas e não repete vaga duplicada", () => {
  const comDuplicada = [...VAGAS, vaga("a", 9)];
  const organizado = organizarVagas(comDuplicada, mesclarAvaliacoes({}, VAGAS.map((item, indice) => avaliada(item.id, indice % 5))));
  assert.equal(organizado.avaliadas.length, 6);
  assert.equal(ordemDeExibicao(organizado).filter((item) => item.id === "a").length, 1);
});

test("avaliação mais recente substitui a anterior da mesma vaga", () => {
  const primeira = mesclarAvaliacoes({}, [semScore("a", "falhou")]);
  const segunda = mesclarAvaliacoes(primeira, [avaliada("a", 3)]);
  assert.equal(segunda.a.status, "avaliada");
  assert.equal(Object.keys(segunda).length, 1);
});

test("seleção é preservada ao reordenar e ao analisar mais", () => {
  const marcadas = ["f", "a"];
  const antes = organizarVagas(VAGAS, {});
  assert.deepEqual(selecionadasNaOrdem(ordemDeExibicao(antes), marcadas).map((item) => item.id), ["a", "f"]);
  const depois = organizarVagas(VAGAS, mesclarAvaliacoes({}, [avaliada("f", 4), avaliada("a", 1)]));
  assert.deepEqual(selecionadasNaOrdem(ordemDeExibicao(depois), marcadas).map((item) => item.id), ["f", "a"]);
  assert.deepEqual(selecaoValida(["a", "a", "sumiu"], VAGAS), ["a"]);
});

test("score aparece na escala do JEV, sem virar porcentagem", () => {
  assert.equal(rotuloScore(jev(2.32)), "2,32 (escala 0–4)");
  assert.equal(rotuloConfianca(0.7), "confiança 0,7");
  assert.equal(rotuloConfianca(null), null);
});

test("perfil: precisa de currículo analisado ou habilidades; cursando médio exige turno de estudo", () => {
  assert.equal(perfilPreenchido(PERFIL_VAZIO), false);
  assert.equal(perfilPreenchido({ ...PERFIL_VAZIO, escolaridade: "medio_completo", tempoExperiencia: "2 anos" }), false);
  assert.equal(perfilPreenchido({ ...PERFIL_VAZIO, habilidades: "Excel" }), true);
  assert.equal(perfilPreenchido({ ...PERFIL_VAZIO, curriculo: "Experiência profissional:\n- Atendente — Loja A — 2 anos" }), true);
  assert.equal(problemaDoPerfil({ ...PERFIL_VAZIO, habilidades: "Excel", escolaridade: "cursando_medio" }), "Informe o turno em que a pessoa estuda.");
  assert.equal(problemaDoPerfil({ ...PERFIL_VAZIO, habilidades: "Excel", escolaridade: "cursando_medio", turnoEstudo: "manha" }), null);
  assert.match(problemaDoPerfil(PERFIL_VAZIO) ?? "", /envie o currículo ou informe as habilidades/);
});

test("turnos aparecem na vaga só como informação", () => {
  assert.equal(rotuloTurnos(PERFIL_VAZIO), null);
  assert.equal(rotuloTurnos({ ...PERFIL_VAZIO, turno: "tarde", escolaridade: "cursando_medio", turnoEstudo: "manha" }), "Turno da pessoa — disponível: tarde · estuda: manhã");
  assert.equal(rotuloTurnos({ ...PERFIL_VAZIO, turno: "noite", escolaridade: "medio_completo", turnoEstudo: "manha" }), "Turno da pessoa — disponível: noite");
});

test("mensagem ao candidato é a mesma de antes", () => {
  assert.equal(textoParaCandidato([]), "");
  assert.equal(
    textoParaCandidato([vaga("a", 1, { schedules: ["Segunda a sexta, 08:00 às 17:00"], hasBenefits: true })]),
    "✨ Encontrei esta vaga de CLT próxima de você:\n\n1. Vaga a\n📍 Centro, São Paulo SP\n🕒 Segunda a sexta, 08:00 às 17:00\n💰 R$ 2.000,00 + benefícios\n\nPossui interesse?",
  );
  assert.equal(
    textoParaCandidato([vaga("a", 1), vaga("b", 2, { contractType: "Estágio", homeOffice: true })]),
    "✨ Encontrei estas vagas próximas de você:\n\n1. Vaga a\n📍 Centro, São Paulo SP\n💰 R$ 2.000,00\n\n2. Vaga b\n📍 Centro, São Paulo SP\n🏠 Home office\n💰 R$ 2.000,00\n\nPossui interesse? Se sim, nos informe o número da vaga.",
  );
});
