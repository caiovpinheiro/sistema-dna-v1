-- DNAWORK V1 — PROPOSTA. Não executar na base atual sem aprovação.
-- A tabela colaborador não tem chave primária nem referência à contratação.
-- 320 de 325 contratos ativos não tinham par candidato+empresa em colaborador.
-- A coluna nova é nullable e não reescreve o histórico antigo.

-- UP
ALTER TABLE dna_work.colaborador
  ADD COLUMN IF NOT EXISTS id_contratacao integer;

CREATE INDEX IF NOT EXISTS colaborador__id_contratacao
  ON dna_work.colaborador USING btree (id_contratacao);

-- DOWN
-- DROP INDEX IF EXISTS dna_work.colaborador__id_contratacao;
-- ALTER TABLE dna_work.colaborador DROP COLUMN IF EXISTS id_contratacao;
