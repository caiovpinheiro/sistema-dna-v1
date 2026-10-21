-- Schema LOCAL compatível com dna_work.
-- Usado apenas por PostgreSQL vazio de desenvolvimento e pela suíte de testes.
-- Não executar na base atual. Não apaga tabelas existentes: só cria se não existirem.

CREATE SCHEMA IF NOT EXISTS dna_work;

CREATE TABLE IF NOT EXISTS dna_work.modalidade_vaga (
  id integer PRIMARY KEY,
  descricao character varying,
  descricaomenu character varying,
  estudando integer,
  temporario integer,
  formulario integer
);

INSERT INTO dna_work.modalidade_vaga (id, descricao, descricaomenu, estudando, temporario, formulario)
VALUES
  (1, 'Estágio', 'Cadastrar Estágio', 1, 0, 0),
  (2, 'CLT', 'Cadastrar CLT', 0, 0, 1),
  (4, 'Pessoa Juridica', 'Pessoa Juridica', 0, 1, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dna_work.empresa (
  id_empresa character varying PRIMARY KEY,
  razao_social character varying,
  nome_fantasia character varying,
  cnpj character varying,
  email character varying,
  telefone character varying,
  celular character varying,
  cep character varying,
  logradouro character varying,
  numero character varying,
  complemento character varying,
  bairro character varying,
  cidade character varying,
  uf character varying,
  status integer,
  responsavel character varying,
  tipo_empresa integer,
  matriz character varying,
  ie character varying,
  site character varying,
  obs text,
  data_adicao timestamp without time zone
);

CREATE TABLE IF NOT EXISTS dna_work.candidato (
  id_candidato character varying PRIMARY KEY,
  nome character varying,
  cpf character varying,
  rg character varying,
  rg_expedidor character varying,
  datanascimento character varying,
  datacadastro character varying,
  ultimaalteracao character varying,
  telefonefixo character varying,
  celular character varying,
  email character varying,
  logradouro character varying,
  numero character varying,
  complemento character varying,
  bairro character varying,
  cidade character varying,
  estado character varying,
  cep character varying,
  escola character varying,
  nome_escola character varying,
  modalidadecurso character varying,
  curso character varying,
  periodo character varying,
  semestre character varying,
  ctps character varying,
  sexo character,
  estadocivil character varying,
  obs text,
  id_empresa character varying,
  colaborador integer,
  contador integer,
  banco character varying,
  agencia character varying,
  numero_conta character varying,
  nome_conta character varying,
  tipo_chave_pix character varying,
  chave_pix character varying,
  pcd character varying
);

CREATE INDEX IF NOT EXISTS candidato__cpf ON dna_work.candidato USING btree (cpf);

CREATE TABLE IF NOT EXISTS dna_work.vaga (
  id_vaga character varying PRIMARY KEY,
  id_empresa character varying,
  cargo character varying,
  tipo_vaga integer,
  salario character varying,
  status integer,
  comparador character varying,
  dataabertura character varying,
  publicar integer,
  carga_horaria character varying,
  obs text,
  quantidade_posicoes integer,
  data_adicao timestamp without time zone,
  CONSTRAINT vaga_quantidade_posicoes_check CHECK (quantidade_posicoes IS NULL OR quantidade_posicoes > 0)
);

CREATE INDEX IF NOT EXISTS vaga__id_empresa ON dna_work.vaga USING btree (id_empresa);

CREATE TABLE IF NOT EXISTS dna_work.conratacaovaga (
  id_contratacao integer PRIMARY KEY,
  id_vaga character varying,
  id_candidato character varying,
  data_contratacao character varying,
  data_demicao character varying,
  status integer,
  contador integer,
  id_empresa character varying,
  comparador character varying,
  datainicio character varying,
  datafim character varying,
  ferias integer,
  id_supervisor integer,
  id_responsavel_agente integer
);

CREATE SEQUENCE IF NOT EXISTS dna_work.conratacaovaga_id_contratacao_seq AS integer;
SELECT setval(
  'dna_work.conratacaovaga_id_contratacao_seq',
  COALESCE((SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga), 1),
  (SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga) IS NOT NULL
);
ALTER TABLE dna_work.conratacaovaga
  ALTER COLUMN id_contratacao SET DEFAULT nextval('dna_work.conratacaovaga_id_contratacao_seq');
ALTER SEQUENCE dna_work.conratacaovaga_id_contratacao_seq OWNED BY dna_work.conratacaovaga.id_contratacao;

CREATE INDEX IF NOT EXISTS conratacaovaga__id_vaga ON dna_work.conratacaovaga USING btree (id_vaga);
CREATE INDEX IF NOT EXISTS conratacaovaga__id_candidato ON dna_work.conratacaovaga USING btree (id_candidato);
CREATE INDEX IF NOT EXISTS conratacaovaga__status ON dna_work.conratacaovaga USING btree (status);

CREATE TABLE IF NOT EXISTS dna_work.colaborador (
  id_colaborador character varying,
  id_candidato character varying,
  id_empresa character varying,
  data_inicio character varying,
  departamento character varying,
  cargo character varying,
  tipo_vaga integer,
  salario character varying,
  carga_horaria character varying,
  data_cadastro character varying,
  status_colaborador integer,
  supervisor character varying,
  id_contratacao integer
);

CREATE INDEX IF NOT EXISTS colaborador__id_colaborador ON dna_work.colaborador USING btree (id_colaborador);
CREATE INDEX IF NOT EXISTS colaborador__id_contratacao ON dna_work.colaborador USING btree (id_contratacao);

CREATE TABLE IF NOT EXISTS dna_work.app_usuario (
  id uuid PRIMARY KEY,
  nome character varying(160) NOT NULL,
  email character varying(160) NOT NULL UNIQUE,
  senha_hash character varying(255) NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_work.api_idempotencia (
  chave character varying(120) PRIMARY KEY,
  request_hash character varying(128) NOT NULL,
  status_code integer,
  response jsonb,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);
