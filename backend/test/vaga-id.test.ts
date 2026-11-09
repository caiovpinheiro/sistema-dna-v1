import assert from "node:assert/strict";
import test from "node:test";
import { assinaturaDaVaga } from "../src/lib/vaga-id.js";

const base = {
  id: "a", vaga_id: "x", empresa_id: "e1", tipo_vaga: 2, cargo: "Operador de caixa", salario: 1800, carga_horaria: "44h",
  sexo: "I", idade: 18, idade_ate: null, km: 30, atividades: "Atender", horario: ";2-7;01:00;2=08:00-17:00", beneficios: "VT",
  cep: "01000000", latitude: -23.5, longitude: -46.6,
};

test("vagas repetidas da mesma empresa com tudo igual têm a mesma assinatura", () => {
  // O Postgres devolve numeric como texto; id, vaga_id e coordenadas não contam.
  const outra = { ...base, id: "b", vaga_id: "y", salario: "1800.00", km: "30.00", latitude: -23.4, cargo: " Operador de caixa " };
  assert.equal(assinaturaDaVaga(outra), assinaturaDaVaga(base));
});

test("empresa diferente ou qualquer detalhe diferente muda a assinatura", () => {
  const original = assinaturaDaVaga(base);
  for (const mudanca of [
    { empresa_id: "e2" }, { salario: 1900 }, { horario: ";2-7;01:00;2=09:00-18:00" }, { beneficios: "VT + VR" },
    { sexo: "F" }, { idade_ate: 30 }, { tipo_vaga: 1 }, { atividades: "Repor" },
  ]) {
    assert.notEqual(assinaturaDaVaga({ ...base, ...mudanca }), original, JSON.stringify(mudanca));
  }
});

test("vazio e nulo valem o mesmo", () => {
  assert.equal(assinaturaDaVaga({ ...base, beneficios: "" }), assinaturaDaVaga({ ...base, beneficios: null }));
});
