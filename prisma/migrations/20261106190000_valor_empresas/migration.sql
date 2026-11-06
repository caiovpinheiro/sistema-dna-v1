-- Condições de cobrança de cada empresa (contrato): só no Postgres.
-- O faturamento usa o preço daqui quando a modalidade está conferida (status 'ok'); sem isso, segue o cálculo antigo.
CREATE TABLE IF NOT EXISTS public.valor_empresas (
  id_empresa varchar(64) PRIMARY KEY,
  cnpj varchar(20) NOT NULL,
  nome text NOT NULL,
  razao_social text,
  tipo text,
  cadastro text,
  servicos text[] NOT NULL DEFAULT '{}',
  -- CLT: 'Percentual' (clt_valor = % do salário) ou 'Valor fixo' (clt_valor = R$ por contratação); outros = sem preço.
  clt_modelo text NOT NULL,
  clt_valor numeric(12, 2),
  clt_taxa text,
  clt_calculo text,
  clt_status text NOT NULL,
  -- Estágio: taxa mensal por estagiário e taxa única de R&S no 1º mês.
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
