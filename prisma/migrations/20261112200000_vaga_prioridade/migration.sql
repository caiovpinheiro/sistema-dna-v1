-- Prioridade de cada vaga: alta, media ou baixa. Só no Postgres (o Lightsail não tem esta coluna).
-- O padrão 'media' preenche as vagas que já existem e as que entrarem depois.
ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS prioridade varchar(5) NOT NULL DEFAULT 'media'
    CONSTRAINT vaga_prioridade_valida CHECK (prioridade IN ('alta', 'media', 'baixa'));
