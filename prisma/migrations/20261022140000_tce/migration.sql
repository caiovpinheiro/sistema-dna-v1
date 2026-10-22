ALTER TABLE dna_work.termo_estagio ALTER COLUMN id_contratacao DROP NOT NULL;
ALTER TABLE dna_work.termo_estagio ADD COLUMN IF NOT EXISTS tce_id text;
ALTER TABLE dna_work.termo_estagio ADD COLUMN IF NOT EXISTS candidato_nome character varying(200);
ALTER TABLE dna_work.termo_estagio ADD COLUMN IF NOT EXISTS empresa_nome character varying(200);

CREATE TABLE IF NOT EXISTS public.tces (
  id text PRIMARY KEY,
  empresa_id text NOT NULL,
  empresa_nome text NOT NULL,
  candidato_nome text NOT NULL,
  payload jsonb NOT NULL,
  pdf_path text NOT NULL,
  status text NOT NULL DEFAULT 'generated',
  parent_id text REFERENCES public.tces(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tces_created_at_idx ON public.tces (created_at DESC);
