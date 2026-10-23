CREATE TABLE IF NOT EXISTS dna_work.fatura_regua (
  id uuid PRIMARY KEY,
  id_cobranca uuid NOT NULL UNIQUE REFERENCES dna_work.cobranca_asaas(id),
  id_empresa character varying NOT NULL,
  competencia date NOT NULL,
  vencimento date NOT NULL,
  valor numeric(12,2) NOT NULL,
  email_cobranca character varying,
  contato character varying,
  link_cobranca character varying,
  link_central character varying NOT NULL,
  status_pagamento character varying(20) NOT NULL DEFAULT 'em_aberto',
  comprovante boolean NOT NULL DEFAULT false,
  data_baixa date,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fatura_regua_competencia ON dna_work.fatura_regua (competencia);

CREATE TABLE IF NOT EXISTS dna_work.fatura_envio (
  id uuid PRIMARY KEY,
  id_fatura uuid NOT NULL REFERENCES dna_work.fatura_regua(id),
  etapa character varying(30) NOT NULL,
  ordem integer NOT NULL,
  data_prevista date NOT NULL,
  status character varying(20) NOT NULL DEFAULT 'a_enviar',
  enviado_em timestamp with time zone,
  responsavel character varying,
  UNIQUE (id_fatura, etapa)
);
