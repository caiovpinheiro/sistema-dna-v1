-- Descrição e requisitos por cargo (espelho do Supabase no Postgres).
-- O id do cargo vem sempre do Supabase.
CREATE TABLE IF NOT EXISTS public.cargo (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  chave text NOT NULL,
  descricao text,
  requisitos text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cargo_chave_unica ON public.cargo (chave);

-- public.vaga e public.vaga_repetida nascem no espelho do cadastro; num banco novo ainda não existem.
DO $$
BEGIN
  IF to_regclass('public.vaga') IS NOT NULL THEN
    ALTER TABLE public.vaga
      ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS descricao text,
      ADD COLUMN IF NOT EXISTS requisitos text;
    CREATE INDEX IF NOT EXISTS vaga_cargo_id ON public.vaga (cargo_id);
  END IF;
  IF to_regclass('public.vaga_repetida') IS NOT NULL THEN
    ALTER TABLE public.vaga_repetida
      ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS descricao text,
      ADD COLUMN IF NOT EXISTS requisitos text;
    CREATE INDEX IF NOT EXISTS vaga_repetida_cargo_id ON public.vaga_repetida (cargo_id);
  END IF;
END $$;
