-- Espelho do Supabase no Postgres do dnaworkia.
-- O schema dna_work continua sendo o conjunto igual ao Lightsail.

CREATE TABLE IF NOT EXISTS public.grupo (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  email text,
  telefone text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.empresa (
  id uuid PRIMARY KEY,
  grupo_id uuid NOT NULL REFERENCES public.grupo (id),
  cnpj text NOT NULL,
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL,
  email text,
  telefone text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  latitude double precision,
  longitude double precision,
  local text
);

CREATE UNIQUE INDEX IF NOT EXISTS empresa_cnpj_digitos
  ON public.empresa (regexp_replace(cnpj, '\D', '', 'g'));

CREATE TABLE IF NOT EXISTS public.vaga (
  id uuid PRIMARY KEY,
  vaga_id uuid NOT NULL,
  grupo_id uuid NOT NULL REFERENCES public.grupo (id),
  empresa_id uuid NOT NULL REFERENCES public.empresa (id),
  tipo_vaga integer NOT NULL,
  cargo text NOT NULL,
  salario numeric,
  carga_horaria text,
  escolaridade text,
  sexo text,
  idade integer,
  idade_ate integer,
  km numeric,
  atividades text,
  tempo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  horario text,
  turno text,
  beneficios text,
  conducoes text,
  jornada text,
  tipo_trabalho text,
  cep text,
  latitude double precision,
  longitude double precision
);

CREATE TABLE IF NOT EXISTS public.vaga_repetida (
  id uuid PRIMARY KEY,
  vaga_id uuid NOT NULL,
  grupo_id uuid,
  empresa_id uuid,
  tipo_vaga text,
  cargo text,
  salario numeric,
  carga_horaria text,
  escolaridade text,
  sexo text,
  idade integer,
  idade_ate integer,
  km numeric,
  atividades text,
  tempo text,
  horario text,
  turno text,
  beneficios text,
  conducoes text,
  jornada text,
  tipo_trabalho text,
  cep text,
  latitude double precision,
  longitude double precision
);
