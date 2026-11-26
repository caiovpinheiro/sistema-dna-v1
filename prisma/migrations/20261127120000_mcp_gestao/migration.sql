-- MCP (Fase 4): gestão administrativa e abrangência de dados. Migration só aditiva.
-- Levantamento de vínculos reais (docs/mcp/abrangencia.md): o banco NÃO registra responsável, dono, criador nem equipe
-- em candidato, processo, contratação ou dossiê. Por isso "próprios" e "equipe" não existem como abrangência.
-- Disponíveis: nenhuma (padrão), autorizados (lista explícita de candidatos e empresas) e todos.

ALTER TABLE dna_work.mcp_integracao
  ADD COLUMN IF NOT EXISTS finalidade text;

-- Abrangência do usuário NESTA integração. Padrão `nenhuma`: ferramentas com dados individuais ficam bloqueadas
-- até o administrador conceder. Vínculos que já existiam (fases anteriores) também ficam em `nenhuma`.
ALTER TABLE dna_work.mcp_integracao_usuario
  ADD COLUMN IF NOT EXISTS abrangencia character varying(20) NOT NULL DEFAULT 'nenhuma';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_integracao_usuario_abrangencia_chk') THEN
    ALTER TABLE dna_work.mcp_integracao_usuario
      ADD CONSTRAINT mcp_integracao_usuario_abrangencia_chk CHECK (abrangencia IN ('nenhuma', 'autorizados', 'todos'));
  END IF;
END $$;

-- Registros expressamente autorizados (abrangência `autorizados`). Só ids: nenhum dado pessoal é copiado para cá.
CREATE TABLE IF NOT EXISTS dna_work.mcp_integracao_usuario_registro (
  id_integracao uuid NOT NULL,
  id_usuario uuid NOT NULL,
  tipo character varying(20) NOT NULL CHECK (tipo IN ('candidato', 'empresa')),
  id_registro character varying(64) NOT NULL,
  criado_em timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id_integracao, id_usuario, tipo, id_registro),
  FOREIGN KEY (id_integracao, id_usuario)
    REFERENCES dna_work.mcp_integracao_usuario (id_integracao, id_usuario) ON DELETE CASCADE
);
