import assert from "node:assert/strict";
import test from "node:test";
import { contratosFaltantes, type ContratoAntigo } from "../src/lib/contrato-faltante.js";

const antigo = (extra: Partial<ContratoAntigo>): ContratoAntigo => ({
  id: 1, nome: "Termo de compromisso de estágio", data: "2026/02/23", status: "1", devolvido: "0",
  tipo: "Candidato", devolucao: "1", texto: "<p>Texto</p>", ...extra,
});

test("contrato da entrada não devolvido aparece como faltante", () => {
  const lista = contratosFaltantes([antigo({ devolvido: null }), antigo({ id: 2, devolvido: "0" })], []);
  assert.deepEqual(lista.map((item) => item.id), ["1", "2"]);
  assert.equal(lista[0]!.origem, "historico");
  assert.equal(lista[0]!.texto, "<p>Texto</p>");
});

test("devolvido, errado, sem devolução ou de outro tipo não falta", () => {
  const lista = contratosFaltantes([
    antigo({ devolvido: "1" }),
    antigo({ status: "3" }),
    antigo({ devolucao: "0" }),
    antigo({ tipo: "Empresa" }),
  ], []);
  assert.deepEqual(lista, []);
});

test("TCE novo falta enquanto não estiver assinado nem cancelado", () => {
  const lista = contratosFaltantes([], [
    { id: "a", nome: "TCE - Fulana", status: "gerado", criado_em: "2026-11-01" },
    { id: "b", nome: "TCE - Fulana", status: "enviado", criado_em: "2026-11-02" },
    { id: "c", nome: "TCE - Fulana", status: "assinado", criado_em: "2026-11-03" },
    { id: "d", nome: null, status: "cancelado", criado_em: "2026-11-04" },
  ]);
  assert.deepEqual(lista.map((item) => [item.id, item.origem, item.situacao]), [
    ["a", "termo", "Ainda não enviado para assinatura"],
    ["b", "termo", "Enviado, aguardando assinatura"],
  ]);
});
