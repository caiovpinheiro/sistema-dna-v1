import assert from "node:assert/strict";
import test from "node:test";
import { preenchimentoDoCandidato, vagaParaTce } from "../src/lib/tce-candidato.js";

test("preenche o TCE com o candidato, a escola e a contratação que já existem", () => {
  const preenchido = preenchimentoDoCandidato(
    {
      nome: "Maria Eduarda Martins de Almeida",
      datanascimento: "2010/04/19",
      cpf: "428.372.928-00",
      rg: "59.722.378-6",
      email: "mmartinsdealmeia41@gemal.com",
      celular: "(11) 91491-8350",
      logradouro: "Rua Europa",
      numero: "100",
      bairro: "Jardim Santos Dumont II",
      cep: "08762-150",
      cidade: "Mogi das Cruzes",
      estado: "SP",
      curso: "",
      semestre: "",
      ano_escolar: "1",
      periodo: "Tarde",
      nome_responsavel: "",
      nomepai: "José Renato de Almeida Filho",
      cpf_responsavel: "318.735.488-26",
      email_responsavel: "joserenatodealmeidafilho421@gmail.com",
      celular_responsavel: "(11) 97834-1397",
      escola: "escola-1",
      id_empresa: "",
    },
    {
      nome_escola: "E.E. Koheiji Adachi",
      escola_cnpj_inep: "20.824.582/0001-38",
      escola_email: "e446312a@educacao.sp.gov.br",
      escola_representante: "Eliane dos Santos Bittencourt",
    },
    {
      id_empresa: "empresa-1",
      razao_social: "Comércio de Alimentos Alves e Farias LTDA",
      nome_fantasia: "Paraná Supermercados",
      cnpj: "01.444.210/0014-56",
      emp_email: "pessoal@supermercadosparana.com.br",
      responsavel: "Genivan Farias da Silva",
      emp_logradouro: "Rua Dolores de Aquino",
      emp_numero: "1925",
      emp_cidade: "Mogi das Cruzes",
      emp_uf: "SP",
      emp_cep: "08750-617",
      salario: "1100,00",
      carga_horaria: "30",
      texto_carga: "Segunda a sexta, 14:00 às 18:00",
      atribuicaoes: "Auxiliar no atendimento<br>Apoiar a reposição",
      datainicio: "2026/09/14",
      datafim: "2026/10/22",
    },
  );

  assert.equal(preenchido.campos.nome, "Maria Eduarda Martins de Almeida");
  assert.equal(preenchido.campos.data_nascimento, "2010-04-19");
  assert.equal(preenchido.campos.endereco, "Rua Europa, 100, Jardim Santos Dumont II");
  assert.equal(preenchido.campos.ano, "1");
  assert.equal(preenchido.campos.turno, "Tarde");
  assert.equal(preenchido.campos.nome_responsavel, "José Renato de Almeida Filho");
  assert.equal(preenchido.campos.nome_escola, "E.E. Koheiji Adachi");
  assert.equal(preenchido.campos.estagio_inicio, "2026-09-14");
  assert.equal(preenchido.campos.bolsa, "R$ 1.100,00");
  assert.equal(preenchido.campos.carga_horaria_diaria, "6 horas");
  assert.equal(preenchido.campos.carga_horaria_semanal, "30 horas");
  assert.equal(preenchido.campos.plano_atividades, "Auxiliar no atendimento\nApoiar a reposição");
  assert.equal(preenchido.concedente?.razao_social, "Comércio de Alimentos Alves e Farias LTDA");
  assert.equal(preenchido.concedente?.representante, "Genivan Farias da Silva");
  assert.equal(preenchido.empresaId, "empresa-1");
  assert.equal(preenchido.escolaId, "escola-1");
});

test("término do estágio segue o v0: fim da contratação, limitado ao fim dos estudos e a 2 anos", async () => {
  const { terminoDoEstagio } = await import("../src/lib/tce-candidato.js");
  // sem data de fim na contratação: usa o término dos estudos (ensino médio)
  assert.equal(terminoDoEstagio("2026-11-11", "", "2027-12-20"), "2027-12-20");
  // contratação com fim depois do término dos estudos: corta no término dos estudos
  assert.equal(terminoDoEstagio("2026-11-11", "2028-06-30", "2027-12-20"), "2027-12-20");
  // fim da contratação antes do término dos estudos: mantém
  assert.equal(terminoDoEstagio("2026-11-11", "2027-05-10", "2027-12-20"), "2027-05-10");
  // nunca mais que 2 anos
  assert.equal(terminoDoEstagio("2026-11-11", "", "2030-12-20"), "2028-11-10");
  // sem nenhuma informação
  assert.equal(terminoDoEstagio("2026-11-11", "", ""), "2028-11-10");
  assert.equal(terminoDoEstagio("", "", ""), "");
});

test("preenchimento sem contratação usa o término dos estudos do candidato", () => {
  const preenchido = preenchimentoDoCandidato({ nome: "Fernando", terminoestudo: "2027/12/20", escola: "10" }, { nome_escola: "E.E. Teste" }, null);
  assert.equal(preenchido.campos.estagio_termino, "2027-12-20");
  assert.equal(preenchido.terminoEstudo, "2027-12-20");
  assert.equal(preenchido.campos.nome_escola, "E.E. Teste");
  assert.equal(preenchido.idContratacao, null);
});

test("vaga de estágio preenche jornada, bolsa, benefícios e plano de atividades, sem campos vazios", () => {
  const vaga = vagaParaTce({
    id: "v1", empresa_id: "emp-uuid", cargo: "Estagiário administrativo", salario: "1200", beneficios: "Vale-transporte",
    horario: "texto=Segunda a sexta, das 13h às 19h", jornada: "outra", atividades: "Arquivar documentos<br>Atender telefone",
    razao_social: "Escritório Lima ME", nome_fantasia: "Contábil Lima", local: "Mooca - São Paulo / SP",
  });
  assert.equal(vaga.empresa, "Contábil Lima");
  assert.equal(vaga.empresaId, "emp-uuid");
  assert.equal(vaga.local, "Mooca, São Paulo SP");
  assert.deepEqual(vaga.campos, {
    jornada: "Segunda a sexta, das 13h às 19h",
    bolsa: "R$ 1.200,00",
    beneficios: "Vale-transporte",
    plano_atividades: "Arquivar documentos\nAtender telefone",
  });
  const semDados = vagaParaTce({ id: "v2", empresa_id: null, cargo: null, salario: "0", beneficios: null, horario: null, jornada: "Seg a sex", atividades: null, razao_social: null, nome_fantasia: null, local: null });
  assert.deepEqual(semDados.campos, { jornada: "Seg a sex" });
  assert.equal(semDados.cargo, "Vaga de estágio");
});
