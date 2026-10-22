CREATE TABLE IF NOT EXISTS dna_work.termo_estagio (
  id uuid PRIMARY KEY,
  id_contratacao integer NOT NULL,
  id_candidato character varying,
  id_empresa character varying,
  nome character varying(200) NOT NULL,
  zapsign_token character varying(120),
  status character varying(30) NOT NULL DEFAULT 'enviado',
  arquivo_assinado character varying,
  signatarios jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamp without time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS termo_estagio__contratacao ON dna_work.termo_estagio (id_contratacao);
CREATE INDEX IF NOT EXISTS termo_estagio__token ON dna_work.termo_estagio (zapsign_token);
