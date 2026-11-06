import assert from "node:assert/strict";
import test from "node:test";
import { buildRescisaoMedioPdf, textoRescisaoMedio, type RescisaoMedioDados } from "../src/lib/rescisao-medio-pdf.js";

const dados: RescisaoMedioDados = {
  modelo: "rescisao_medio",
  estagiario_nome: "Maria Eduarda Martins de Almeida",
  estagiario_nascimento: "2010-04-19",
  estagiario_cpf: "428.372.928-00",
  estagiario_rg: "59.722.378-6",
  estagiario_endereco: "Rua Europa, 100, Jardim Santos Dumont II",
  estagiario_cep: "08762-150",
  estagiario_cidade: "Mogi das Cruzes",
  estagiario_estado: "SP",
  estagiario_curso: "",
  estagiario_periodo: "1",
  estagiario_turno: "Tarde",
  estagiario_contato: "(11) 91491-8350, mmartinsdealmeia41@gemal.com",
  tipo_estagio: "nao_obrigatorio",
  responsavel_nome: "José Renato de Almeida Filho",
  responsavel_nascimento: "",
  responsavel_cpf: "318.735.488-26",
  responsavel_rg: "",
  responsavel_endereco: "",
  responsavel_cep: "",
  responsavel_cidade: "",
  responsavel_estado: "",
  responsavel_contato: "(11) 97834-1397, joserenatodealmeidafilho421@gmail.com",
  concedente_razao: "Comércio de Alimentos Alves e Farias LTDA",
  concedente_endereco: "Rua Dolores de Aquino, 1925, Jundiapeba, Mogi das Cruzes, SP, CEP 08750-617",
  concedente_cnpj: "01.444.210/0014-56",
  concedente_email: "pessoal@supermercadosparana.com.br",
  concedente_representante: "Genivan Farias da Silva",
  escola_nome: "E.E. Koheiji Adachi",
  escola_endereco: "Rua Comendador Koheiji Adachi, SN, Jardim Santos Dumont I",
  escola_cidade: "Mogi Das Cruzes",
  escola_estado: "SP",
  escola_cep: "08762-050",
  escola_cnpj: "20.824.582/0001-38",
  escola_email: "e446312a@educacao.sp.gov.br",
  escola_representante: "Eliane dos Santos Bittencourt",
  data_tce: "2026-09-14",
  data_rescisao: "2026-10-22",
  atividades: "Auxiliar, sob supervisão, no atendimento aos clientes.",
  motivo: "Candidato solicitou o desligamento",
  avaliacao: "Bom",
};

test("o termo de rescisão do ensino médio segue as cláusulas do modelo", () => {
  const texto = textoRescisaoMedio(dados).join("\n");
  assert.match(texto, /Comércio de Alimentos Alves e Farias LTDA, sociedade com sede na Rua Dolores de Aquino/);
  assert.match(texto, /CNPJ sob nº 01\.444\.210\/0014-56/);
  assert.match(texto, /\(   \) Obrigatório \( X \) Não Obrigatório/);
  assert.match(texto, /E\.E\. Koheiji Adachi, instituição de ensino/);
  assert.match(texto, /DNA WORK TREINAMENTO E DESENVOLVIMENTO PROFISSIONAL LTDA\./);
  assert.match(texto, /Lei nº 11\.788\/08/);
  assert.match(texto, /em 14\/09\/2026/);
  assert.match(texto, /Art\. 9, V da Lei do Estágio/);
  assert.match(texto, /Período de Estágio: 14\/09\/2026 até 22\/10\/2026/);
  assert.match(texto, /Candidato solicitou o desligamento/);
  assert.match(texto, /Avaliação de desempenho: Bom/);
  assert.match(texto, /foro da cidade de São Paulo/);
  assert.match(texto, /São Paulo, 22\/10\/2026/);
});

test("gera o PDF da rescisão", async () => {
  const pdf = await buildRescisaoMedioPdf(dados);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 2000);
});
