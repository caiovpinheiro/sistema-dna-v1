import assert from "node:assert/strict";
import test from "node:test";
import { empresaCadastroSchema, grupoCreateSchema, vagaCadastroSchema } from "../src/schemas/cadastro.js";

const mensagens = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) => r.error?.issues.map((issue) => issue.message) ?? [];

test("grupo: nome sempre obrigatório e basta e-mail ou telefone", () => {
  assert.equal(grupoCreateSchema.safeParse({ nome: "Grupo Teste", telefone: "11987654321" }).success, true);
  assert.equal(grupoCreateSchema.safeParse({ nome: "Grupo Teste", email: "a@b.com" }).success, true);
  assert.ok(mensagens(grupoCreateSchema.safeParse({ nome: "Grupo Teste" })).includes("Informe e-mail ou telefone."));
  assert.ok(mensagens(grupoCreateSchema.safeParse({ nome: "", telefone: "11987654321" })).includes("Informe o nome do grupo."));
});

const empresa = {
  grupo_id: "33333333-3333-3333-3333-333333333333", cnpj: "11.222.333/0001-81", razao_social: "Empresa Teste Ltda", nome_fantasia: "Empresa Teste",
  cep: "01310-100", logradouro: "Avenida Paulista", numero: "1000", bairro: "Bela Vista", cidade: "São Paulo", uf: "SP",
  email: "contato@teste.com", telefone: "11987654321",
};

test("empresa: número e complemento opcionais e basta e-mail ou telefone", () => {
  const { numero: _numero, email: _email, telefone: _telefone, ...semContato } = empresa;
  assert.equal(empresaCadastroSchema.safeParse(empresa).success, true);
  assert.equal(empresaCadastroSchema.safeParse({ ...semContato, numero: _numero, email: "contato@teste.com" }).success, true);
  assert.equal(empresaCadastroSchema.safeParse({ ...semContato, telefone: "11987654321" }).success, true);
  assert.ok(mensagens(empresaCadastroSchema.safeParse(semContato)).includes("Informe e-mail ou telefone."));
});

test("vaga: idade até obrigatória", () => {
  const vaga = {
    empresa_id: "33333333-3333-3333-3333-333333333333", tipo: "clt", carga_horaria: "44", salario: "1800,00", cargo_id: "11111111-1111-1111-1111-111111111111",
    horario_entrada: "08:00", horario_saida: "17:00", sexo: "I", idade: 18, atividades: "Atender clientes", quantidade: 1,
  };
  assert.ok(mensagens(vagaCadastroSchema.safeParse(vaga)).includes("Informe a idade até."));
  assert.equal(vagaCadastroSchema.safeParse({ ...vaga, idade_ate: 40 }).success, true);
});
