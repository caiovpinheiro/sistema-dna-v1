import assert from "node:assert/strict";
import test from "node:test";
import { nomesDistintos } from "../src/repositories/vaga.repository.js";
import { situacaoDaVaga } from "../src/services/presenters.js";

test("situação pela vaga do Lightsail: status 0 é aberta, mesmo sem capacidade", () => {
  assert.equal(situacaoDaVaga({ status: 0, quantidade_posicoes: null, ocupadas: 0 }, 1), "aberta");
  assert.equal(situacaoDaVaga({ status: 0, quantidade_posicoes: 2, ocupadas: 1 }, 1), "aberta");
  assert.equal(situacaoDaVaga({ status: 0, quantidade_posicoes: 1, ocupadas: 1 }, 1), "preenchida");
  assert.equal(situacaoDaVaga({ status: 1, quantidade_posicoes: null, ocupadas: 0 }, 1), "preenchida");
  for (const status of [2, 3, 6, 7, 8, null]) {
    assert.equal(situacaoDaVaga({ status, quantidade_posicoes: 1, ocupadas: 0 }, 1), "encerrada");
  }
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
