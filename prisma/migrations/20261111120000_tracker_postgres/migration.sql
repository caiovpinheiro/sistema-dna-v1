-- tracker_leads e tracker_ganhos saem do Supabase e passam a ficar só no Postgres.
-- Mesmos nomes e tipos do Supabase; tracker_leads ganha updated_at.

CREATE TABLE IF NOT EXISTS public.tracker_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text,
  telefone_normalizado text,
  origem text,
  campanha text,
  headline text,
  ctwa_clid text,
  fbclid text,
  gclid text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  tipo_vaga text,
  ad_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sem UNIQUE em telefone_normalizado: há telefone repetido nos dados atuais.
CREATE INDEX IF NOT EXISTS tracker_leads_telefone_idx ON public.tracker_leads (telefone_normalizado);
CREATE INDEX IF NOT EXISTS tracker_leads_created_idx ON public.tracker_leads (created_at);

CREATE TABLE IF NOT EXISTS public.tracker_ganhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id text NOT NULL,
  contact_id text,
  telefone text,
  telefone_normalizado text,
  origem text,
  campanha text,
  ganho_em timestamptz,
  tipo_vaga text,
  passagem text,
  ad_id text
);

-- Sem UNIQUE em deal_id: o mesmo negócio tem uma linha por fase ("<idDoNegocio>:<entrou_em>").
CREATE INDEX IF NOT EXISTS tracker_ganhos_deal_idx ON public.tracker_ganhos (deal_id);
CREATE INDEX IF NOT EXISTS tracker_ganhos_passagem_idx ON public.tracker_ganhos (passagem, ganho_em DESC);
