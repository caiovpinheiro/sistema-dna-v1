import assert from "node:assert/strict";
import test from "node:test";
import { etapaInicial, podeMover, taxaConversao } from "../src/lib/processo.js";

test("candidato da empresa começa recebido e o da DNAWORK já encaminhado", () => {
  assert.equal(etapaInicial("empresa", null), "recebido");
  assert.equal(etapaInicial("empresa", "2026-10-24"), "encaminhado");
  assert.equal(etapaInicial("dnawork", "2026-10-24"), "encaminhado");
});

test("a trilha avança e a contratação não é marcada à mão", () => {
  assert.equal(podeMover("recebido", "encaminhado"), true);
  assert.equal(podeMover("recebido", "entrevista_realizada"), true);
  assert.equal(podeMover("encaminhado", "recebido"), false);
  assert.equal(podeMover("entrevista_agendada", "reprovado"), true);
  assert.equal(podeMover("entrevista_realizada", "contratado"), false);
  assert.equal(podeMover("contratado", "desistente"), false);
  assert.equal(podeMover("reprovado", "encaminhado"), false);
});

test("conversão só existe quando houve entrada no período", () => {
  assert.equal(taxaConversao(1, 4), 25);
  assert.equal(taxaConversao(1, 3), 33.3);
  assert.equal(taxaConversao(0, 0), null);
  assert.equal(taxaConversao(2, 0), null);
});
