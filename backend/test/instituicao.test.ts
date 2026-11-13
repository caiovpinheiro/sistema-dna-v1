import assert from "node:assert/strict";
import test from "node:test";
import { paginasDaApi } from "../src/lib/paginas.js";
import { montarGravacao, valorDoCampo } from "../src/services/instituicao.service.js";

test("nova instituição: grava só nas colunas que existem e devolve o que ficou sem coluna", () => {
  const colunas = new Set(["id_instiduicao", "razao_social", "nome_fantasia", "cnpj", "tipo_encino", "email", "telefone", "cep", "logradouro", "cidade", "uf", "representante_legal", "responsavel"]);
  const { valores, ignorados } = montarGravacao({
    tipo_ensino: "Ensino Médio",
    razao_social: "Escola Freire &amp; Pinho",
    cnpj_inep: "12.345.678/0001-90",
    telefone: "(11) 3333-4444",
    cep: "03981-060",
    logradouro: "Rua Serra do Navio",
    uf: "sp",
    diretor: "Ana Diretora",
    mantenedora: "Fundação X",
    latitude: "",
  }, colunas);
  assert.equal(valores.get("tipo_encino"), "Ensino Médio");
  assert.equal(valores.get("razao_social"), "Escola Freire & Pinho");
  assert.equal(valores.get("cnpj"), "12.345.678/0001-90");
  assert.equal(valores.get("telefone"), "1133334444");
  assert.equal(valores.get("cep"), "03981060");
  assert.equal(valores.get("uf"), "SP");
  assert.equal(valores.get("responsavel"), "Ana Diretora");
  assert.deepEqual(ignorados, ["mantenedora"]);
  assert.equal(valores.has("latitude"), false);
});

test("valores vazios não entram e nomes perdem entidades HTML", () => {
  assert.equal(valorDoCampo("nome_fantasia", "  "), "");
  assert.equal(valorDoCampo("nome_fantasia", "A &quot;B&quot;"), "A \"B\"");
  assert.equal(valorDoCampo("diretor_cpf", "123.456.789-09"), "12345678909");
});

test("gravar instituição exige a página de cadastro; listar aceita as duas", () => {
  assert.deepEqual(paginasDaApi("/api/v1/instituicoes/nova"), ["instituicoes-nova"]);
  assert.deepEqual(paginasDaApi("/api/v1/instituicoes"), ["instituicoes", "instituicoes-nova"]);
});
