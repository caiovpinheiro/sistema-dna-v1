import assert from "node:assert/strict";
import test from "node:test";
import { CODIGOS_POR_STATUS, recusaPorStatus } from "../src/lib/vaga-status.js";

/** Matriz status × ocupação da recusa de contratação (sempre 409 na API). */
test("aberta nunca é recusada por status (a capacidade é conferida depois, com a vaga travada)", () => {
  for (const codigo of CODIGOS_POR_STATUS.aberta) {
    assert.equal(recusaPorStatus(codigo, 0, 5), null);
    assert.equal(recusaPorStatus(codigo, 5, 5), null);
  }
});

test("contratada e lotada → VAGA_SEM_POSICAO; contratada com posição livre → VAGA_ENCERRADA", () => {
  assert.equal(recusaPorStatus(1, 5, 5), "VAGA_SEM_POSICAO");
  assert.equal(recusaPorStatus("1", 6, 5), "VAGA_SEM_POSICAO");
  assert.equal(recusaPorStatus(1, 1, 1), "VAGA_SEM_POSICAO");
  assert.equal(recusaPorStatus(1, 4, 5), "VAGA_ENCERRADA");
  assert.equal(recusaPorStatus(1, 0, 1), "VAGA_ENCERRADA");
});

test("pausada, fechada, cancelada, desativada e código desconhecido → VAGA_ENCERRADA, mesmo lotadas", () => {
  for (const codigo of [...CODIGOS_POR_STATUS.pausada, ...CODIGOS_POR_STATUS.fechada, null, "", 99]) {
    assert.equal(recusaPorStatus(codigo, 0, 5), "VAGA_ENCERRADA", String(codigo));
    assert.equal(recusaPorStatus(codigo, 5, 5), "VAGA_ENCERRADA", String(codigo));
  }
});
