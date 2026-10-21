-- DNAWORK V1 — PROPOSTA. Não executar na base atual sem aprovação.
-- Tabela nova, exclusiva da API. Não altera tabelas legadas.
-- Guarda a resposta de POST /contratacoes para a mesma Idempotency-Key.

-- UP
CREATE TABLE IF NOT EXISTS dna_work.api_idempotencia (
  chave character varying(120) PRIMARY KEY,
  request_hash character varying(128) NOT NULL,
  status_code integer,
  response jsonb,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

-- DOWN
-- DROP TABLE IF EXISTS dna_work.api_idempotencia;
