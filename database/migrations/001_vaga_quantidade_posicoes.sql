-- DNAWORK V1 — PROPOSTA. Não executar na base atual sem aprovação.
-- Adiciona a capacidade da vaga sem preencher valores e sem recriar a tabela.
-- Registros existentes ficam com NULL. Contratação nova exige quantidade informada.

-- UP
ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS quantidade_posicoes integer;

ALTER TABLE dna_work.vaga
  DROP CONSTRAINT IF EXISTS vaga_quantidade_posicoes_check;

ALTER TABLE dna_work.vaga
  ADD CONSTRAINT vaga_quantidade_posicoes_check
  CHECK (quantidade_posicoes IS NULL OR quantidade_posicoes > 0);

-- DOWN
-- ALTER TABLE dna_work.vaga DROP CONSTRAINT IF EXISTS vaga_quantidade_posicoes_check;
-- ALTER TABLE dna_work.vaga DROP COLUMN IF EXISTS quantidade_posicoes;
