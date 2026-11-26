-- Base de conhecimento institucional (Fase 5). Migration só aditiva.
-- Conteúdo versionado: cada versão é uma linha; o artigo aponta para a versão PUBLICADA (vigente).
-- Rascunho = versão mais nova que a publicada; nunca altera o conteúdo vigente.
-- Não guarda conversas, dados pessoais de candidatos nem credenciais (ver docs/mcp/conhecimento.md).

CREATE TABLE IF NOT EXISTS dna_work.conhecimento_categoria (
  id uuid PRIMARY KEY,
  slug character varying(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$'),
  nome character varying(120) NOT NULL,
  descricao text,
  ordem integer NOT NULL DEFAULT 0,
  ativa boolean NOT NULL DEFAULT true,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_work.conhecimento_artigo (
  id uuid PRIMARY KEY,
  slug character varying(120) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$'),
  id_categoria uuid NOT NULL REFERENCES dna_work.conhecimento_categoria (id),
  modulo character varying(40),
  status character varying(20) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicado', 'arquivado')),
  versao_publicada integer,
  -- Permissões de acesso do artigo (somadas às da ferramenta MCP):
  --   acesso_paginas vazio = qualquer colaborador com a ferramenta; senão exige UMA das páginas do painel;
  --   acesso_integracoes vazio = todas as integrações; senão só as listadas (isolamento entre integrações);
  --   somente_admin = só administradores efetivos.
  acesso_paginas text[] NOT NULL DEFAULT '{}',
  acesso_integracoes uuid[] NOT NULL DEFAULT '{}',
  somente_admin boolean NOT NULL DEFAULT false,
  revisar_em date,
  origem character varying(20) NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'importacao', 'sugestao')),
  id_autor uuid,
  id_atualizado_por uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  publicado_em timestamp with time zone
);
CREATE INDEX IF NOT EXISTS conhecimento_artigo_categoria ON dna_work.conhecimento_artigo (id_categoria, status);

CREATE TABLE IF NOT EXISTS dna_work.conhecimento_versao (
  id_artigo uuid NOT NULL REFERENCES dna_work.conhecimento_artigo (id) ON DELETE CASCADE,
  versao integer NOT NULL CHECK (versao >= 1),
  titulo character varying(200) NOT NULL,
  resumo character varying(600),
  conteudo text NOT NULL CHECK (length(conteudo) <= 100000),
  tags text[] NOT NULL DEFAULT '{}',
  palavras_chave text[] NOT NULL DEFAULT '{}',
  referencia character varying(300),
  fonte character varying(300),
  nota character varying(300),
  restaurada_de integer,
  id_autor uuid,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now(),
  -- Busca em português sem acento (preenchida pelo gatilho abaixo).
  busca tsvector,
  PRIMARY KEY (id_artigo, versao)
);
-- Título e palavras-chave pesam mais (A) que resumo e tags (B), que pesam mais que o texto (C). Sem acento e com radicais do português.
CREATE OR REPLACE FUNCTION dna_work.conhecimento_sem_acento(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') $$;

CREATE OR REPLACE FUNCTION dna_work.conhecimento_versao_busca() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.busca :=
    setweight(to_tsvector('portuguese', dna_work.conhecimento_sem_acento(NEW.titulo || ' ' || array_to_string(NEW.palavras_chave, ' '))), 'A') ||
    setweight(to_tsvector('portuguese', dna_work.conhecimento_sem_acento(coalesce(NEW.resumo, '') || ' ' || array_to_string(NEW.tags, ' '))), 'B') ||
    setweight(to_tsvector('portuguese', dna_work.conhecimento_sem_acento(NEW.conteudo)), 'C');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS conhecimento_versao_busca ON dna_work.conhecimento_versao;
CREATE TRIGGER conhecimento_versao_busca BEFORE INSERT OR UPDATE ON dna_work.conhecimento_versao
  FOR EACH ROW EXECUTE FUNCTION dna_work.conhecimento_versao_busca();

CREATE INDEX IF NOT EXISTS conhecimento_versao_busca ON dna_work.conhecimento_versao USING gin (busca);
CREATE INDEX IF NOT EXISTS conhecimento_versao_tags ON dna_work.conhecimento_versao USING gin (tags);

-- Auditoria editorial e de leitura pelo MCP (sem conteúdo, só quem, o quê e quando).
CREATE TABLE IF NOT EXISTS dna_work.conhecimento_auditoria (
  id bigserial PRIMARY KEY,
  ocorrido_em timestamp with time zone NOT NULL DEFAULT now(),
  id_usuario uuid,
  acao character varying(40) NOT NULL,
  id_artigo uuid,
  id_categoria uuid,
  versao integer,
  id_integracao uuid,
  detalhe character varying(300)
);
CREATE INDEX IF NOT EXISTS conhecimento_auditoria_quando ON dna_work.conhecimento_auditoria (ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS conhecimento_auditoria_artigo ON dna_work.conhecimento_auditoria (id_artigo, ocorrido_em DESC);

-- Preparado para o futuro (sem uso nesta fase): papéis editoriais por categoria (coordenador/gestor).
CREATE TABLE IF NOT EXISTS dna_work.conhecimento_editor (
  id_usuario uuid NOT NULL REFERENCES dna_work.app_usuario (id) ON DELETE CASCADE,
  id_categoria uuid REFERENCES dna_work.conhecimento_categoria (id) ON DELETE CASCADE,
  papel character varying(20) NOT NULL CHECK (papel IN ('editor', 'revisor')),
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (id_usuario, id_categoria, papel)
);

-- Preparado para o futuro (sem uso nesta fase): sugestões vindas de análise de IA, sempre anonimizadas e revisadas
-- antes de virar rascunho. Nunca publicadas automaticamente.
CREATE TABLE IF NOT EXISTS dna_work.conhecimento_sugestao (
  id uuid PRIMARY KEY,
  origem character varying(40) NOT NULL,
  titulo character varying(200) NOT NULL,
  conteudo text NOT NULL CHECK (length(conteudo) <= 20000),
  justificativa text,
  id_categoria uuid REFERENCES dna_work.conhecimento_categoria (id),
  anonimizada boolean NOT NULL DEFAULT false,
  status character varying(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada')),
  id_revisor uuid,
  revisado_em timestamp with time zone,
  id_artigo uuid REFERENCES dna_work.conhecimento_artigo (id) ON DELETE SET NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

-- Categorias iniciais (estrutura, sem conteúdo). Administráveis pelo painel.
INSERT INTO dna_work.conhecimento_categoria (id, slug, nome, ordem) VALUES
  ('4a0e7c4e-0001-4000-8000-000000000001', 'atendimento-ao-candidato', 'Atendimento ao candidato', 1),
  ('4a0e7c4e-0002-4000-8000-000000000002', 'recrutamento-e-selecao', 'Recrutamento e seleção', 2),
  ('4a0e7c4e-0003-4000-8000-000000000003', 'apresentacao-de-vagas', 'Apresentação de vagas', 3),
  ('4a0e7c4e-0004-4000-8000-000000000004', 'contorno-de-objecoes', 'Contorno de objeções', 4),
  ('4a0e7c4e-0005-4000-8000-000000000005', 'agendamento-de-entrevistas', 'Agendamento de entrevistas', 5),
  ('4a0e7c4e-0006-4000-8000-000000000006', 'acompanhamento-de-candidatos', 'Acompanhamento de candidatos', 6),
  ('4a0e7c4e-0007-4000-8000-000000000007', 'processos-internos', 'Processos internos', 7),
  ('4a0e7c4e-0008-4000-8000-000000000008', 'regras-de-estagio', 'Regras de estágio', 8),
  ('4a0e7c4e-0009-4000-8000-000000000009', 'regras-clt', 'Regras CLT', 9),
  ('4a0e7c4e-0010-4000-8000-000000000010', 'compatibilidade-profissional', 'Compatibilidade profissional', 10),
  ('4a0e7c4e-0011-4000-8000-000000000011', 'boas-praticas-comerciais', 'Boas práticas comerciais', 11),
  ('4a0e7c4e-0012-4000-8000-000000000012', 'modelos-de-mensagens', 'Modelos de mensagens', 12),
  ('4a0e7c4e-0013-4000-8000-000000000013', 'perguntas-frequentes', 'Perguntas frequentes', 13),
  ('4a0e7c4e-0014-4000-8000-000000000014', 'treinamentos', 'Treinamentos', 14),
  ('4a0e7c4e-0015-4000-8000-000000000015', 'procedimentos-administrativos', 'Procedimentos administrativos', 15),
  ('4a0e7c4e-0016-4000-8000-000000000016', 'sistemas-dna-work-e-bwipo', 'Utilização dos sistemas DNA Work e Bwipo', 16)
ON CONFLICT (slug) DO NOTHING;
