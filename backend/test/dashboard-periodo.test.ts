import assert from "node:assert/strict";
import test from "node:test";
import { intervaloDe, VAGA_ABERTA } from "../src/lib/dashboard-periodo.js";

test("intervalo de 30 dias termina no dia seguinte ao corrente", () => {
  const intervalo = intervaloDe({ dias: 30 }, new Date("2026-10-24T15:00:00Z"));
  assert.equal(intervalo.inicio, "2026-09-25");
  assert.equal(intervalo.fim, "2026-10-25");
  assert.equal(intervalo.dias, 30);
  assert.equal(intervalo.anteriorInicio, "2026-08-26");
  assert.equal(intervalo.anteriorFim, "2026-09-25");
});

test("intervalo personalizado é inclusivo e rejeita ordem invertida", () => {
  const intervalo = intervaloDe({ de: "2026-10-01", ate: "2026-10-03" });
  assert.equal(intervalo.inicio, "2026-10-01");
  assert.equal(intervalo.fim, "2026-10-04");
  assert.equal(intervalo.dias, 3);
  assert.throws(() => intervaloDe({ de: "2026-10-03", ate: "2026-10-01" }));
  assert.throws(() => intervaloDe({ de: "2026-02-31", ate: "2026-03-01" }));
});

test("vaga aberta no legado é somente o status zero", () => {
  assert.equal(VAGA_ABERTA, 0);
});
