/**
 * Usuário legado "DNA Work" (u_id 90, login suporte).
 * Quando a vaga é efetivada por essa conta, a DNA só formaliza o contrato:
 * quem contratou foi a própria empresa.
 * Ketly (u_id 153) e os demais recrutadores internos são vaga da DNA.
 */
export const USUARIO_FORMALIZACAO = 90;
export const USUARIO_KETLY = 153;

export type OrigemEfetivacao = "dnawork" | "empresa" | "nao_identificado";

export function origemEfetivacao(responsavelAgente: number | null | undefined): OrigemEfetivacao {
  if (responsavelAgente == null || responsavelAgente === 0) return "nao_identificado";
  if (responsavelAgente === USUARIO_FORMALIZACAO) return "empresa";
  return "dnawork";
}

export const ORIGEM_EFETIVACAO_SQL = `CASE
  WHEN v.responsavel_agente = ${USUARIO_FORMALIZACAO} THEN 'empresa'
  WHEN v.responsavel_agente IS NOT NULL AND v.responsavel_agente <> 0 THEN 'dnawork'
  ELSE COALESCE((
    SELECT p.origem FROM dna_work.processo_seletivo p
    WHERE p.id_contratacao = cv.id_contratacao AND p.origem IN ('dnawork', 'empresa')
    ORDER BY p.criado_em DESC
    LIMIT 1
  ), 'nao_identificado')
END`;

export const EFETIVADO_POR_SQL = `COALESCE(u.u_nome, CASE v.responsavel_agente
  WHEN ${USUARIO_FORMALIZACAO} THEN 'DNA Work'
  WHEN ${USUARIO_KETLY} THEN 'Ketly Carvalho da Silva'
END)`;
