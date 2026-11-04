-- Descrição e requisitos por cargo.
-- Rodar no editor SQL do Supabase antes do deploy do código que usa estas colunas.
-- Pode rodar mais de uma vez: nada é recriado nem apagado.

CREATE TABLE IF NOT EXISTS public.cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  chave text NOT NULL,
  descricao text,
  requisitos text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cargo_chave_unica ON public.cargo (chave);

-- Só o backend (service role) lê e grava esta tabela.
ALTER TABLE public.cargo ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vaga
  ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descricao text,
  ADD COLUMN IF NOT EXISTS requisitos text;

ALTER TABLE public.vaga_repetida
  ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS descricao text,
  ADD COLUMN IF NOT EXISTS requisitos text;

CREATE INDEX IF NOT EXISTS vaga_cargo_id ON public.vaga (cargo_id);
CREATE INDEX IF NOT EXISTS vaga_repetida_cargo_id ON public.vaga_repetida (cargo_id);

-- Faz a API REST enxergar a tabela e as colunas novas sem esperar.
NOTIFY pgrst, 'reload schema';
