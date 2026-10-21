-- DNAWORK V1 — PROPOSTA. Não executar na base atual sem aprovação.
-- id_contratacao é integer NOT NULL, sem default e sem sequence.
-- O legado MySQL usava autoincremento; a migração para PostgreSQL não o preservou.
-- Esta sequence é inicializada uma vez com MAX(id). A aplicação usa nextval.
-- Não usar MAX(id) + 1 por requisição.

-- UP
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

-- DOWN
-- ALTER TABLE dna_work.conratacaovaga ALTER COLUMN id_contratacao DROP DEFAULT;
-- DROP SEQUENCE IF EXISTS dna_work.conratacaovaga_id_contratacao_seq;
