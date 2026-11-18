import assert from "node:assert/strict";
import test from "node:test";
import { destinoDeVoltar, empilhar, rotuloDoCaminho } from "../src/lib/voltar";

function navegar(caminhos: string[]) {
  return caminhos.reduce<string[]>((pilha, caminho) => empilhar(pilha, caminho), []);
}

test("da empresa para a vaga, o Voltar leva para a empresa", () => {
  const pilha = navegar(["/empresas?q=ibira", "/empresas/abc", "/vagas/v1"]);
  assert.equal(destinoDeVoltar(pilha, "/vagas/v1"), "/empresas/abc");
  assert.equal(rotuloDoCaminho("/empresas/abc"), "Empresa");
});

test("da consulta de vagas, volta para a consulta com os filtros", () => {
  const pilha = navegar(["/vagas?cargo_chave=operador%20de%20caixa", "/vagas/v1"]);
  assert.equal(destinoDeVoltar(pilha, "/vagas/v1"), "/vagas?cargo_chave=operador%20de%20caixa");
  assert.equal(rotuloDoCaminho("/vagas?x=1"), "Vagas");
});

test("ida e volta não cria laço: Empresa → Vaga → Processo → Vaga volta para a Empresa", () => {
  const pilha = navegar(["/empresas/abc", "/vagas/v1", "/processos/p1", "/vagas/v1"]);
  assert.equal(destinoDeVoltar(pilha, "/vagas/v1"), "/empresas/abc");
});

test("formulário de edição e páginas da própria ficha não são destino", () => {
  const pilha = navegar(["/empresas/abc", "/vagas/v1", "/vagas/v1/editar", "/vagas/v1"]);
  assert.equal(destinoDeVoltar(pilha, "/vagas/v1"), "/empresas/abc");
  const nova = navegar(["/contratacoes", "/contratacoes/nova", "/contratacoes/c1"]);
  assert.equal(destinoDeVoltar(nova, "/contratacoes/c1"), "/contratacoes");
});

test("sem histórico não há destino (a ficha usa o padrão)", () => {
  assert.equal(destinoDeVoltar(navegar(["/vagas/v1"]), "/vagas/v1"), null);
});
