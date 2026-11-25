import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Pool } from "pg";
import type { AppConfig } from "../src/config.js";
import { TceService } from "../src/services/tce.service.js";
import type { TermoService } from "../src/services/termo.service.js";

const payload = {
  campos: { nome: "Maria Teste", nome_escola: "E.E. Prof. Francisco De Paula Conceicao Junior", plano_atividades: "Atender clientes", emissao_cidade_data: "São Paulo, 1 de dezembro de 2026" },
  empresa: { razao_social: "Mercado Teste Ltda", cnpj: "11222333000181", endereco: "", cep: "", cidade: "", estado: "", email: "", representante: "" },
};

function servico(pasta: string) {
  const linhas = [
    { id: "a", status: "gerado", nome: "Maria Teste", payload, pdf_path: "a.pdf" },
    { id: "b", status: "gerado", nome: "Sem Dados", payload: null, pdf_path: "b.pdf" },
    { id: "c", status: "enviado", nome: "João Enviado", payload, pdf_path: "c.pdf" },
  ];
  const db = { query: async () => ({ rows: linhas }) } as unknown as Pool;
  return new TceService(db, { PDF_STORAGE_DIR: pasta } as AppConfig, {} as TermoService);
}

test("corrigir PDFs antigos: conta sem gravar e depois refaz só os ainda não enviados", async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "tce-refazer-"));
  for (const nome of ["a.pdf", "c.pdf"]) fs.writeFileSync(path.join(pasta, nome), "antigo");

  const contagem = await servico(pasta).refazerPdfs(false);
  assert.equal(contagem.gerados, 2);
  assert.equal(contagem.refeitos, 0);
  assert.deepEqual(contagem.enviados, [{ id: "c", nome: "João Enviado" }]);
  assert.equal(fs.readFileSync(path.join(pasta, "a.pdf"), "utf8"), "antigo");

  const feito = await servico(pasta).refazerPdfs(true);
  assert.equal(feito.refeitos, 1);
  assert.deepEqual(feito.falhas.map((item) => item.id), ["b"]);
  assert.equal(fs.readFileSync(path.join(pasta, "a.pdf")).subarray(0, 5).toString(), "%PDF-");
  assert.equal(fs.readFileSync(path.join(pasta, "c.pdf"), "utf8"), "antigo", "o enviado não muda");
});
