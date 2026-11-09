-- Documentos do candidato (só no Postgres): um por tipo e candidato.
-- Vêm do TCE (números e dados digitados) e dos arquivos que o sistema antigo guardou (RG, CPF, endereço, matrícula).
CREATE TABLE IF NOT EXISTS public.candidato_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_candidato varchar(64) NOT NULL,
  -- cpf | rg | endereco | matricula | nascimento | responsavel
  tipo text NOT NULL,
  -- Número ou texto do documento (CPF, RG, endereço completo, data de nascimento).
  valor text,
  -- Campos extras (ex.: responsável legal: nome, CPF, RG, e-mail, telefone, endereço).
  dados jsonb,
  arquivo bytea,
  arquivo_nome text,
  arquivo_tipo text,
  -- tce | sistema antigo
  origem text NOT NULL,
  tce_id text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidato_documentos_unico UNIQUE (id_candidato, tipo)
);

CREATE INDEX IF NOT EXISTS candidato_documentos_candidato_idx ON public.candidato_documentos (id_candidato);
