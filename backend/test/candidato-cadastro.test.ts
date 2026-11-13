import assert from "node:assert/strict";
import test from "node:test";
import { candidatoCreateSchema } from "../src/schemas/candidato.js";

test("cadastro de candidato aceita só nome e CPF (e-mail opcional), com empresa da contratação", () => {
  const ok = candidatoCreateSchema.safeParse({ nome: "Maria Souza", cpf: "529.982.247-25", id_empresa: "emp-1" });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.email, undefined);
  const comEmail = candidatoCreateSchema.safeParse({ nome: "Maria Souza", cpf: "52998224725", email: "Maria@Email.com" });
  assert.equal(comEmail.success && comEmail.data.email, "maria@email.com");
});

test("mensagens de erro do cadastro em português", () => {
  const erro = candidatoCreateSchema.safeParse({ nome: "Ma", cpf: "111", email: "x", estado: "São Paulo" });
  assert.equal(erro.success, false);
  const mensagens = erro.success ? [] : erro.error.issues.map((issue) => issue.message);
  assert.ok(mensagens.includes("Informe o nome completo (pelo menos 3 letras)."));
  assert.ok(mensagens.includes("CPF inválido."));
  assert.ok(mensagens.includes("E-mail inválido."));
  assert.ok(mensagens.includes("A UF tem 2 letras (ex.: SP)."));
});
