import type { Pool, PoolClient } from "pg";
import { AppError } from "./errors.js";
import { condicaoPorPalavras, palavrasDaBusca } from "./busca-texto.js";

/**
 * Empresa cobrada pelo CNPJ de outra (filial cobrada pela matriz).
 *
 * É o mesmo esquema das filiais que já existiam no sistema antigo (Confiança, Flex, Enxuto): a unidade
 * fica com `matriz` = empresa que paga, `usa_asaas` = 2, `tipo_empresa` = 2 e o mesmo fechamento da
 * matriz. O faturamento junta a unidade na matriz, o boleto sai no CNPJ dela, o relatório consolidado
 * mostra a coluna Unidade e a régua manda para o e-mail da matriz. A vaga continua com o endereço da
 * própria unidade.
 *
 * Para o faturamento achar o preço, a unidade também precisa das condições de cobrança: as linhas de
 * `dna_work.faturamento_empresa` (uma por modalidade) e a de `public.valor_empresas`. As que faltarem
 * são copiadas da empresa que paga; as que a unidade já tiver não são trocadas.
 */

export type Pagadora = {
  id: string;
  nome: string;
  razao_social: string | null;
  cnpj: string;
  grupo_id: string | null;
};

type Executor = Pool | PoolClient;

/**
 * SQL do CNPJ que vai nos documentos (TCE, termos, contrato): o da própria empresa; sem CNPJ, o da
 * empresa que paga por ela. `tabela` é o alias (ou o nome) de `dna_work.empresa` na consulta.
 */
export function cnpjParaDocumento(tabela: string) {
  return `CASE WHEN regexp_replace(coalesce(${tabela}.cnpj::text, ''), '\\D', '', 'g') <> '' THEN ${tabela}.cnpj::text
    ELSE (SELECT pagadora.cnpj::text FROM dna_work.empresa pagadora
           WHERE pagadora.id_empresa::text = ${tabela}.matriz::text AND pagadora.id_empresa::text <> ${tabela}.id_empresa::text
           LIMIT 1) END`;
}

/**
 * Empresas que podem pagar por outra: ativas, com CNPJ e faturadas por elas mesmas (`usa_asaas` = 1,
 * ou 2 sendo a própria matriz, como algumas matrizes antigas ficaram gravadas).
 */
const PODE_PAGAR = `e.status::text = '1'
  AND regexp_replace(coalesce(e.cnpj, ''), '\\D', '', 'g') <> ''
  AND (e.usa_asaas::text = '1' OR (e.usa_asaas::text = '2' AND e.matriz::text = e.id_empresa::text))`;

export async function listarPagadoras(db: Executor, filtro: { q?: string; grupo?: string; excluir?: string }) {
  const { rows } = await db.query<Pagadora & { mesmo_grupo: boolean }>(`
    SELECT e.id_empresa::text AS id,
           trim(coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social)) AS nome,
           e.razao_social, e.cnpj, pe.grupo_id::text AS grupo_id,
           coalesce(pe.grupo_id::text = $2, false) AS mesmo_grupo
      FROM dna_work.empresa e
      LEFT JOIN public.empresa pe ON pe.id::text = e.id_empresa::text
     WHERE ${PODE_PAGAR}
       AND ($3 = '' OR e.id_empresa::text <> $3)
       AND ${condicaoPorPalavras(["e.razao_social", "e.nome_fantasia"], "$1", ["e.cnpj"])}
     ORDER BY mesmo_grupo DESC, nome
     LIMIT 300
  `, [palavrasDaBusca(filtro.q), filtro.grupo ?? "", filtro.excluir ?? ""]);
  return rows;
}

/** A empresa que paga por esta (ou null, quando ela mesma é cobrada). */
export async function pagadoraDe(db: Executor, idEmpresa: string): Promise<Pagadora | null> {
  const { rows } = await db.query<Pagadora>(`
    SELECT m.id_empresa::text AS id,
           trim(coalesce(nullif(trim(m.nome_fantasia), ''), m.razao_social)) AS nome,
           m.razao_social, m.cnpj, pe.grupo_id::text AS grupo_id
      FROM dna_work.empresa e
      JOIN dna_work.empresa m ON m.id_empresa::text = e.matriz::text
      LEFT JOIN public.empresa pe ON pe.id::text = m.id_empresa::text
     WHERE e.id_empresa::text = $1
       AND e.usa_asaas::text = '2'
       AND m.id_empresa::text <> e.id_empresa::text
     LIMIT 1
  `, [idEmpresa]);
  return rows[0] ?? null;
}

async function validarPagadora(db: Executor, idPagadora: string, idUnidade: string) {
  if (idPagadora === idUnidade) {
    throw new AppError(422, "COBRANCA_INVALIDA", "A empresa não pode ser cobrada por ela mesma. Deixe o campo em branco.");
  }
  const { rows } = await db.query<{ id: string; nome: string; cnpj: string | null; usa_asaas: string | null; status: string | null; propria_matriz: boolean | null }>(`
    SELECT e.id_empresa::text AS id, trim(coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social)) AS nome,
           e.cnpj, e.usa_asaas::text AS usa_asaas, e.status::text AS status,
           (e.matriz::text = e.id_empresa::text) AS propria_matriz
      FROM dna_work.empresa e WHERE e.id_empresa::text = $1
  `, [idPagadora]);
  const pagadora = rows[0];
  if (!pagadora) throw new AppError(422, "COBRANCA_INVALIDA", "A empresa escolhida para a cobrança não existe.");
  if (!(pagadora.cnpj ?? "").replace(/\D/g, "")) {
    throw new AppError(422, "COBRANCA_SEM_CNPJ", `A empresa "${pagadora.nome}" não tem CNPJ e não pode pagar por outra.`);
  }
  const faturadaPelaPropria = pagadora.usa_asaas === "1" || (pagadora.usa_asaas === "2" && pagadora.propria_matriz === true);
  if (pagadora.status !== "1" || !faturadaPelaPropria) {
    throw new AppError(422, "COBRANCA_NAO_FATURADA", `A empresa "${pagadora.nome}" não é faturada por ela mesma (ou está inativa). Escolha a empresa que recebe o boleto.`);
  }
  return pagadora;
}

/**
 * Liga a unidade à empresa que paga e copia as condições de cobrança que faltarem.
 * Rode dentro de uma transação (`client` com BEGIN): mexe em três tabelas.
 */
export async function cobrarPela(client: PoolClient, idUnidade: string, idPagadora: string, nomeUnidade: string) {
  const pagadora = await validarPagadora(client, idPagadora, idUnidade);
  await client.query(`
    UPDATE dna_work.empresa
       SET matriz = $2::text, usa_asaas = 2, tipo_empresa = 2, sede = 10,
           datafechamento = coalesce((SELECT datafechamento FROM dna_work.empresa WHERE id_empresa::text = $2::text), datafechamento)
     WHERE id_empresa::text = $1::text
  `, [idUnidade, pagadora.id]);

  // A tabela não tem sequência no id: trava para calcular os próximos sem colidir com outro cadastro ao mesmo tempo.
  await client.query("LOCK TABLE dna_work.faturamento_empresa IN SHARE ROW EXCLUSIVE MODE");
  await client.query(`
    INSERT INTO dna_work.faturamento_empresa (
      id, id_empresa, tipo, id_tabela, cobra_recorrente, valor, modalidade_vaga, proporcional, folha, data_corte, ultiliza,
      data_conte_final, dias_cortesia, cobra_selecao, tipo_selecao, valor_selecao, valor_folha, cobra_comissao, tipo_comissao,
      valor_comissao, treinamento, tipo_treinamento, valor_treinamento, comissao_recrutamento, tipo_comissao_recrutamento,
      valor_comissao_recrutamento
    )
    SELECT (SELECT coalesce(max(id), 0) FROM dna_work.faturamento_empresa) + row_number() OVER (ORDER BY f.id),
           $1::text, f.tipo, f.id_tabela, f.cobra_recorrente, f.valor, f.modalidade_vaga, f.proporcional, f.folha, f.data_corte, f.ultiliza,
           f.data_conte_final, f.dias_cortesia, f.cobra_selecao, f.tipo_selecao, f.valor_selecao, f.valor_folha, f.cobra_comissao, f.tipo_comissao,
           f.valor_comissao, f.treinamento, f.tipo_treinamento, f.valor_treinamento, f.comissao_recrutamento, f.tipo_comissao_recrutamento,
           f.valor_comissao_recrutamento
      FROM dna_work.faturamento_empresa f
     WHERE f.id_empresa::text = $2
       AND NOT EXISTS (
         SELECT 1 FROM dna_work.faturamento_empresa u
          WHERE u.id_empresa::text = $1 AND u.modalidade_vaga::text IS NOT DISTINCT FROM f.modalidade_vaga::text
       )
  `, [idUnidade, pagadora.id]);

  // O CNPJ guardado nas condições é o de quem paga: é nele que o boleto sai.
  await client.query(`
    INSERT INTO public.valor_empresas (
      id_empresa, cnpj, nome, razao_social, tipo, cadastro, servicos, clt_modelo, clt_valor, clt_taxa, clt_calculo, clt_status,
      est_modelo, est_mensal, est_rs, est_taxa, est_calculo, est_status, ciclo, fechamento_dia, vencimento_dia, notas, alertas, documentos
    )
    SELECT $1::text, v.cnpj, $3::text, v.razao_social, 'Filial', v.cadastro, v.servicos, v.clt_modelo, v.clt_valor, v.clt_taxa, v.clt_calculo, v.clt_status,
           v.est_modelo, v.est_mensal, v.est_rs, v.est_taxa, v.est_calculo, v.est_status, v.ciclo, v.fechamento_dia, v.vencimento_dia,
           v.notas, v.alertas, v.documentos
      FROM public.valor_empresas v
     WHERE v.id_empresa = $2::text
    ON CONFLICT (id_empresa) DO NOTHING
  `, [idUnidade, pagadora.id, nomeUnidade]);
  return pagadora;
}

/** Volta a cobrar a própria empresa (só se ela tiver CNPJ). As condições de cobrança copiadas ficam como estão. */
export async function cobrarDaPropria(client: Executor, idUnidade: string) {
  const { rows } = await client.query<{ cnpj: string | null; usa_asaas: string | null }>(
    "SELECT cnpj, usa_asaas::text AS usa_asaas FROM dna_work.empresa WHERE id_empresa::text = $1",
    [idUnidade],
  );
  const atual = rows[0];
  if (!atual || atual.usa_asaas !== "2") return;
  if (!(atual.cnpj ?? "").replace(/\D/g, "")) {
    throw new AppError(422, "COBRANCA_OBRIGATORIA", "Empresa sem CNPJ precisa ser cobrada pelo CNPJ de outra empresa.");
  }
  await client.query(
    "UPDATE dna_work.empresa SET matriz = id_empresa, usa_asaas = 1, tipo_empresa = 1 WHERE id_empresa::text = $1",
    [idUnidade],
  );
}
