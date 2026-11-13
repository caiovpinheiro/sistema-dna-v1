-- Folha de holerite de estágio, só no sistema novo: um registro por contratação e competência (AAAA-MM).
-- Guarda os lançamentos do operador e o cálculo usado no PDF.
CREATE TABLE IF NOT EXISTS dna_work.holerite_estagio (
  id uuid PRIMARY KEY,
  id_contratacao integer NOT NULL,
  id_empresa text NOT NULL,
  id_candidato text,
  competencia char(7) NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  bolsa_base numeric(12, 2) NOT NULL DEFAULT 0,
  dias_mes smallint NOT NULL,
  dias_trabalhados smallint NOT NULL,
  bolsa_proporcional numeric(12, 2) NOT NULL DEFAULT 0,
  faltas smallint NOT NULL DEFAULT 0 CHECK (faltas >= 0),
  valor_faltas numeric(12, 2) NOT NULL DEFAULT 0,
  auxilio_transporte numeric(12, 2) NOT NULL DEFAULT 0 CHECK (auxilio_transporte >= 0),
  acrescimos numeric(12, 2) NOT NULL DEFAULT 0 CHECK (acrescimos >= 0),
  descricao_acrescimos text NOT NULL DEFAULT '',
  descontos numeric(12, 2) NOT NULL DEFAULT 0 CHECK (descontos >= 0),
  descricao_descontos text NOT NULL DEFAULT '',
  liquido numeric(12, 2) NOT NULL DEFAULT 0,
  atualizado_por text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT holerite_estagio_unico UNIQUE (id_contratacao, competencia)
);

CREATE INDEX IF NOT EXISTS holerite_estagio_empresa ON dna_work.holerite_estagio (id_empresa, competencia);
