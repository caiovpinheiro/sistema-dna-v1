import assert from "node:assert/strict";
import test from "node:test";
import { cargosDistintos, nomesDistintos } from "../src/repositories/vaga.repository.js";
import { codigoParaStatus, statusDaVaga } from "../src/lib/vaga-status.js";
import { posicoesLivres } from "../src/services/presenters.js";

test("vaga aberta sem quantidade vale uma posição livre", () => {
  assert.equal(posicoesLivres(null, 0), 1);
  assert.equal(posicoesLivres(null, 1), 0);
  assert.equal(posicoesLivres(3, 1), 2);
});

test("código do Lightsail vira um dos quatro status", () => {
  for (const codigo of [0, 3, 4, 5, 9]) assert.equal(statusDaVaga(codigo), "aberta");
  assert.equal(statusDaVaga(8), "pausada");
  assert.equal(statusDaVaga(1), "contratada");
  for (const codigo of [2, 6, 7, null, 42]) assert.equal(statusDaVaga(codigo), "fechada");
});

test("edição grava o código antigo e mantém o atual se o status não mudou", () => {
  assert.equal(codigoParaStatus("aberta", 9), 9);
  assert.equal(codigoParaStatus("aberta", 6), 0);
  assert.equal(codigoParaStatus("pausada", 0), 8);
  assert.equal(codigoParaStatus("contratada", 3), 1);
  assert.equal(codigoParaStatus("fechada", 7), 7);
  assert.equal(codigoParaStatus("fechada", 0), 6);
  assert.equal(codigoParaStatus("aberta"), 0);
});

test("cada unidade da empresa sai com nome próprio", () => {
  const linha = (id: string, nome: string | null, fantasia: string, bairro: string | null) => ({ id, nome, fantasia, razao: null, bairro, grupo_id: null, grupo: null });
  const nomes = nomesDistintos([
    linha("aaaa1", "Paraná Supermercados - Jardim Itacolomi", "Paraná Supermercados", "Parque Santa Teresa"),
    linha("bbbb2", "Paraná Supermercados - Baronesa", "Paraná Supermercados", "São João"),
    linha("cccc3", null, "Lumi Cosmeticos", "Centro"),
    linha("dddd4", null, "Lumi Cosmeticos", "Guaianazes"),
    linha("eeee5", null, "Bengala", "Centro"),
    linha("ffff6", null, "Bengala", "Centro"),
  ]).map((item) => item.nome);
  assert.deepEqual(nomes, [
    "Bengala - Centro (eeee)",
    "Bengala - Centro (ffff)",
    "Lumi Cosmeticos - Centro",
    "Lumi Cosmeticos - Guaianazes",
    "Paraná Supermercados - Baronesa",
    "Paraná Supermercados - Jardim Itacolomi",
  ]);
});

test("cargos já abertos juntam as grafias diferentes", () => {
  const cargos = cargosDistintos(["Operador De Loja", "Operador de Loja", "operador de loja ", "Açougueiro:", "  "]);
  assert.deepEqual(cargos.map((item) => [item.nome, item.variantes.length]), [["Açougueiro", 1], ["Operador de Loja", 3]]);
});
