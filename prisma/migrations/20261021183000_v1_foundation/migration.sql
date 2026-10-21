-- DNAWORK V1. Somente adições. Não apaga dados nem recria tabelas.

ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS quantidade_posicoes integer;

ALTER TABLE dna_work.vaga
  DROP CONSTRAINT IF EXISTS vaga_quantidade_posicoes_check;

ALTER TABLE dna_work.vaga
  ADD CONSTRAINT vaga_quantidade_posicoes_check
  CHECK (quantidade_posicoes IS NULL OR quantidade_posicoes > 0);

CREATE SEQUENCE IF NOT EXISTS dna_work.conratacaovaga_id_contratacao_seq AS integer;

SELECT setval(
  'dna_work.conratacaovaga_id_contratacao_seq',
  COALESCE((SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga), 1),
  (SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga) IS NOT NULL
);

ALTER TABLE dna_work.conratacaovaga
  ALTER COLUMN id_contratacao SET DEFAULT nextval('dna_work.conratacaovaga_id_contratacao_seq');

ALTER SEQUENCE dna_work.conratacaovaga_id_contratacao_seq
  OWNED BY dna_work.conratacaovaga.id_contratacao;

ALTER TABLE dna_work.colaborador
  ADD COLUMN IF NOT EXISTS id_contratacao integer;

CREATE INDEX IF NOT EXISTS colaborador__id_contratacao
  ON dna_work.colaborador USING btree (id_contratacao);

CREATE TABLE IF NOT EXISTS dna_work.api_idempotencia (
  chave character varying(120) PRIMARY KEY,
  request_hash character varying(128) NOT NULL,
  status_code integer,
  response jsonb,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);
