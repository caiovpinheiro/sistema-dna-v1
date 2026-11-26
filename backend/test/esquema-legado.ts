import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Completa o banco de teste criado por `database/schema/local-dev.sql`, que ficou para trás do esquema de produção.
 * O código usa colunas e tabelas que em produção vêm do banco legado ou das migrations do repositório
 * (ex.: dna_work.vaga.km, dna_work.candidato.atendimento, public.empresa). Sem isto, as suítes que montam um
 * Postgres próprio a partir só do local-dev.sql falham com "column ... does not exist" (já falhavam antes do MCP).
 * Só acrescenta estrutura; nenhuma regra de negócio e nenhum critério de teste mudam.
 */
export async function completarEsquemaLegado(cliente: pg.Client): Promise<void> {
  const ler = (arquivo: string) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
  // Espelho do cadastro (public.*), versionado no repositório.
  await cliente.query(ler("database/migrations/006_cadastro_espelho_supabase.sql"));
  // Colunas do banco legado (dna_work) que o local-dev.sql não traz.
  await cliente.query(`
    ALTER TABLE dna_work.vaga
      ADD COLUMN IF NOT EXISTS codigo text, ADD COLUMN IF NOT EXISTS texto_carga text, ADD COLUMN IF NOT EXISTS horabase text,
      ADD COLUMN IF NOT EXISTS hora_saida_base text, ADD COLUMN IF NOT EXISTS beneficios_texto text, ADD COLUMN IF NOT EXISTS comparador text,
      ADD COLUMN IF NOT EXISTS atribuicaoes text, ADD COLUMN IF NOT EXISTS atribu_contrato text, ADD COLUMN IF NOT EXISTS requisitos_desejaveis text,
      ADD COLUMN IF NOT EXISTS destaque text, ADD COLUMN IF NOT EXISTS km text,
      ADD COLUMN IF NOT EXISTS sexo text, ADD COLUMN IF NOT EXISTS idade text, ADD COLUMN IF NOT EXISTS idadeate text,
      ADD COLUMN IF NOT EXISTS segunda_entrada text, ADD COLUMN IF NOT EXISTS segunda_saida text, ADD COLUMN IF NOT EXISTS terca_entrada text, ADD COLUMN IF NOT EXISTS terca_saida text,
      ADD COLUMN IF NOT EXISTS quarta_entrada text, ADD COLUMN IF NOT EXISTS quarta_saida text, ADD COLUMN IF NOT EXISTS quinta_entrada text, ADD COLUMN IF NOT EXISTS quinta_saida text,
      ADD COLUMN IF NOT EXISTS sexta_entrada text, ADD COLUMN IF NOT EXISTS sexta_saida text, ADD COLUMN IF NOT EXISTS sab_entrada text, ADD COLUMN IF NOT EXISTS sab_saida text,
      ADD COLUMN IF NOT EXISTS domindo_entrada text, ADD COLUMN IF NOT EXISTS domindo_saida text, ADD COLUMN IF NOT EXISTS modalidade integer;
    CREATE TABLE IF NOT EXISTS dna_work.usuario_empresa (id_u character varying PRIMARY KEY, nome_u character varying, email_u character varying, senha_u character varying, empresa_u character varying, status integer DEFAULT 1, atualiza_senha integer, senha_envio character varying);
    CREATE TABLE IF NOT EXISTS dna_work.vaga_endereco (comparador text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text, cep text);
    CREATE TABLE IF NOT EXISTS dna_work.beneficio (id int, beneficios text);
    CREATE TABLE IF NOT EXISTS dna_work.beneficio_vaga (id_vaga text, id_beneficio int);
    ALTER TABLE dna_work.candidato ADD COLUMN IF NOT EXISTS data_adicao timestamp;
    ALTER TABLE dna_work.empresa ADD COLUMN IF NOT EXISTS data_adicao timestamp;
  `);
  // Migrations do repositório que acrescentam colunas às tabelas acima (só as de estrutura, na ordem).
  const pasta = path.join(raiz, "prisma/migrations");
  for (const nome of fs.readdirSync(pasta).filter((n) => /^\d{14}_/.test(n)).sort()) {
    if (nome.endsWith("_baseline") || nome.includes("_mcp_")) continue;
    try { await cliente.query(ler(`prisma/migrations/${nome}/migration.sql`)); } catch { /* depende de tabela legada que o banco de teste não tem */ }
  }
}

/**
 * O Postgres embutido nasce com a localidade "C": lower()/upper() não tratam letras acentuadas (Ã, É…) e a pesquisa
 * "sem acento" falha. Produção usa UTF-8. Estas flags do initdb alinham o banco de teste (só ambiente de teste).
 */
export const INICIAR_UTF8 = ["--encoding=UTF8", "--locale=C.UTF-8"];
