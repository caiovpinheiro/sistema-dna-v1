ALTER TABLE dna_work.app_usuario
  ADD COLUMN IF NOT EXISTS admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS dna_work.app_usuario_pagina (
  id_usuario uuid NOT NULL REFERENCES dna_work.app_usuario (id),
  pagina character varying(60) NOT NULL,
  PRIMARY KEY (id_usuario, pagina)
);

INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina)
SELECT u.id, p.pagina
FROM dna_work.app_usuario u
CROSS JOIN (
  VALUES
    ('painel'),
    ('candidatos'),
    ('empresas'),
    ('vagas'),
    ('vagas-modelos'),
    ('vagas-modelo'),
    ('processos'),
    ('contratacoes'),
    ('termos'),
    ('termos-gerar'),
    ('instituicoes'),
    ('instituicoes-nova'),
    ('faturamento'),
    ('contas'),
    ('regua'),
    ('procfy'),
    ('comissao'),
    ('comissao-empresas'),
    ('holerite'),
    ('emails'),
    ('documentos')
) AS p(pagina)
ON CONFLICT DO NOTHING;
