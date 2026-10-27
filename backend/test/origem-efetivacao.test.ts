import assert from "node:assert/strict";
import test from "node:test";
import { origemEfetivacao } from "../src/lib/origem-efetivacao.js";

test("DNA Work formaliza contrato da empresa e Ketly é vaga da DNA", () => {
  assert.equal(origemEfetivacao(90), "empresa");
  assert.equal(origemEfetivacao(153), "dnawork");
  assert.equal(origemEfetivacao(124), "dnawork");
  assert.equal(origemEfetivacao(null), "nao_identificado");
  assert.equal(origemEfetivacao(0), "nao_identificado");
  assert.equal(origemEfetivacao(undefined), "nao_identificado");
});
