import assert from "node:assert/strict";
import test from "node:test";
import { diasDoTexto, diasPorEscala, textoDoHorario, type DiaDoHorario } from "../src/lib/horario-escala.js";

const fixo = (entrada: string, saida: string): DiaDoHorario => ({ modo: "fixo", entrada, saida });
const escala = (entrada: string, saida: string): DiaDoHorario => ({ modo: "escala", entrada, saida });
const folga: DiaDoHorario = { modo: "folga", entrada: "", saida: "" };

test("junta dias fixos e marca os de escala", () => {
  const dias = [...Array(5).fill(fixo("08:00", "17:00")), escala("08:00", "14:00"), escala("08:00", "14:00")];
  assert.equal(textoDoHorario(dias), "Segunda a sexta, 08:00 às 17:00; sábado e domingo por escala, 08:00 às 14:00");
});

test("folga e dia sem horário ficam fora do texto", () => {
  const dias = [fixo("08:00", "17:00"), folga, fixo("08:00", "17:00"), fixo("08:00", "17:00"), fixo("08:00", "17:00"), escala("09:00", "13:00"), fixo("", "")];
  assert.equal(textoDoHorario(dias), "Segunda, 08:00 às 17:00; quarta a sexta, 08:00 às 17:00; sábado por escala, 09:00 às 13:00");
});

test("escala em todos os dias", () => {
  assert.equal(textoDoHorario(Array(7).fill(escala("14:00", "22:20"))), "Segunda a domingo por escala, 14:00 às 22:20");
});

test("lê de volta os dias de escala do texto gerado", () => {
  assert.deepEqual([...diasPorEscala("Segunda a sexta, 08:00 às 17:00; sábado e domingo por escala, 08:00 às 14:00")], [5, 6]);
  assert.deepEqual([...diasPorEscala("Segunda a quarta por escala, 07:00 às 15:00")], [0, 1, 2]);
  assert.deepEqual([...diasPorEscala("Segunda a sexta, 08:00 às 17:00")], []);
});

test("lê de volta o texto gerado, com folga nos dias que não aparecem", () => {
  const dias = [fixo("08:00", "17:00"), folga, fixo("08:00", "17:00"), fixo("08:00", "17:00"), fixo("08:00", "17:00"), escala("09:00", "13:00"), folga];
  assert.deepEqual(diasDoTexto(textoDoHorario(dias)), dias);
  assert.equal(diasDoTexto("08:00 às 17:00"), null);
  assert.equal(diasDoTexto("manha;08:00-12:00;00:00;2=08:00-12:00"), null);
});
