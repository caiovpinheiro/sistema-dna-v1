import type { Pool } from "pg";
import type { AcessoService } from "../services/acesso.service.js";
import type { Ferramenta, RegistroFerramentas } from "./registro.js";

export type ContextoAcesso = {
  usuario: { id: string; nome: string };
  sessao: { admin: boolean; paginas: string[] };
  integracao: { id: string; slug: string; nome: string; instrucoes: string | null };
  /** Ferramentas ligadas na integração. */
  habilitadas: ReadonlySet<string>;
  /** Restrição individual: null = todas as da integração. */
  restritas: ReadonlySet<string> | null;
  permissoes: ReadonlySet<string>;
  escopos: ReadonlySet<string>;
};

export type FalhaAcesso = { status: 401 | 403 | 404; codigo: string; mensagem: string };
export type ResultadoAcesso = { ok: true; contexto: ContextoAcesso } | ({ ok: false } & FalhaAcesso);

const negar = (status: FalhaAcesso["status"], codigo: string, mensagem: string): ResultadoAcesso => ({ ok: false, status, codigo, mensagem });

/**
 * Autorização efetiva, recalculada do banco a cada chamada (nada em cache):
 * integração ativa ∧ usuário real e ativo ∧ vínculo usuário↔integração ∧ páginas/admin pelo AcessoService.
 * O campo `role` do JWT do painel nunca entra aqui: admin vem só do AcessoService.
 */
export async function carregarContexto(
  db: Pool,
  acesso: AcessoService,
  entrada: { usuarioId: string; slug: string; escopos: readonly string[] },
): Promise<ResultadoAcesso> {
  const { rows: integracoes } = await db.query<{ id: string; nome: string; instrucoes: string | null; ativa: boolean }>(
    "SELECT id, nome, instrucoes, ativa FROM dna_work.mcp_integracao WHERE slug = $1",
    [entrada.slug],
  );
  const integracao = integracoes[0];
  if (!integracao) return negar(404, "INTEGRACAO_NAO_ENCONTRADA", "Integração não encontrada.");
  if (!integracao.ativa) return negar(403, "INTEGRACAO_DESATIVADA", "Integração desativada.");

  const { rows: usuarios } = await db.query<{ id: string; nome: string; email: string; ativo: boolean }>(
    "SELECT id::text AS id, nome, email, ativo FROM dna_work.app_usuario WHERE id::text = $1",
    [entrada.usuarioId],
  );
  const usuario = usuarios[0];
  if (!usuario || !usuario.ativo) return negar(403, "USUARIO_INATIVO", "Usuário inativo ou inexistente.");

  const { rows: vinculos } = await db.query<{ ferramentas: string[] | null; permissoes: string[] }>(
    "SELECT ferramentas, permissoes FROM dna_work.mcp_integracao_usuario WHERE id_integracao = $1 AND id_usuario::text = $2",
    [integracao.id, usuario.id],
  );
  const vinculo = vinculos[0];
  if (!vinculo) return negar(403, "USUARIO_NAO_AUTORIZADO", "Usuário não autorizado nesta integração.");

  const sessao = await acesso.daSessao(usuario.id, usuario.email);
  if (!sessao.ativo) return negar(403, "USUARIO_INATIVO", "Usuário inativo ou inexistente.");

  const { rows: ferramentas } = await db.query<{ ferramenta: string }>(
    "SELECT ferramenta FROM dna_work.mcp_integracao_ferramenta WHERE id_integracao = $1",
    [integracao.id],
  );

  return {
    ok: true,
    contexto: {
      usuario: { id: usuario.id, nome: usuario.nome },
      sessao: { admin: sessao.admin, paginas: sessao.paginas },
      integracao: { id: integracao.id, slug: entrada.slug, nome: integracao.nome, instrucoes: integracao.instrucoes },
      habilitadas: new Set(ferramentas.map((linha) => linha.ferramenta)),
      restritas: vinculo.ferramentas ? new Set(vinculo.ferramentas) : null,
      permissoes: new Set(vinculo.permissoes),
      escopos: new Set(entrada.escopos),
    },
  };
}

/** A ferramenta é permitida para este contexto? Devolve o motivo da negativa (só para a auditoria). */
export function motivoDaNegativa(contexto: ContextoAcesso, ferramenta: Ferramenta): string | null {
  if (!contexto.habilitadas.has(ferramenta.nome)) return "ferramenta_fora_da_integracao";
  if (contexto.restritas && !contexto.restritas.has(ferramenta.nome)) return "ferramenta_fora_do_usuario";
  if (!contexto.escopos.has(ferramenta.escopo)) return "escopo_insuficiente";
  if (ferramenta.adminOnly && !contexto.sessao.admin) return "somente_admin";
  if (ferramenta.paginas.length && !contexto.sessao.admin && !ferramenta.paginas.some((pagina) => contexto.sessao.paginas.includes(pagina))) {
    return "pagina_sem_acesso";
  }
  return null;
}

export function ferramentasEfetivas(contexto: ContextoAcesso, registro: RegistroFerramentas): Ferramenta[] {
  return registro.listar().filter((ferramenta) => motivoDaNegativa(contexto, ferramenta) === null);
}
