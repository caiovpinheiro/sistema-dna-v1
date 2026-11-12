-- Schema LOCAL compatível com dna_work.
-- Usado apenas por PostgreSQL vazio de desenvolvimento e pela suíte de testes.
-- Não executar na base atual. Não apaga tabelas existentes: só cria se não existirem.

CREATE SCHEMA IF NOT EXISTS dna_work;

CREATE TABLE IF NOT EXISTS dna_work.modalidade_vaga (
  id integer PRIMARY KEY,
  descricao character varying,
  descricaomenu character varying,
  estudando integer,
  temporario integer,
  formulario integer
);

INSERT INTO dna_work.modalidade_vaga (id, descricao, descricaomenu, estudando, temporario, formulario)
VALUES
  (1, 'Estágio', 'Cadastrar Estágio', 1, 0, 0),
  (2, 'CLT', 'Cadastrar CLT', 0, 0, 1),
  (4, 'Pessoa Juridica', 'Pessoa Juridica', 0, 1, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dna_work.empresa (
  id_empresa character varying PRIMARY KEY,
  razao_social character varying,
  nome_fantasia character varying,
  cnpj character varying,
  email character varying,
  telefone character varying,
  celular character varying,
  cep character varying,
  logradouro character varying,
  numero character varying,
  complemento character varying,
  bairro character varying,
  cidade character varying,
  uf character varying,
  status integer,
  responsavel character varying,
  tipo_empresa integer,
  matriz character varying,
  ie character varying,
  site character varying,
  obs text,
  data_adicao timestamp without time zone
);

CREATE TABLE IF NOT EXISTS dna_work.candidato (
  id_candidato character varying PRIMARY KEY,
  nome character varying,
  cpf character varying,
  rg character varying,
  rg_expedidor character varying,
  datanascimento character varying,
  datacadastro character varying,
  ultimaalteracao character varying,
  telefonefixo character varying,
  celular character varying,
  email character varying,
  logradouro character varying,
  numero character varying,
  complemento character varying,
  bairro character varying,
  cidade character varying,
  estado character varying,
  cep character varying,
  escola character varying,
  nome_escola character varying,
  modalidadecurso character varying,
  curso character varying,
  periodo character varying,
  semestre character varying,
  ctps character varying,
  sexo character,
  estadocivil character varying,
  obs text,
  id_empresa character varying,
  colaborador integer,
  contador integer,
  banco character varying,
  agencia character varying,
  numero_conta character varying,
  nome_conta character varying,
  tipo_chave_pix character varying,
  chave_pix character varying,
  pcd character varying
);

CREATE INDEX IF NOT EXISTS candidato__cpf ON dna_work.candidato USING btree (cpf);

CREATE TABLE IF NOT EXISTS dna_work.vaga (
  id_vaga character varying PRIMARY KEY,
  id_empresa character varying,
  cargo character varying,
  tipo_vaga integer,
  salario character varying,
  status integer,
  comparador character varying,
  dataabertura character varying,
  publicar integer,
  carga_horaria character varying,
  obs text,
  quantidade_posicoes integer,
  data_adicao timestamp without time zone,
  CONSTRAINT vaga_quantidade_posicoes_check CHECK (quantidade_posicoes IS NULL OR quantidade_posicoes > 0)
);

CREATE INDEX IF NOT EXISTS vaga__id_empresa ON dna_work.vaga USING btree (id_empresa);

CREATE TABLE IF NOT EXISTS dna_work.conratacaovaga (
  id_contratacao integer PRIMARY KEY,
  id_vaga character varying,
  id_candidato character varying,
  data_contratacao character varying,
  data_demicao character varying,
  status integer,
  contador integer,
  id_empresa character varying,
  comparador character varying,
  datainicio character varying,
  datafim character varying,
  ferias integer,
  id_supervisor integer,
  id_responsavel_agente integer
);

CREATE SEQUENCE IF NOT EXISTS dna_work.conratacaovaga_id_contratacao_seq AS integer;
SELECT setval(
  'dna_work.conratacaovaga_id_contratacao_seq',
  COALESCE((SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga), 1),
  (SELECT MAX(id_contratacao) FROM dna_work.conratacaovaga) IS NOT NULL
);
ALTER TABLE dna_work.conratacaovaga
  ALTER COLUMN id_contratacao SET DEFAULT nextval('dna_work.conratacaovaga_id_contratacao_seq');
ALTER SEQUENCE dna_work.conratacaovaga_id_contratacao_seq OWNED BY dna_work.conratacaovaga.id_contratacao;

CREATE INDEX IF NOT EXISTS conratacaovaga__id_vaga ON dna_work.conratacaovaga USING btree (id_vaga);
CREATE INDEX IF NOT EXISTS conratacaovaga__id_candidato ON dna_work.conratacaovaga USING btree (id_candidato);
CREATE INDEX IF NOT EXISTS conratacaovaga__status ON dna_work.conratacaovaga USING btree (status);

CREATE TABLE IF NOT EXISTS dna_work.colaborador (
  id_colaborador character varying,
  id_candidato character varying,
  id_empresa character varying,
  data_inicio character varying,
  departamento character varying,
  cargo character varying,
  tipo_vaga integer,
  salario character varying,
  carga_horaria character varying,
  data_cadastro character varying,
  status_colaborador integer,
  supervisor character varying,
  id_contratacao integer
);

CREATE INDEX IF NOT EXISTS colaborador__id_colaborador ON dna_work.colaborador USING btree (id_colaborador);
CREATE INDEX IF NOT EXISTS colaborador__id_contratacao ON dna_work.colaborador USING btree (id_contratacao);

CREATE TABLE IF NOT EXISTS dna_work.app_usuario (
  id uuid PRIMARY KEY,
  nome character varying(160) NOT NULL,
  email character varying(160) NOT NULL UNIQUE,
  senha_hash character varying(255) NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_work.termo_estagio (
  id uuid PRIMARY KEY,
  id_contratacao integer,
  tce_id text,
  candidato_nome character varying(200),
  empresa_nome character varying(200),
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

CREATE TABLE IF NOT EXISTS dna_work.rescisao_documento (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_contratacao integer NOT NULL UNIQUE,
  nome character varying(200) NOT NULL,
  motivo character varying(200) NOT NULL,
  motivo_interno text,
  avaliacao character varying(40),
  resumo text,
  data_demissao character varying(20) NOT NULL,
  cargo character varying(200),
  empresa character varying(200),
  texto text,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_work.api_idempotencia (
  chave character varying(120) PRIMARY KEY,
  request_hash character varying(128) NOT NULL,
  status_code integer,
  response jsonb,
  criado_em timestamp without time zone NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Colunas legadas do dna_work que o código lê ou grava.
-- ALTER ... ADD COLUMN IF NOT EXISTS também atualiza um .pgdata local já criado.
-- ---------------------------------------------------------------------------

ALTER TABLE dna_work.candidato
  ADD COLUMN IF NOT EXISTS data_adicao timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'),
  ADD COLUMN IF NOT EXISTS atendimento jsonb,
  ADD COLUMN IF NOT EXISTS ano_escolar character varying,
  ADD COLUMN IF NOT EXISTS terminoestudo character varying,
  ADD COLUMN IF NOT EXISTS objetivo character varying,
  ADD COLUMN IF NOT EXISTS nomepai character varying,
  ADD COLUMN IF NOT EXISTS nomemae character varying,
  ADD COLUMN IF NOT EXISTS nome_responsavel character varying,
  ADD COLUMN IF NOT EXISTS cpf_responsavel character varying,
  ADD COLUMN IF NOT EXISTS celular_responsavel character varying,
  ADD COLUMN IF NOT EXISTS email_responsavel character varying,
  ADD COLUMN IF NOT EXISTS lat character varying,
  ADD COLUMN IF NOT EXISTS lng character varying;

ALTER TABLE dna_work.empresa
  ADD COLUMN IF NOT EXISTS sede integer,
  ADD COLUMN IF NOT EXISTS usa_agente integer,
  ADD COLUMN IF NOT EXISTS recrutamento integer,
  ADD COLUMN IF NOT EXISTS lat character varying,
  ADD COLUMN IF NOT EXISTS lng character varying,
  ADD COLUMN IF NOT EXISTS razao_sem_acento character varying,
  ADD COLUMN IF NOT EXISTS fantasia_sem_acento character varying,
  ADD COLUMN IF NOT EXISTS email_financeiro character varying,
  ADD COLUMN IF NOT EXISTS nome_financeiro character varying,
  ADD COLUMN IF NOT EXISTS datafechamento character varying,
  ADD COLUMN IF NOT EXISTS forma_comissao character varying,
  ADD COLUMN IF NOT EXISTS valor_comisao_empresa character varying,
  ADD COLUMN IF NOT EXISTS usuario character varying,
  ADD COLUMN IF NOT EXISTS instrucao text,
  ADD COLUMN IF NOT EXISTS id_asaas character varying,
  ADD COLUMN IF NOT EXISTS usa_asaas integer;

ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS km character varying,
  ADD COLUMN IF NOT EXISTS atribuicaoes text,
  ADD COLUMN IF NOT EXISTS atribu_contrato text,
  ADD COLUMN IF NOT EXISTS requisitos_desejaveis text,
  ADD COLUMN IF NOT EXISTS destaque text,
  ADD COLUMN IF NOT EXISTS sexo character varying,
  ADD COLUMN IF NOT EXISTS idade character varying,
  ADD COLUMN IF NOT EXISTS idadeate character varying,
  ADD COLUMN IF NOT EXISTS escolaridade character varying,
  ADD COLUMN IF NOT EXISTS horabase character varying,
  ADD COLUMN IF NOT EXISTS hora_saida_base character varying,
  ADD COLUMN IF NOT EXISTS segunda_entrada character varying,
  ADD COLUMN IF NOT EXISTS segunda_saida character varying,
  ADD COLUMN IF NOT EXISTS terca_entrada character varying,
  ADD COLUMN IF NOT EXISTS terca_saida character varying,
  ADD COLUMN IF NOT EXISTS quarta_entrada character varying,
  ADD COLUMN IF NOT EXISTS quarta_saida character varying,
  ADD COLUMN IF NOT EXISTS quinta_entrada character varying,
  ADD COLUMN IF NOT EXISTS quinta_saida character varying,
  ADD COLUMN IF NOT EXISTS sexta_entrada character varying,
  ADD COLUMN IF NOT EXISTS sexta_saida character varying,
  ADD COLUMN IF NOT EXISTS sab_entrada character varying,
  ADD COLUMN IF NOT EXISTS sab_saida character varying,
  ADD COLUMN IF NOT EXISTS domindo_entrada character varying,
  ADD COLUMN IF NOT EXISTS domindo_saida character varying,
  ADD COLUMN IF NOT EXISTS sede integer,
  ADD COLUMN IF NOT EXISTS codigo character varying,
  ADD COLUMN IF NOT EXISTS faturar character varying,
  ADD COLUMN IF NOT EXISTS texto_carga text,
  ADD COLUMN IF NOT EXISTS periodo character varying,
  ADD COLUMN IF NOT EXISTS semanas_inicio character varying,
  ADD COLUMN IF NOT EXISTS semanas_fim character varying,
  ADD COLUMN IF NOT EXISTS tempo_refeicao character varying,
  ADD COLUMN IF NOT EXISTS remoto integer,
  ADD COLUMN IF NOT EXISTS beneficios_texto text;

-- Encaminhamentos do legado (Painel e ficha da vaga).
CREATE TABLE IF NOT EXISTS dna_work.emcaminhamento (
  id_candidato character varying,
  id_vaga character varying,
  comparador character varying,
  data character varying,
  aceite character varying,
  reprovado character varying
);

CREATE INDEX IF NOT EXISTS emcaminhamento__comparador ON dna_work.emcaminhamento USING btree (comparador);

-- Portal da empresa (legado). A migration usuario_empresa_senha_hash supõe que já existem.
CREATE TABLE IF NOT EXISTS dna_work.usuario_empresa (
  id_u character varying(40) PRIMARY KEY,
  nome_u character varying(255),
  email_u character varying(255),
  senha_u character varying(40),
  senha_hash text,
  telefone_u character varying(20),
  empresa_u character varying(40),
  status integer,
  tipo integer,
  data_senha character varying(20),
  atualiza_senha integer
);

CREATE TABLE IF NOT EXISTS dna_work.vinculo_empresa_usuario (
  id_usuario character varying(40),
  id_empresa character varying(40)
);

CREATE TABLE IF NOT EXISTS dna_work.paginas_usuario_empresa (
  id_usuario character varying(42),
  menu text,
  sub1 text,
  sub2 text,
  paginas text
);

-- ---------------------------------------------------------------------------
-- Tabelas das migrations do Prisma (prisma/migrations), sem os dados de produção.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS termo_estagio__contratacao ON dna_work.termo_estagio (id_contratacao);
CREATE INDEX IF NOT EXISTS termo_estagio__token ON dna_work.termo_estagio (zapsign_token);

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

CREATE TABLE IF NOT EXISTS dna_work.cobranca_asaas (
  id uuid PRIMARY KEY,
  id_empresa character varying NOT NULL,
  asaas_payment_id character varying(64),
  asaas_customer_id character varying(64),
  descricao character varying(200) NOT NULL,
  valor numeric(12,2) NOT NULL,
  valor_liquido numeric(12,2),
  vencimento date NOT NULL,
  forma character varying(40) NOT NULL,
  status character varying(40) NOT NULL DEFAULT 'PENDING',
  situacao character varying(20) NOT NULL DEFAULT 'aberta',
  url_pagamento character varying,
  invoice_number character varying(40),
  data_pagamento date,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  atualizado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobranca_asaas_empresa ON dna_work.cobranca_asaas (id_empresa);
CREATE INDEX IF NOT EXISTS cobranca_asaas_payment ON dna_work.cobranca_asaas (asaas_payment_id);

CREATE TABLE IF NOT EXISTS dna_work.nota_asaas (
  id uuid PRIMARY KEY,
  id_cobranca uuid NOT NULL REFERENCES dna_work.cobranca_asaas(id),
  asaas_invoice_id character varying(64),
  tipo character varying(40) NOT NULL,
  valor numeric(12,2) NOT NULL,
  status character varying(40) NOT NULL,
  pdf_url character varying,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dna_work.fatura_regua (
  id uuid PRIMARY KEY,
  id_cobranca uuid NOT NULL UNIQUE REFERENCES dna_work.cobranca_asaas(id),
  id_empresa character varying NOT NULL,
  competencia date NOT NULL,
  vencimento date NOT NULL,
  valor numeric(12,2) NOT NULL,
  email_cobranca character varying,
  contato character varying,
  link_cobranca character varying,
  link_central character varying NOT NULL,
  status_pagamento character varying(20) NOT NULL DEFAULT 'em_aberto',
  comprovante boolean NOT NULL DEFAULT false,
  data_baixa date,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fatura_regua_competencia ON dna_work.fatura_regua (competencia);

CREATE TABLE IF NOT EXISTS dna_work.fatura_envio (
  id uuid PRIMARY KEY,
  id_fatura uuid NOT NULL REFERENCES dna_work.fatura_regua(id),
  etapa character varying(30) NOT NULL,
  ordem integer NOT NULL,
  data_prevista date NOT NULL,
  status character varying(20) NOT NULL DEFAULT 'a_enviar',
  enviado_em timestamp with time zone,
  responsavel character varying,
  tentativas integer NOT NULL DEFAULT 0,
  ultimo_erro text,
  reservado_em timestamp with time zone,
  UNIQUE (id_fatura, etapa)
);

ALTER TABLE dna_work.fatura_envio
  ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_erro text,
  ADD COLUMN IF NOT EXISTS reservado_em timestamp with time zone;

CREATE TABLE IF NOT EXISTS dna_work.fatura_regua_log (
  id uuid PRIMARY KEY,
  id_fatura uuid,
  id_envio uuid,
  etapa character varying(30),
  evento character varying(30) NOT NULL,
  detalhe text,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fatura_regua_log_fatura ON dna_work.fatura_regua_log (id_fatura, criado_em);

CREATE TABLE IF NOT EXISTS dna_work.processo_seletivo (
  id uuid PRIMARY KEY,
  id_candidato character varying NOT NULL,
  id_empresa character varying NOT NULL,
  id_vaga character varying NOT NULL,
  origem character varying(20) NOT NULL CHECK (origem IN ('dnawork', 'empresa')),
  data_recebimento date NOT NULL,
  data_encaminhamento date,
  etapa character varying(40) NOT NULL CHECK (etapa IN (
    'recebido',
    'encaminhado',
    'entrevista_agendada',
    'entrevista_realizada',
    'contratado',
    'reprovado',
    'desistente'
  )),
  id_contratacao integer,
  atendimento jsonb,
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE dna_work.processo_seletivo ADD COLUMN IF NOT EXISTS atendimento jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS processo_seletivo_aberto
  ON dna_work.processo_seletivo (id_candidato, id_vaga)
  WHERE etapa NOT IN ('contratado', 'reprovado', 'desistente');
CREATE INDEX IF NOT EXISTS processo_seletivo_empresa ON dna_work.processo_seletivo (id_empresa);
CREATE INDEX IF NOT EXISTS processo_seletivo_vaga ON dna_work.processo_seletivo (id_vaga);
CREATE INDEX IF NOT EXISTS processo_seletivo_contratacao ON dna_work.processo_seletivo (id_contratacao);

CREATE TABLE IF NOT EXISTS dna_work.processo_movimento (
  id uuid PRIMARY KEY,
  id_processo uuid NOT NULL REFERENCES dna_work.processo_seletivo (id),
  etapa character varying(40) NOT NULL,
  observacao character varying(500),
  criado_em timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processo_movimento_processo
  ON dna_work.processo_movimento (id_processo, criado_em);

ALTER TABLE dna_work.app_usuario
  ADD COLUMN IF NOT EXISTS admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS dna_work.app_usuario_pagina (
  id_usuario uuid NOT NULL REFERENCES dna_work.app_usuario (id),
  pagina character varying(60) NOT NULL,
  PRIMARY KEY (id_usuario, pagina)
);

CREATE TABLE IF NOT EXISTS public.valor_empresas (
  id_empresa varchar(64) PRIMARY KEY,
  cnpj varchar(20) NOT NULL,
  nome text NOT NULL,
  razao_social text,
  tipo text,
  cadastro text,
  servicos text[] NOT NULL DEFAULT '{}',
  clt_modelo text NOT NULL,
  clt_valor numeric(12, 2),
  clt_taxa text,
  clt_calculo text,
  clt_status text NOT NULL,
  est_modelo text NOT NULL,
  est_mensal numeric(12, 2),
  est_rs numeric(12, 2),
  est_taxa text,
  est_calculo text,
  est_status text NOT NULL,
  ciclo text,
  fechamento_dia smallint,
  vencimento_dia smallint,
  notas text[] NOT NULL DEFAULT '{}',
  alertas text[] NOT NULL DEFAULT '{}',
  documentos text[] NOT NULL DEFAULT '{}',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidato_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_candidato varchar(64) NOT NULL,
  tipo text NOT NULL,
  valor text,
  dados jsonb,
  arquivo bytea,
  arquivo_nome text,
  arquivo_tipo text,
  origem text NOT NULL,
  tce_id text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidato_documentos_unico UNIQUE (id_candidato, tipo)
);

CREATE INDEX IF NOT EXISTS candidato_documentos_candidato_idx ON public.candidato_documentos (id_candidato);

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

CREATE INDEX IF NOT EXISTS tracker_ganhos_deal_idx ON public.tracker_ganhos (deal_id);
CREATE INDEX IF NOT EXISTS tracker_ganhos_passagem_idx ON public.tracker_ganhos (passagem, ganho_em DESC);

CREATE TABLE IF NOT EXISTS dna_work.portal_empresa_acesso (
  id_empresa varchar(40) PRIMARY KEY,
  id_usuario varchar(40),
  email varchar(255),
  primeiro_login timestamptz,
  ultimo_login timestamptz,
  ultimo_uso timestamptz,
  logins integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Espelho do cadastro do Supabase (database/migrations/006 e 007).
-- ---------------------------------------------------------------------------

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

CREATE TABLE IF NOT EXISTS public.cargo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  chave text NOT NULL,
  descricao text,
  requisitos text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cargo_chave_unica ON public.cargo (chave);

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
  longitude double precision,
  cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
  descricao text,
  requisitos text
);

CREATE INDEX IF NOT EXISTS vaga_cargo_id ON public.vaga (cargo_id);

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
  longitude double precision,
  cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL,
  descricao text,
  requisitos text
);

CREATE INDEX IF NOT EXISTS vaga_repetida_cargo_id ON public.vaga_repetida (cargo_id);

-- Endereço e benefícios da vaga no legado (lista de vagas).
CREATE TABLE IF NOT EXISTS dna_work.vaga_endereco (
  comparador character varying,
  logradouro character varying,
  numero character varying,
  complemento character varying,
  bairro character varying,
  cidade character varying,
  uf character varying,
  cep character varying,
  empresa character varying
);

CREATE INDEX IF NOT EXISTS vaga_endereco__comparador ON dna_work.vaga_endereco USING btree (comparador);

CREATE TABLE IF NOT EXISTS dna_work.beneficio (
  id integer PRIMARY KEY,
  beneficios character varying
);

CREATE TABLE IF NOT EXISTS dna_work.beneficio_vaga (
  id_vaga character varying,
  id_beneficio integer
);
