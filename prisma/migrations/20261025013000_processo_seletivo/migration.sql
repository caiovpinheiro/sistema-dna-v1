CREATE TABLE IF NOT EXISTS dna_work.processo_seletivo (
  id uuid PRIMARY KEY,
  id_candidato character varying NOT NULL,
  id_empresa character varying NOT NULL,
  id_vaga character varying NOT NULL,
  origem character varying(20) NOT NULL CHECK (origem IN ('dnawork', 'empresa')),
  data_recebimento date NOT NULL,
  data_encaminhamento date,
  etapa character varying(40) NOT NULL CHECK (etapa IN (
    'recebido',
    'encaminhado',
    'entrevista_agendada',
    'entrevista_realizada',
    'contratado',
    'reprovado',
    'desistente'
  )),
  id_contratacao integer,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS processo_seletivo_aberto
  ON dna_work.processo_seletivo (id_candidato, id_vaga)
  WHERE etapa NOT IN ('contratado', 'reprovado', 'desistente');

CREATE INDEX IF NOT EXISTS processo_seletivo_empresa ON dna_work.processo_seletivo (id_empresa);
CREATE INDEX IF NOT EXISTS processo_seletivo_vaga ON dna_work.processo_seletivo (id_vaga);
CREATE INDEX IF NOT EXISTS processo_seletivo_contratacao ON dna_work.processo_seletivo (id_contratacao);

CREATE TABLE IF NOT EXISTS dna_work.processo_movimento (
  id uuid PRIMARY KEY,
  id_processo uuid NOT NULL REFERENCES dna_work.processo_seletivo (id),
  etapa character varying(40) NOT NULL,
  observacao character varying(500),
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processo_movimento_processo
  ON dna_work.processo_movimento (id_processo, criado_em);
