ALTER TABLE dna_work.empresa ADD COLUMN IF NOT EXISTS id_asaas character varying;
ALTER TABLE dna_work.empresa ADD COLUMN IF NOT EXISTS usa_asaas integer;

CREATE TABLE IF NOT EXISTS dna_work.cobranca_asaas (
  id uuid PRIMARY KEY,
  id_empresa character varying NOT NULL,
  asaas_payment_id character varying(64),
  asaas_customer_id character varying(64),
  descricao character varying(200) NOT NULL,
  valor numeric(12,2) NOT NULL,
  valor_liquido numeric(12,2),
  vencimento date NOT NULL,
  forma character varying(40) NOT NULL,
  status character varying(40) NOT NULL DEFAULT 'PENDING',
  situacao character varying(20) NOT NULL DEFAULT 'aberta',
  url_pagamento character varying,
  invoice_number character varying(40),
  data_pagamento date,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_asaas_empresa ON dna_work.cobranca_asaas (id_empresa);
CREATE INDEX IF NOT EXISTS cobranca_asaas_payment ON dna_work.cobranca_asaas (asaas_payment_id);

CREATE TABLE IF NOT EXISTS dna_work.nota_asaas (
  id uuid PRIMARY KEY,
  id_cobranca uuid NOT NULL REFERENCES dna_work.cobranca_asaas(id),
  asaas_invoice_id character varying(64),
  tipo character varying(40) NOT NULL,
  valor numeric(12,2) NOT NULL,
  status character varying(40) NOT NULL,
  pdf_url character varying,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);
