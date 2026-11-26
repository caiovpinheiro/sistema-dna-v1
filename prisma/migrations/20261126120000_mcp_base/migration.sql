-- MCP (Fase 2A): integrações, vínculos, registro OAuth, anti-replay, limite de uso e auditoria.
-- Migration só aditiva: não altera nem apaga nada existente. Nasce tudo desligado (integração `ativa = false`).
-- O serviço MCP (gateway) nunca executa migrations nem lê estas tabelas: só o monólito.

CREATE TABLE IF NOT EXISTS dna_work.mcp_integracao (
  id uuid PRIMARY KEY,
  slug character varying(60) NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$'),
  nome character varying(120) NOT NULL,
  descricao text,
  instrucoes text,
  ativa boolean NOT NULL DEFAULT false,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

-- Ferramentas liberadas por integração. Sem linha, a ferramenta não existe para a integração (deny-by-default).
CREATE TABLE IF NOT EXISTS dna_work.mcp_integracao_ferramenta (
  id_integracao uuid NOT NULL REFERENCES dna_work.mcp_integracao (id) ON DELETE CASCADE,
  ferramenta character varying(80) NOT NULL,
  PRIMARY KEY (id_integracao, ferramenta)
);

-- Usuários autorizados na integração. `ferramentas` NULL = todas as da integração; lista = só essas.
-- `permissoes` = permissões individuais extras (ex.: candidatos:contato), vazias por padrão.
CREATE TABLE IF NOT EXISTS dna_work.mcp_integracao_usuario (
  id_integracao uuid NOT NULL REFERENCES dna_work.mcp_integracao (id) ON DELETE CASCADE,
  id_usuario uuid NOT NULL REFERENCES dna_work.app_usuario (id) ON DELETE CASCADE,
  ferramentas text[],
  permissoes text[] NOT NULL DEFAULT '{}',
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id_integracao, id_usuario)
);

-- Armazenamento do servidor OAuth (oidc-provider): códigos, tokens, grants, sessões, interações e clientes.
-- `id` guarda o SHA-256 dos segredos (códigos e tokens nunca ficam em texto puro).
CREATE TABLE IF NOT EXISTS dna_work.mcp_oauth_registro (
  tipo character varying(40) NOT NULL,
  id character varying(128) NOT NULL,
  payload jsonb NOT NULL,
  grant_id character varying(128),
  uid character varying(128),
  user_code character varying(128),
  expira_em timestamp with time zone,
  consumido_em timestamp with time zone,
  PRIMARY KEY (tipo, id)
);
CREATE INDEX IF NOT EXISTS mcp_oauth_registro_grant ON dna_work.mcp_oauth_registro (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_registro_uid ON dna_work.mcp_oauth_registro (uid) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_registro_user_code ON dna_work.mcp_oauth_registro (user_code) WHERE user_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS mcp_oauth_registro_expira ON dna_work.mcp_oauth_registro (expira_em);
CREATE INDEX IF NOT EXISTS mcp_oauth_registro_conta ON dna_work.mcp_oauth_registro ((payload ->> 'accountId')) WHERE payload ? 'accountId';

-- Anti-replay da assinatura gateway -> monólito. A chave primária faz o consumo ser atômico entre réplicas.
CREATE TABLE IF NOT EXISTS dna_work.mcp_nonce (
  chave character varying(40) NOT NULL,
  nonce character varying(80) NOT NULL,
  expira_em timestamp with time zone NOT NULL,
  PRIMARY KEY (chave, nonce)
);
CREATE INDEX IF NOT EXISTS mcp_nonce_expira ON dna_work.mcp_nonce (expira_em);

-- Contadores do rate limit por janela (compartilhados entre réplicas).
CREATE TABLE IF NOT EXISTS dna_work.mcp_limite (
  chave character varying(200) NOT NULL,
  janela bigint NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela)
);

-- Auditoria. Sem tokens, sem argumentos e sem dados de candidatos: só quem, o quê, quando, resultado e tempo.
CREATE TABLE IF NOT EXISTS dna_work.mcp_auditoria (
  id bigserial PRIMARY KEY,
  ocorrido_em timestamp with time zone NOT NULL DEFAULT now(),
  id_usuario uuid,
  id_integracao uuid,
  slug character varying(60),
  operacao character varying(30) NOT NULL,
  ferramenta character varying(80),
  resultado character varying(30) NOT NULL,
  codigo character varying(80),
  duracao_ms integer,
  request_id character varying(80),
  cliente character varying(300)
);
CREATE INDEX IF NOT EXISTS mcp_auditoria_quando ON dna_work.mcp_auditoria (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS mcp_auditoria_usuario ON dna_work.mcp_auditoria (id_usuario, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS mcp_auditoria_integracao ON dna_work.mcp_auditoria (id_integracao, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS mcp_auditoria_ferramenta ON dna_work.mcp_auditoria (ferramenta, ocorrido_em DESC);
