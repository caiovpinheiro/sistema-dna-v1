-- Compatível com a base que já tem fatura_regua/fatura_envio e com a que ainda não tem.
-- Não recria cobrança nem empresa. Só acrescenta histórico e colunas de tentativa.

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

DO $$
BEGIN
  IF to_regclass('dna_work.fatura_envio') IS NOT NULL THEN
    ALTER TABLE dna_work.fatura_envio ADD COLUMN IF NOT EXISTS tentativas integer NOT NULL DEFAULT 0;
    ALTER TABLE dna_work.fatura_envio ADD COLUMN IF NOT EXISTS ultimo_erro text;
    ALTER TABLE dna_work.fatura_envio ADD COLUMN IF NOT EXISTS reservado_em timestamp with time zone;
  END IF;
END $$;
