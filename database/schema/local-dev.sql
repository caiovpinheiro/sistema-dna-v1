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
  pcd character varying,
  atendimento jsonb
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
  km character varying,
  atribuicaoes text,
  atribu_contrato text,
  requisitos_desejaveis character varying,
  destaque character varying,
  sexo character,
  CONSTRAINT vaga_quantidade_posicoes_check CHECK (quantidade_posicoes IS NULL OR quantidade_posicoes > 0)
);

CREATE INDEX IF NOT EXISTS vaga__id_empresa ON dna_work.vaga USING btree (id_empresa);

-- Acesso da empresa ao portal (sistema antigo). senha_hash vem da migration 20261023210000.
CREATE TABLE IF NOT EXISTS dna_work.usuario_empresa (
  id_u character varying(40) PRIMARY KEY,
  nome_u character varying(255),
  email_u character varying(255),
  senha_u character varying(40),
  telefone_u character varying(20),
  empresa_u character varying(40),
  status integer,
  tipo integer,
  data_senha character varying(20),
  atualiza_senha integer,
  senha_envio text
);

-- Outras empresas que o mesmo usuário do portal pode acessar.
CREATE TABLE IF NOT EXISTS dna_work.vinculo_empresa_usuario (
  id_empresa character varying(40),
  id_usuario character varying(40)
);

-- Endereço de cada vaga (copiado do endereço da empresa; ligado pelo comparador).
CREATE TABLE IF NOT EXISTS dna_work.vaga_endereco (
  comparador character varying(30),
  logradouro character varying(255),
  numero character varying(10),
  complemento character varying(255),
  bairro character varying(255),
  cidade character varying(255),
  uf character varying(22),
  cep character varying(20),
  empresa integer
);

-- Vaga publicada para a triagem (id = dna_work.vaga.id_vaga).
CREATE TABLE IF NOT EXISTS public.vaga (
  id uuid PRIMARY KEY,
  vaga_id uuid NOT NULL,
  grupo_id uuid NOT NULL,
  empresa_id uuid NOT NULL,
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
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  horario text,
  turno text,
  beneficios text,
  conducoes text,
  jornada text,
  tipo_trabalho text,
  cep text,
  latitude double precision,
  longitude double precision,
  cargo_id uuid,
  descricao text,
  requisitos text
);

-- Cópia da empresa usada pela triagem (mesmo id da dna_work.empresa).
CREATE TABLE IF NOT EXISTS public.empresa (
  id uuid PRIMARY KEY,
  grupo_id uuid NOT NULL,
  cnpj text,
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL,
  email text,
  telefone text,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  latitude double precision,
  longitude double precision,
  local text
);

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

-- Prioridade da vaga (prisma/migrations/20261112200000_vaga_prioridade).
ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS prioridade varchar(5) NOT NULL DEFAULT 'media'
    CONSTRAINT vaga_prioridade_valida CHECK (prioridade IN ('alta', 'media', 'baixa'));

-- Colunas do sistema antigo que existem na produção (copiadas de lá em 2026-11-26).
-- Todas aceitam vazio; ficam aqui para a base de teste ter as mesmas colunas que o código lê e grava.

ALTER TABLE dna_work.candidato
  ADD COLUMN IF NOT EXISTS ra character varying(20),
  ADD COLUMN IF NOT EXISTS recado character varying(150),
  ADD COLUMN IF NOT EXISTS tel2 character varying(20),
  ADD COLUMN IF NOT EXISTS recado2 character varying(150),
  ADD COLUMN IF NOT EXISTS operadora character varying(150),
  ADD COLUMN IF NOT EXISTS foto character varying(100),
  ADD COLUMN IF NOT EXISTS nomepai character varying(255),
  ADD COLUMN IF NOT EXISTS nomemae character varying(255),
  ADD COLUMN IF NOT EXISTS inicioestudo character varying(20),
  ADD COLUMN IF NOT EXISTS terminoestudo character varying(20),
  ADD COLUMN IF NOT EXISTS completou_estudos integer,
  ADD COLUMN IF NOT EXISTS casapropia integer,
  ADD COLUMN IF NOT EXISTS fumante integer,
  ADD COLUMN IF NOT EXISTS regiao character varying(50),
  ADD COLUMN IF NOT EXISTS quantfilhos character varying(50),
  ADD COLUMN IF NOT EXISTS data_adicao timestamp without time zone,
  ADD COLUMN IF NOT EXISTS campus character varying(255),
  ADD COLUMN IF NOT EXISTS senha character varying(255),
  ADD COLUMN IF NOT EXISTS usanomesocial integer,
  ADD COLUMN IF NOT EXISTS nomesocial character varying(255),
  ADD COLUMN IF NOT EXISTS etnia bytea,
  ADD COLUMN IF NOT EXISTS rendafamiliar character varying(50),
  ADD COLUMN IF NOT EXISTS orientacao_sexual integer,
  ADD COLUMN IF NOT EXISTS deficiencia integer,
  ADD COLUMN IF NOT EXISTS tipo_deficiancia integer,
  ADD COLUMN IF NOT EXISTS necessidades integer,
  ADD COLUMN IF NOT EXISTS localcad integer,
  ADD COLUMN IF NOT EXISTS ano_escolar character varying(1),
  ADD COLUMN IF NOT EXISTS responsavel character varying(2),
  ADD COLUMN IF NOT EXISTS nome_responsavel character varying(200),
  ADD COLUMN IF NOT EXISTS email_responsavel character varying(255),
  ADD COLUMN IF NOT EXISTS celular_responsavel character varying(40),
  ADD COLUMN IF NOT EXISTS cpf_responsavel character varying(20),
  ADD COLUMN IF NOT EXISTS orientador_curso character varying(255),
  ADD COLUMN IF NOT EXISTS coordenador_curso character varying(255),
  ADD COLUMN IF NOT EXISTS atualiza_senha integer,
  ADD COLUMN IF NOT EXISTS data_senha character varying(20),
  ADD COLUMN IF NOT EXISTS cpf_conta character varying(50),
  ADD COLUMN IF NOT EXISTS lat character varying(20),
  ADD COLUMN IF NOT EXISTS lng character varying(20),
  ADD COLUMN IF NOT EXISTS tem_curso_extra integer,
  ADD COLUMN IF NOT EXISTS objetivo text,
  ADD COLUMN IF NOT EXISTS nivel_cargo character varying(1),
  ADD COLUMN IF NOT EXISTS catho_id character varying(20),
  ADD COLUMN IF NOT EXISTS indicacao character varying(100),
  ADD COLUMN IF NOT EXISTS pretencao_salarial real,
  ADD COLUMN IF NOT EXISTS vagas_pretendidas character varying(100),
  ADD COLUMN IF NOT EXISTS wp_atu character varying(1),
  ADD COLUMN IF NOT EXISTS curriculum character varying(255),
  ADD COLUMN IF NOT EXISTS objetivo_experiencia integer,
  ADD COLUMN IF NOT EXISTS fonte_busca character varying(150),
  ADD COLUMN IF NOT EXISTS usuario integer,
  ADD COLUMN IF NOT EXISTS hora_cadastro character varying(10),
  ADD COLUMN IF NOT EXISTS nome_acento character varying(255),
  ADD COLUMN IF NOT EXISTS celular_padrao character varying(20),
  ADD COLUMN IF NOT EXISTS frequencia_escolar character varying(255),
  ADD COLUMN IF NOT EXISTS senha_hash character varying;

ALTER TABLE dna_work.colaborador
  ADD COLUMN IF NOT EXISTS banco_horas character varying(10),
  ADD COLUMN IF NOT EXISTS pin integer,
  ADD COLUMN IF NOT EXISTS carga_base integer,
  ADD COLUMN IF NOT EXISTS status_ponto integer,
  ADD COLUMN IF NOT EXISTS status_desempenho integer,
  ADD COLUMN IF NOT EXISTS tolerancia character varying(20),
  ADD COLUMN IF NOT EXISTS refeicao_flutuante integer,
  ADD COLUMN IF NOT EXISTS supervisor_avaliacao character varying(255),
  ADD COLUMN IF NOT EXISTS e_social character varying(30),
  ADD COLUMN IF NOT EXISTS data_desligamento character varying;

ALTER TABLE dna_work.empresa
  ADD COLUMN IF NOT EXISTS crm character varying(40),
  ADD COLUMN IF NOT EXISTS im character varying(30),
  ADD COLUMN IF NOT EXISTS ramoatividade character varying(100),
  ADD COLUMN IF NOT EXISTS faturamento integer,
  ADD COLUMN IF NOT EXISTS rg_responsavel character varying(150),
  ADD COLUMN IF NOT EXISTS cpf_responsavel character varying(150),
  ADD COLUMN IF NOT EXISTS nacionalidade_responsavel character varying(100),
  ADD COLUMN IF NOT EXISTS estadocivil_responsavel character varying(100),
  ADD COLUMN IF NOT EXISTS supervisor character varying(150),
  ADD COLUMN IF NOT EXISTS rg_supervisor character varying(150),
  ADD COLUMN IF NOT EXISTS cpf_supervisor character varying(150),
  ADD COLUMN IF NOT EXISTS cargo_supervisor character varying(100),
  ADD COLUMN IF NOT EXISTS formacao_supervisor character varying(200),
  ADD COLUMN IF NOT EXISTS nacionalidade_supervidor character varying(100),
  ADD COLUMN IF NOT EXISTS estadocivil_supervisor character varying(100),
  ADD COLUMN IF NOT EXISTS sede integer,
  ADD COLUMN IF NOT EXISTS logo character varying(200),
  ADD COLUMN IF NOT EXISTS datafechamento character varying(100),
  ADD COLUMN IF NOT EXISTS logradouro_entrevista character varying(255),
  ADD COLUMN IF NOT EXISTS numero_entrevista character varying(10),
  ADD COLUMN IF NOT EXISTS complemento_entrevista character varying(100),
  ADD COLUMN IF NOT EXISTS bairro_entrevista character varying(50),
  ADD COLUMN IF NOT EXISTS cidade_entrevista character varying(100),
  ADD COLUMN IF NOT EXISTS uf_entrevista character varying(5),
  ADD COLUMN IF NOT EXISTS cep_entrevista character varying(12),
  ADD COLUMN IF NOT EXISTS usuario character varying(40),
  ADD COLUMN IF NOT EXISTS treinamento character varying(40),
  ADD COLUMN IF NOT EXISTS quantfuncionario character varying(5),
  ADD COLUMN IF NOT EXISTS mesmoendereco integer,
  ADD COLUMN IF NOT EXISTS formacao_responsavel character varying(255),
  ADD COLUMN IF NOT EXISTS cargo_responsavel character varying(255),
  ADD COLUMN IF NOT EXISTS mesmosupervisor integer,
  ADD COLUMN IF NOT EXISTS vencimento character varying(5),
  ADD COLUMN IF NOT EXISTS nome_confidencial integer,
  ADD COLUMN IF NOT EXISTS identificacao character varying(255),
  ADD COLUMN IF NOT EXISTS nome_administrativo character varying(255),
  ADD COLUMN IF NOT EXISTS cpf_administrativo character varying(20),
  ADD COLUMN IF NOT EXISTS email_administrativo character varying(255),
  ADD COLUMN IF NOT EXISTS telefone_administrativo character varying(20),
  ADD COLUMN IF NOT EXISTS celular_administrativo character varying(20),
  ADD COLUMN IF NOT EXISTS nome_financeiro character varying(255),
  ADD COLUMN IF NOT EXISTS cpf_financeiro character varying(20),
  ADD COLUMN IF NOT EXISTS email_financeiro character varying(255),
  ADD COLUMN IF NOT EXISTS telefone_financeiro character varying(20),
  ADD COLUMN IF NOT EXISTS celular_financeiro character varying(20),
  ADD COLUMN IF NOT EXISTS nome_rh character varying(255),
  ADD COLUMN IF NOT EXISTS cpf_rh character varying(20),
  ADD COLUMN IF NOT EXISTS email_rh character varying(255),
  ADD COLUMN IF NOT EXISTS telefone_rh character varying(20),
  ADD COLUMN IF NOT EXISTS celular_rh character varying(20),
  ADD COLUMN IF NOT EXISTS lat character varying(20),
  ADD COLUMN IF NOT EXISTS lng character varying(20),
  ADD COLUMN IF NOT EXISTS usa_agente integer,
  ADD COLUMN IF NOT EXISTS apolice_seguro character varying(50),
  ADD COLUMN IF NOT EXISTS recrutamento integer,
  ADD COLUMN IF NOT EXISTS ponto integer,
  ADD COLUMN IF NOT EXISTS desepenho character varying(1),
  ADD COLUMN IF NOT EXISTS "CNO" character varying(14),
  ADD COLUMN IF NOT EXISTS justificativas_ponto character varying(3),
  ADD COLUMN IF NOT EXISTS controle_consultor character varying(255),
  ADD COLUMN IF NOT EXISTS nota_fiscal character varying(200),
  ADD COLUMN IF NOT EXISTS email_boa_vindas integer,
  ADD COLUMN IF NOT EXISTS instrucao text,
  ADD COLUMN IF NOT EXISTS forma_comissao character varying(20),
  ADD COLUMN IF NOT EXISTS valor_comisao_empresa character varying(20),
  ADD COLUMN IF NOT EXISTS fantasia_sem_acento character varying(255),
  ADD COLUMN IF NOT EXISTS razao_sem_acento character varying(255);

ALTER TABLE dna_work.modalidade_vaga
  ADD COLUMN IF NOT EXISTS id_menu integer,
  ADD COLUMN IF NOT EXISTS id_menuempresa integer,
  ADD COLUMN IF NOT EXISTS carga_horaria character varying(50),
  ADD COLUMN IF NOT EXISTS idade_minima integer,
  ADD COLUMN IF NOT EXISTS idade_maxima integer,
  ADD COLUMN IF NOT EXISTS praso integer,
  ADD COLUMN IF NOT EXISTS por_hora integer,
  ADD COLUMN IF NOT EXISTS validacao integer,
  ADD COLUMN IF NOT EXISTS relatorio integer,
  ADD COLUMN IF NOT EXISTS dias_relatorio integer,
  ADD COLUMN IF NOT EXISTS modelo_relatorio integer;

ALTER TABLE dna_work.rescisao_documento
  ADD COLUMN IF NOT EXISTS assinatura character varying(80) DEFAULT 'Não assina digitalmente'::character varying,
  ADD COLUMN IF NOT EXISTS zapsign_token character varying(120),
  ADD COLUMN IF NOT EXISTS sign_url text,
  ADD COLUMN IF NOT EXISTS signatarios text,
  ADD COLUMN IF NOT EXISTS preview_url text,
  ADD COLUMN IF NOT EXISTS enviado_em timestamp without time zone;

ALTER TABLE dna_work.vaga
  ADD COLUMN IF NOT EXISTS nivel_cargo integer,
  ADD COLUMN IF NOT EXISTS experiencia integer,
  ADD COLUMN IF NOT EXISTS dsalario integer,
  ADD COLUMN IF NOT EXISTS limidade integer,
  ADD COLUMN IF NOT EXISTS idade character varying(3),
  ADD COLUMN IF NOT EXISTS idadeate character varying(3),
  ADD COLUMN IF NOT EXISTS limcand character varying(5),
  ADD COLUMN IF NOT EXISTS fumante integer,
  ADD COLUMN IF NOT EXISTS pausa_almoco character varying(5),
  ADD COLUMN IF NOT EXISTS semanas_inicio integer,
  ADD COLUMN IF NOT EXISTS semanas_fim integer,
  ADD COLUMN IF NOT EXISTS horabase character varying(5),
  ADD COLUMN IF NOT EXISTS hora_saida_base character varying(5),
  ADD COLUMN IF NOT EXISTS segunda_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS segunda_saida character varying(5),
  ADD COLUMN IF NOT EXISTS terca_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS terca_saida character varying(5),
  ADD COLUMN IF NOT EXISTS quarta_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS quarta_saida character varying(5),
  ADD COLUMN IF NOT EXISTS quinta_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS quinta_saida character varying(5),
  ADD COLUMN IF NOT EXISTS sexta_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS sexta_saida character varying(5),
  ADD COLUMN IF NOT EXISTS sab_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS sab_saida character varying(5),
  ADD COLUMN IF NOT EXISTS domindo_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS domindo_saida character varying(5),
  ADD COLUMN IF NOT EXISTS feriados_saida character varying(5),
  ADD COLUMN IF NOT EXISTS feriados_entrada character varying(5),
  ADD COLUMN IF NOT EXISTS conhecimentos character varying(255),
  ADD COLUMN IF NOT EXISTS sede integer,
  ADD COLUMN IF NOT EXISTS dataocupacao character varying(11),
  ADD COLUMN IF NOT EXISTS responsavel character varying(255),
  ADD COLUMN IF NOT EXISTS escolaridade character varying(100),
  ADD COLUMN IF NOT EXISTS escolaridade_completo integer,
  ADD COLUMN IF NOT EXISTS dataencerramento character varying(20),
  ADD COLUMN IF NOT EXISTS periodo character varying(50),
  ADD COLUMN IF NOT EXISTS vale_transporte character varying(100),
  ADD COLUMN IF NOT EXISTS beneficios character varying(255),
  ADD COLUMN IF NOT EXISTS beneficios_valor character varying(255),
  ADD COLUMN IF NOT EXISTS beneficios_tipo character varying(255),
  ADD COLUMN IF NOT EXISTS regiao character varying(100),
  ADD COLUMN IF NOT EXISTS exigencias text,
  ADD COLUMN IF NOT EXISTS f_valetranporte integer,
  ADD COLUMN IF NOT EXISTS valor_valetransporte character varying(10),
  ADD COLUMN IF NOT EXISTS f_integracao integer,
  ADD COLUMN IF NOT EXISTS tempo_refeicao character varying(6),
  ADD COLUMN IF NOT EXISTS tipo_vale_transporte character varying(2),
  ADD COLUMN IF NOT EXISTS horario_varialvel integer,
  ADD COLUMN IF NOT EXISTS texto_carga character varying(255),
  ADD COLUMN IF NOT EXISTS pagamento_hora integer,
  ADD COLUMN IF NOT EXISTS periculosidade integer,
  ADD COLUMN IF NOT EXISTS insalubridade integer,
  ADD COLUMN IF NOT EXISTS desconta_transporte integer,
  ADD COLUMN IF NOT EXISTS desconta_refeicao integer,
  ADD COLUMN IF NOT EXISTS f_refeicao integer,
  ADD COLUMN IF NOT EXISTS tipo_refeicao character varying(2),
  ADD COLUMN IF NOT EXISTS valor_refeicao character varying(10),
  ADD COLUMN IF NOT EXISTS codigo character varying(20),
  ADD COLUMN IF NOT EXISTS cobranca_valor character varying(20),
  ADD COLUMN IF NOT EXISTS adm_folha integer,
  ADD COLUMN IF NOT EXISTS temporario integer,
  ADD COLUMN IF NOT EXISTS cobrar_selecao character varying(10),
  ADD COLUMN IF NOT EXISTS cobrar_folha character varying(10),
  ADD COLUMN IF NOT EXISTS faturar_vaga integer,
  ADD COLUMN IF NOT EXISTS peso_fit_tecnico integer,
  ADD COLUMN IF NOT EXISTS peso_fit_basico integer,
  ADD COLUMN IF NOT EXISTS peso_fit_comportamental integer,
  ADD COLUMN IF NOT EXISTS peso_fit_escolar integer,
  ADD COLUMN IF NOT EXISTS peso_fit_cargo integer,
  ADD COLUMN IF NOT EXISTS peso_cargo integer,
  ADD COLUMN IF NOT EXISTS perfil1 character varying(10),
  ADD COLUMN IF NOT EXISTS perfil2 character varying(10),
  ADD COLUMN IF NOT EXISTS perfil_candidato character varying(30),
  ADD COLUMN IF NOT EXISTS salario_combinar integer,
  ADD COLUMN IF NOT EXISTS pcd integer,
  ADD COLUMN IF NOT EXISTS remoto integer,
  ADD COLUMN IF NOT EXISTS motivo character varying(20),
  ADD COLUMN IF NOT EXISTS catho integer,
  ADD COLUMN IF NOT EXISTS tipo_pcd character varying(20),
  ADD COLUMN IF NOT EXISTS divulgado_escolas character varying(2),
  ADD COLUMN IF NOT EXISTS "divuçgado_candidato" character varying(2),
  ADD COLUMN IF NOT EXISTS jornada integer,
  ADD COLUMN IF NOT EXISTS destacada integer,
  ADD COLUMN IF NOT EXISTS data_limite character varying(20),
  ADD COLUMN IF NOT EXISTS entrege_agente integer,
  ADD COLUMN IF NOT EXISTS data_empresa_limite character varying(20),
  ADD COLUMN IF NOT EXISTS entrege_empresa integer,
  ADD COLUMN IF NOT EXISTS responsavel_agente integer,
  ADD COLUMN IF NOT EXISTS faturar character varying(1),
  ADD COLUMN IF NOT EXISTS colaborador_repor character varying(40),
  ADD COLUMN IF NOT EXISTS vaga_reposicao character varying(30),
  ADD COLUMN IF NOT EXISTS data_status character varying(20),
  ADD COLUMN IF NOT EXISTS modelo_carga_horaria character varying(3),
  ADD COLUMN IF NOT EXISTS cidade character varying;

