import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { gerarDocumento } from "../src/lib/documento-contrato.js";

const contrato = {
  modelo: "contrato" as const,
  razao_social: "Loja Exemplo Ltda.",
  cnpj: "07.142.160/0004-67",
  endereco: "Rua do Teste, 100, Centro, São Paulo - SP - CEP 01000-000",
  email: "contato@exemplo.com",
  data: "2026-10-22",
  modalidade: "ambas" as const,
  regimes: {
    clt_indeterminado: true,
    clt_determinado: false,
    clt_intermitente: false,
    autonomo: true,
    pj: false,
    outros: true,
    outros_texto: "aprendiz",
  },
  taxa_recrutamento_percentual: "80",
  vencimento_dias: "7",
  garantia: "sim" as const,
  garantia_dias: "30",
  taxa_administrativa: "150,00",
  taxa_recrutamento_estagio: "1.200,50",
  vencimento_diverso: "dia 15",
  conversao_12: "percentual" as const,
  conversao_percentual: "25",
  registro: "Vaga de caixa com taxa reduzida",
  observacoes: "Sem carência",
};

test("preenche o contrato e preserva o modelo em branco do Anexo II", async () => {
  const gerado = await gerarDocumento(contrato);
  assert.equal(gerado.filename, "Contrato - Loja Exemplo Ltda.docx");
  const xml = await texto(gerado.buffer);
  const cabeca = xml.slice(0, xml.indexOf("ANEXO II"));
  assert.equal(cabeca.includes("[=]"), false);
  assert.equal(cabeca.includes("[data]"), false);
  assert.equal(cabeca.includes("[endereço completo]"), false);
  assert.equal(cabeca.includes("Confirmar"), false);
  assert.match(cabeca, /CONTRATANTE: Loja Exemplo Ltda\./);
  assert.match(cabeca, /07\.142\.160\/0004-67/);
  assert.match(cabeca, /contato@exemplo\.com/);
  assert.match(cabeca, /22 de outubro de 2026/);
  assert.match(cabeca, /80% da base de cálculo/);
  assert.match(cabeca, /R\$ 150,00 por Estagiário/);
  assert.match(cabeca, /R\$ 1\.200,50 por Estagiário colocado/);
  assert.match(cabeca, /aprendiz/);
  assert.match(cabeca, /prazo de 30 dias/);
  assert.match(cabeca, /Vencimento: 7 dias/);
  assert.match(cabeca, /dia 15/);
  assert.match(cabeca, /25%/);
  assert.match(cabeca, /Vaga de caixa com taxa reduzida/);
  assert.match(cabeca, /Sem carência/);
  assert.match(xml, /\[razão social\]/);
  assert.equal(xml.includes("HABA"), false);
});

test("gera só o termo de adesão com os dados informados", async () => {
  const gerado = await gerarDocumento({
    modelo: "adesao",
    razao_social: "Aderente Exemplo Ltda.",
    cnpj: "66856408000178",
    endereco: "Rua Nova, 10, São Paulo - SP",
    email: "aderente@exemplo.com",
    contrato_data: "2026-10-22",
    contratante_razao: "Comercial Exemplo Ltda.",
    contratante_cnpj: "07142160000467",
    modalidade: "estagio",
    condicoes: "anexo_contrato",
    responsavel: "Ana Souza",
    cargo: "Gerente de RH",
    email_faturamento: "financeiro@exemplo.com",
    telefone: "11945345181",
    endereco_faturamento: "Rua Nova, 10, São Paulo - SP",
    local: "Osasco",
    data: "2026-10-29",
  });
  const xml = await texto(gerado.buffer);
  assert.equal(xml.includes("HABA"), false);
  assert.equal(xml.includes("MARCIA"), false);
  assert.equal(xml.includes("CAPÍTULO I"), false);
  assert.match(xml, /TERMO DE ADESÃO AO CONTRATO/);
  assert.match(xml, /ADERENTE: Aderente Exemplo Ltda\./);
  assert.match(xml, /66\.856\.408\/0001-78/);
  assert.match(xml, /Comercial Exemplo Ltda\./);
  assert.match(xml, /07\.142\.160\/0004-67/);
  assert.match(xml, /em 22 de outubro de 2026/);
  assert.match(xml, /\( X \) Modalidade Estágio/);
  assert.match(xml, /Ana Souza/);
  assert.match(xml, /Gerente de RH/);
  assert.match(xml, /\(11\) 94534-5181/);
  assert.match(xml, /Osasco, 29 de outubro de 2026/);
});

async function texto(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
