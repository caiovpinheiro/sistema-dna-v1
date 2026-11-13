import assert from "node:assert/strict";
import test from "node:test";
import { aberturaContaSchema, buildAberturaContaPdf, dataDaCarta, linhasAberturaConta, valorPorExtenso } from "../src/lib/abertura-conta.js";

test("valor por extenso em reais e centavos", () => {
  assert.equal(valorPorExtenso(850), "oitocentos e cinquenta reais");
  assert.equal(valorPorExtenso(1), "um real");
  assert.equal(valorPorExtenso(100), "cem reais");
  assert.equal(valorPorExtenso(101), "cento e um reais");
  assert.equal(valorPorExtenso(1100), "mil e cem reais");
  assert.equal(valorPorExtenso(1050), "mil e cinquenta reais");
  assert.equal(valorPorExtenso(1518.5), "mil, quinhentos e dezoito reais e cinquenta centavos");
  assert.equal(valorPorExtenso(2000), "dois mil reais");
  assert.equal(valorPorExtenso(0.01), "um centavo");
  assert.equal(valorPorExtenso(1_000_000), "um milhão de reais");
});

test("data da carta por extenso", () => {
  assert.equal(dataDaCarta("2026-10-30"), "30 de outubro de 2026");
  assert.equal(dataDaCarta("2026-03-01"), "1 de março de 2026");
});

test("linhas da carta seguem o modelo em papel", () => {
  const dados = aberturaContaSchema.parse({
    data: "2026-10-30",
    nome: "Pessoa de Teste",
    cpf: "52998224725",
    endereco: "Rua Exemplo, 100, Centro, São Paulo, SP",
    telefone: "11987654321",
    bolsa: 850,
    cnpj: "11222333000181",
    empresa: "Empresa Exemplo (Loja 01)",
  });
  const linhas = linhasAberturaConta(dados);
  assert.equal(linhas.data, "30 de outubro de 2026");
  assert.deepEqual(linhas.pessoa, [
    ["Nome", "PESSOA DE TESTE"],
    ["CPF", "529.982.247-25"],
    ["Endereço", "RUA EXEMPLO, 100, CENTRO, SÃO PAULO, SP"],
    ["Telefone", "(11) 98765-4321"],
    ["Bolsa Auxílio", "R$ 850,00 (Oitocentos e cinquenta reais)"],
  ]);
  assert.deepEqual(linhas.empresa, [["CNPJ", "11.222.333/0001-81"], ["Empresa", "EMPRESA EXEMPLO (LOJA 01)"]]);
});

test("schema exige nome, empresa e bolsa", () => {
  assert.equal(aberturaContaSchema.safeParse({ data: "2026-10-30", nome: "Ab", bolsa: 850, empresa: "X Ltda" }).success, false);
  assert.equal(aberturaContaSchema.safeParse({ data: "2026-10-30", nome: "Pessoa", bolsa: 0, empresa: "X Ltda" }).success, false);
  assert.equal(aberturaContaSchema.safeParse({ data: "2026-10-30", nome: "Pessoa", bolsa: 850, empresa: "" }).success, false);
  assert.equal(aberturaContaSchema.safeParse({ data: "2026-10-30", nome: "Pessoa", bolsa: 850, empresa: "X Ltda" }).success, true);
});

test("gera um PDF", async () => {
  const pdf = await buildAberturaContaPdf(aberturaContaSchema.parse({ data: "2026-10-30", nome: "Pessoa de Teste", bolsa: 850, empresa: "Empresa Exemplo" }));
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
});
