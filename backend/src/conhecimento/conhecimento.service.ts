import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { AppError } from "../lib/errors.js";
import { IDS_PAGINA } from "../lib/paginas.js";
import { planejarBusca, trechos } from "./busca.js";

/**
 * Base de conhecimento institucional.
 * - Artigo = metadados (categoria, módulo, acesso, revisão) + versões imutáveis de conteúdo.
 * - Rascunho = versão mais nova que a publicada. Salvar rascunho NUNCA toca a versão vigente.
 * - Publicar = apontar `versao_publicada` para uma versão, numa única instrução (atômica).
 * - Leitura (MCP e prévia) só enxerga a versão publicada de artigos publicados, de categoria ativa e com acesso.
 */

export const STATUS_ARTIGO = ["rascunho", "publicado", "arquivado"] as const;
export const MODULOS_CONHECIMENTO = ["vagas", "empresas", "triagem", "candidatos", "dossies", "processos", "contratacoes", "gestao", "geral"] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/;
const LIMITE_CONTEUDO = 100_000;
/** Dias sem atualização a partir dos quais um artigo publicado é considerado desatualizado (quando não há data de revisão). */
export const DIAS_DESATUALIZADO = 180;

// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁯﻿]/g;
const limparTexto = (t: string) => t.replace(CONTROLE, "").replace(/\r\n?/g, "\n");
const lista = (v: string[] | undefined, max: number) => [...new Set((v ?? []).map((x) => limparTexto(x).trim().toLowerCase()).filter(Boolean))].slice(0, max);

export const conteudoSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  resumo: z.string().trim().max(600).optional().nullable(),
  conteudo: z.string().min(1).max(LIMITE_CONTEUDO),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  palavras_chave: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  referencia: z.string().trim().max(300).optional().nullable(),
  fonte: z.string().trim().max(300).optional().nullable(),
  nota: z.string().trim().max(300).optional().nullable(),
});
export type Conteudo = z.infer<typeof conteudoSchema>;

export const metaSchema = z.object({
  categoria: z.string().trim().min(2).max(80),
  modulo: z.enum(MODULOS_CONHECIMENTO).nullable().optional(),
  revisar_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  acesso_paginas: z.array(z.string()).max(40).optional(),
  acesso_integracoes: z.array(z.string().uuid()).max(50).optional(),
  somente_admin: z.boolean().optional(),
});
export type Meta = z.infer<typeof metaSchema>;

/** Quem lê. `integracao` null = prévia do administrador no painel (sem restrição de integração). */
export type Leitor = { admin: boolean; paginas: readonly string[]; integracao: string | null };

export type Auditor = { usuario: string | null };
const uuidOuNull = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/** Condição SQL de "publicado e autorizado para este leitor". Usa os aliases a (artigo), v (versão), c (categoria). */
function condicaoLeitura(leitor: Leitor, params: unknown[]): string {
  params.push(leitor.admin, [...leitor.paginas], leitor.integracao);
  const [pa, pp, pi] = [params.length - 2, params.length - 1, params.length];
  return `a.status = 'publicado' AND a.versao_publicada IS NOT NULL AND v.versao = a.versao_publicada AND c.ativa
    AND (NOT a.somente_admin OR $${pa}::boolean)
    AND (cardinality(a.acesso_paginas) = 0 OR $${pa}::boolean OR a.acesso_paginas && $${pp}::text[])
    AND (cardinality(a.acesso_integracoes) = 0 OR $${pi}::uuid IS NULL OR $${pi}::uuid = ANY (a.acesso_integracoes))`;
}

export class ConhecimentoService {
  constructor(private readonly db: Pool) {}

  private async auditar(c: Pool | PoolClient, quem: Auditor, acao: string, dados: { artigo?: string | null; categoria?: string | null; versao?: number | null; integracao?: string | null; detalhe?: string | null } = {}) {
    await c.query(
      "INSERT INTO dna_work.conhecimento_auditoria (id_usuario, acao, id_artigo, id_categoria, versao, id_integracao, detalhe) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [uuidOuNull(quem.usuario), acao, dados.artigo ?? null, dados.categoria ?? null, dados.versao ?? null, dados.integracao ?? null, dados.detalhe?.slice(0, 300) ?? null],
    );
  }

  private async transacao<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  // ================================================================ leitura (MCP e prévia)

  async buscar(leitor: Leitor, f: { texto?: string; categoria?: string; modulo?: string; tags?: string[]; palavras_chave?: string[]; pagina: number; limite: number }) {
    const params: unknown[] = [];
    const cond = [condicaoLeitura(leitor, params)];
    const plano = planejarBusca(f.texto ?? "");
    let rank = "0";
    if (f.texto?.trim()) {
      if (!plano.tsquery) return { itens: [], total: 0, termos: [] as string[] };
      params.push(plano.tsquery);
      const q = `to_tsquery('portuguese', $${params.length})`;
      cond.push(`v.busca @@ ${q}`);
      // título/palavras-chave pesam mais; bônus quando o título contém o texto inteiro
      params.push(`%${plano.termosTrecho.slice(0, 1).join("")}%`);
      rank = `ts_rank_cd('{0.1, 0.3, 0.6, 1.0}', v.busca, ${q}, 1) + CASE WHEN dna_work.conhecimento_sem_acento(v.titulo) LIKE $${params.length} THEN 0.2 ELSE 0 END`;
    }
    if (f.categoria) { params.push(f.categoria); cond.push(`c.slug = $${params.length}`); }
    if (f.modulo) { params.push(f.modulo); cond.push(`a.modulo = $${params.length}`); }
    const tags = lista(f.tags, 10);
    if (tags.length) { params.push(tags); cond.push(`v.tags && $${params.length}::text[]`); }
    const palavras = lista(f.palavras_chave, 10);
    if (palavras.length) { params.push(palavras); cond.push(`v.palavras_chave && $${params.length}::text[]`); }
    params.push(f.limite, (f.pagina - 1) * f.limite);
    const { rows } = await this.db.query(`
      SELECT a.slug, a.modulo, a.publicado_em, v.versao, v.titulo, v.resumo, v.conteudo, v.tags, v.atualizado_em, c.slug AS categoria, c.nome AS categoria_nome,
             (${rank}) AS relevancia, count(*) OVER () AS total
      FROM dna_work.conhecimento_artigo a
      JOIN dna_work.conhecimento_versao v ON v.id_artigo = a.id
      JOIN dna_work.conhecimento_categoria c ON c.id = a.id_categoria
      WHERE ${cond.join(" AND ")}
      ORDER BY relevancia DESC, v.atualizado_em DESC, a.slug
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return {
      total: rows.length ? Number(rows[0].total) : 0,
      termos: plano.termosTrecho,
      itens: rows.map((r) => ({
        id: r.slug as string, titulo: r.titulo as string, resumo: (r.resumo ?? null) as string | null, categoria: { slug: r.categoria as string, nome: r.categoria_nome as string },
        modulo: (r.modulo ?? null) as string | null, versao: r.versao as number, atualizado_em: (r.publicado_em ?? r.atualizado_em) as Date, tags: r.tags as string[],
        relevancia: Math.round(Number(r.relevancia) * 1000) / 1000, trechos: trechos(r.conteudo as string, plano.termosTrecho),
      })),
    };
  }

  /** Versão publicada de um artigo (por slug ou id), se o leitor tiver acesso. null = não existe OU sem acesso (mesma resposta). */
  async documento(leitor: Leitor, idOuSlug: string) {
    const params: unknown[] = [idOuSlug];
    const cond = condicaoLeitura(leitor, params);
    const { rows } = await this.db.query(`
      SELECT a.id, a.slug, a.modulo, a.publicado_em, v.versao, v.titulo, v.resumo, v.conteudo, v.tags, v.palavras_chave, v.referencia, v.fonte, v.atualizado_em,
             c.slug AS categoria, c.nome AS categoria_nome
      FROM dna_work.conhecimento_artigo a
      JOIN dna_work.conhecimento_versao v ON v.id_artigo = a.id
      JOIN dna_work.conhecimento_categoria c ON c.id = a.id_categoria
      WHERE (a.slug = $1 OR a.id::text = $1) AND ${cond}`, params);
    return rows[0] ?? null;
  }

  /** Categorias ativas com a contagem de artigos publicados que ESTE leitor pode ver (nunca conta o que ele não vê). */
  async categorias(leitor: Leitor) {
    const params: unknown[] = [];
    const cond = condicaoLeitura(leitor, params);
    const { rows } = await this.db.query(`
      SELECT c.slug, c.nome, c.descricao, c.ordem,
             (SELECT count(*)::int FROM dna_work.conhecimento_artigo a JOIN dna_work.conhecimento_versao v ON v.id_artigo = a.id
               WHERE a.id_categoria = c.id AND ${cond}) AS publicados
      FROM dna_work.conhecimento_categoria c WHERE c.ativa ORDER BY c.ordem, c.nome`, params);
    return rows as Array<{ slug: string; nome: string; descricao: string | null; publicados: number }>;
  }

  async registrarLeituraMcp(quem: Auditor, artigo: string, versao: number, integracao: string) {
    await this.auditar(this.db, quem, "consulta_mcp", { artigo, versao, integracao });
  }

  // ================================================================ categorias (admin)

  async listarCategorias() {
    const { rows } = await this.db.query(`
      SELECT c.*, (SELECT count(*)::int FROM dna_work.conhecimento_artigo a WHERE a.id_categoria = c.id) AS artigos,
             (SELECT count(*)::int FROM dna_work.conhecimento_artigo a WHERE a.id_categoria = c.id AND a.status = 'publicado') AS publicados
      FROM dna_work.conhecimento_categoria c ORDER BY c.ordem, c.nome`);
    return rows;
  }

  async criarCategoria(quem: Auditor, d: { slug: string; nome: string; descricao?: string | null; ordem?: number }) {
    if (!SLUG.test(d.slug)) throw new AppError(422, "SLUG_INVALIDO", "Use letras minúsculas, números e hífens.");
    const id = randomUUID();
    try {
      await this.db.query("INSERT INTO dna_work.conhecimento_categoria (id, slug, nome, descricao, ordem) VALUES ($1,$2,$3,$4,$5)", [id, d.slug, limparTexto(d.nome).trim(), d.descricao ?? null, d.ordem ?? 100]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError(409, "SLUG_EM_USO", "Já existe uma categoria com esse identificador.");
      throw e;
    }
    await this.auditar(this.db, quem, "categoria_criada", { categoria: id, detalhe: d.slug });
    return (await this.listarCategorias()).find((c) => c.id === id);
  }

  async editarCategoria(quem: Auditor, id: string, d: { nome?: string; descricao?: string | null; ordem?: number; ativa?: boolean }) {
    const { rowCount } = await this.db.query(
      `UPDATE dna_work.conhecimento_categoria SET nome = coalesce($2, nome), descricao = CASE WHEN $3::boolean THEN $4 ELSE descricao END,
         ordem = coalesce($5, ordem), ativa = coalesce($6, ativa), atualizado_em = now() WHERE id = $1`,
      [id, d.nome ? limparTexto(d.nome).trim() : null, d.descricao !== undefined, d.descricao ?? null, d.ordem ?? null, d.ativa ?? null]);
    if (!rowCount) throw new AppError(404, "CATEGORIA_NAO_ENCONTRADA", "Categoria não encontrada.");
    await this.auditar(this.db, quem, d.ativa === false ? "categoria_desativada" : "categoria_editada", { categoria: id });
    return (await this.listarCategorias()).find((c) => c.id === id);
  }

  private async categoriaId(c: Pool | PoolClient, slugOuId: string) {
    const { rows } = await c.query<{ id: string }>("SELECT id FROM dna_work.conhecimento_categoria WHERE slug = $1 OR id::text = $1", [slugOuId]);
    if (!rows[0]) throw new AppError(422, "CATEGORIA_INVALIDA", "Categoria inexistente.");
    return rows[0].id;
  }

  // ================================================================ artigos (admin)

  private validarMeta(m: Partial<Meta>) {
    const paginas = m.acesso_paginas ?? [];
    const invalida = paginas.find((p) => !IDS_PAGINA.has(p));
    if (invalida) throw new AppError(422, "PAGINA_INVALIDA", `Página desconhecida: ${invalida}.`);
  }

  async listarArtigos(f: { q?: string; categoria?: string; modulo?: string; status?: string; desatualizados?: boolean; pagina: number; limite: number }) {
    const params: unknown[] = []; const cond: string[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); cond.push(sql.replaceAll("?", `$${params.length}`)); };
    if (f.q?.trim()) add("(dna_work.conhecimento_sem_acento(u.titulo) LIKE ? OR a.slug LIKE ? OR ? = ANY (u.tags))", `%${f.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}%`);
    if (f.categoria) add("c.slug = ?", f.categoria);
    if (f.modulo) add("a.modulo = ?", f.modulo);
    if (f.status) add("a.status = ?", f.status);
    if (f.desatualizados) cond.push(`a.status = 'publicado' AND (a.revisar_em <= current_date OR (a.revisar_em IS NULL AND a.atualizado_em < now() - interval '${DIAS_DESATUALIZADO} days'))`);
    params.push(f.limite, (f.pagina - 1) * f.limite);
    const { rows } = await this.db.query(`
      SELECT a.id, a.slug, a.modulo, a.status, a.versao_publicada, a.revisar_em, a.atualizado_em, a.publicado_em, a.somente_admin,
             cardinality(a.acesso_paginas) > 0 OR cardinality(a.acesso_integracoes) > 0 OR a.somente_admin AS restrito,
             c.slug AS categoria, c.nome AS categoria_nome, u.versao AS ultima_versao, u.titulo, u.resumo,
             (a.status = 'publicado' AND (a.revisar_em <= current_date OR (a.revisar_em IS NULL AND a.atualizado_em < now() - interval '${DIAS_DESATUALIZADO} days'))) AS desatualizado,
             count(*) OVER () AS total
      FROM dna_work.conhecimento_artigo a
      JOIN dna_work.conhecimento_categoria c ON c.id = a.id_categoria
      JOIN LATERAL (SELECT versao, titulo, resumo, tags FROM dna_work.conhecimento_versao WHERE id_artigo = a.id ORDER BY versao DESC LIMIT 1) u ON true
      ${cond.length ? `WHERE ${cond.join(" AND ")}` : ""}
      ORDER BY a.atualizado_em DESC, a.slug LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return {
      itens: rows.map(({ total: _t, ...r }) => ({ ...r, tem_rascunho: r.versao_publicada === null ? true : r.ultima_versao > r.versao_publicada })),
      total: rows.length ? Number(rows[0].total) : 0,
    };
  }

  async criarArtigo(quem: Auditor, d: { slug: string; meta: Meta; conteudo: Conteudo; origem?: "manual" | "importacao" }, c?: PoolClient) {
    if (!SLUG.test(d.slug)) throw new AppError(422, "SLUG_INVALIDO", "Identificador: letras minúsculas, números e hífens.");
    this.validarMeta(d.meta);
    const executar = async (cl: PoolClient) => {
      const id = randomUUID();
      const categoria = await this.categoriaId(cl, d.meta.categoria);
      try {
        await cl.query(
          `INSERT INTO dna_work.conhecimento_artigo (id, slug, id_categoria, modulo, revisar_em, acesso_paginas, acesso_integracoes, somente_admin, origem, id_autor, id_atualizado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
          [id, d.slug, categoria, d.meta.modulo ?? null, d.meta.revisar_em ?? null, d.meta.acesso_paginas ?? [], d.meta.acesso_integracoes ?? [], d.meta.somente_admin ?? false, d.origem ?? "manual", uuidOuNull(quem.usuario)]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new AppError(409, "SLUG_EM_USO", `Já existe um artigo com o identificador ${d.slug}.`);
        throw e;
      }
      await this.inserirVersao(cl, quem, id, 1, d.conteudo, null);
      await this.auditar(cl, quem, d.origem === "importacao" ? "artigo_importado" : "artigo_criado", { artigo: id, versao: 1 });
      return id;
    };
    const id = c ? await executar(c) : await this.transacao(executar);
    return id;
  }

  private async inserirVersao(c: Pool | PoolClient, quem: Auditor, artigo: string, versao: number, d: Conteudo, restauradaDe: number | null) {
    await c.query(
      `INSERT INTO dna_work.conhecimento_versao (id_artigo, versao, titulo, resumo, conteudo, tags, palavras_chave, referencia, fonte, nota, restaurada_de, id_autor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [artigo, versao, limparTexto(d.titulo).trim(), d.resumo ? limparTexto(d.resumo).trim() : null, limparTexto(d.conteudo), lista(d.tags, 20), lista(d.palavras_chave, 30),
        d.referencia ?? null, d.fonte ?? null, d.nota ?? null, restauradaDe, uuidOuNull(quem.usuario)]);
  }

  private async artigo(c: Pool | PoolClient, id: string, bloquear = false) {
    const { rows } = await c.query(`SELECT * FROM dna_work.conhecimento_artigo WHERE id::text = $1 OR slug = $1 ${bloquear ? "FOR UPDATE" : ""}`, [id]);
    if (!rows[0]) throw new AppError(404, "ARTIGO_NAO_ENCONTRADO", "Artigo não encontrado.");
    return rows[0] as Record<string, any>;
  }

  async detalhe(id: string) {
    const a = await this.artigo(this.db, id);
    const [{ rows: versoes }, { rows: cat }] = await Promise.all([
      this.db.query("SELECT versao, titulo, resumo, conteudo, tags, palavras_chave, referencia, fonte, nota, restaurada_de, id_autor, criado_em, atualizado_em FROM dna_work.conhecimento_versao WHERE id_artigo = $1 ORDER BY versao DESC", [a.id]),
      this.db.query("SELECT slug, nome FROM dna_work.conhecimento_categoria WHERE id = $1", [a.id_categoria]),
    ]);
    const ultima = versoes[0];
    const publicada = versoes.find((v) => v.versao === a.versao_publicada) ?? null;
    const rascunho = ultima && (a.versao_publicada === null || ultima.versao > a.versao_publicada) ? ultima : null;
    return {
      id: a.id as string, slug: a.slug as string, categoria: cat[0], modulo: a.modulo, status: a.status, versao_publicada: a.versao_publicada,
      revisar_em: a.revisar_em, acesso: { paginas: a.acesso_paginas, integracoes: a.acesso_integracoes, somente_admin: a.somente_admin },
      origem: a.origem, id_autor: a.id_autor, id_atualizado_por: a.id_atualizado_por, criado_em: a.criado_em, atualizado_em: a.atualizado_em, publicado_em: a.publicado_em,
      publicada, rascunho, ultima_versao: ultima?.versao ?? null,
    };
  }

  /** Salva o rascunho: se a versão mais nova ainda não foi publicada, atualiza-a; senão cria a próxima. A publicada nunca muda. */
  async salvarRascunho(quem: Auditor, id: string, d: Conteudo) {
    return this.transacao(async (c) => {
      const a = await this.artigo(c, id, true);
      const { rows } = await c.query<{ versao: number }>("SELECT max(versao) AS versao FROM dna_work.conhecimento_versao WHERE id_artigo = $1", [a.id]);
      const ultima = rows[0].versao;
      let versao: number;
      if (ultima !== null && (a.versao_publicada === null || ultima > a.versao_publicada)) {
        versao = ultima;
        await c.query(
          `UPDATE dna_work.conhecimento_versao SET titulo=$3, resumo=$4, conteudo=$5, tags=$6, palavras_chave=$7, referencia=$8, fonte=$9, nota=$10, id_autor=$11, atualizado_em=now()
           WHERE id_artigo=$1 AND versao=$2`,
          [a.id, versao, limparTexto(d.titulo).trim(), d.resumo ? limparTexto(d.resumo).trim() : null, limparTexto(d.conteudo), lista(d.tags, 20), lista(d.palavras_chave, 30), d.referencia ?? null, d.fonte ?? null, d.nota ?? null, uuidOuNull(quem.usuario)]);
      } else {
        versao = (ultima ?? 0) + 1;
        await this.inserirVersao(c, quem, a.id, versao, d, null);
      }
      await c.query("UPDATE dna_work.conhecimento_artigo SET atualizado_em = now(), id_atualizado_por = $2 WHERE id = $1", [a.id, uuidOuNull(quem.usuario)]);
      await this.auditar(c, quem, "rascunho_salvo", { artigo: a.id, versao });
      return a.id as string;
    }).then((aid) => this.detalhe(aid));
  }

  async editarMeta(quem: Auditor, id: string, m: Partial<Meta>) {
    this.validarMeta(m);
    const a = await this.artigo(this.db, id);
    const categoria = m.categoria ? await this.categoriaId(this.db, m.categoria) : null;
    await this.db.query(
      `UPDATE dna_work.conhecimento_artigo SET id_categoria = coalesce($2, id_categoria),
         modulo = CASE WHEN $3::boolean THEN $4 ELSE modulo END, revisar_em = CASE WHEN $5::boolean THEN $6::date ELSE revisar_em END,
         acesso_paginas = coalesce($7, acesso_paginas), acesso_integracoes = coalesce($8, acesso_integracoes), somente_admin = coalesce($9, somente_admin),
         atualizado_em = now(), id_atualizado_por = $10 WHERE id = $1`,
      [a.id, categoria, m.modulo !== undefined, m.modulo ?? null, m.revisar_em !== undefined, m.revisar_em ?? null, m.acesso_paginas ?? null, m.acesso_integracoes ?? null, m.somente_admin ?? null, uuidOuNull(quem.usuario)]);
    const mudouAcesso = m.acesso_paginas !== undefined || m.acesso_integracoes !== undefined || m.somente_admin !== undefined;
    await this.auditar(this.db, quem, mudouAcesso ? "acesso_alterado" : "metadados_alterados", { artigo: a.id });
    return this.detalhe(a.id);
  }

  /** Publica UMA versão (por padrão, a mais nova). Uma única instrução: quem lê vê a anterior ou a nova, nunca um meio-termo. */
  async publicar(quem: Auditor, id: string, versao?: number) {
    return this.transacao(async (c) => {
      const a = await this.artigo(c, id, true);
      const { rows } = await c.query<{ versao: number }>("SELECT max(versao) AS versao FROM dna_work.conhecimento_versao WHERE id_artigo = $1", [a.id]);
      const alvo = versao ?? rows[0].versao;
      const { rowCount } = await c.query(
        `UPDATE dna_work.conhecimento_artigo SET versao_publicada = $2, status = 'publicado', publicado_em = now(), atualizado_em = now(), id_atualizado_por = $3
         WHERE id = $1 AND EXISTS (SELECT 1 FROM dna_work.conhecimento_versao WHERE id_artigo = $1 AND versao = $2)`,
        [a.id, alvo, uuidOuNull(quem.usuario)]);
      if (!rowCount) throw new AppError(422, "VERSAO_INEXISTENTE", "Versão inexistente.");
      await this.auditar(c, quem, "publicado", { artigo: a.id, versao: alvo });
      return { id: a.id as string, versao_publicada: alvo };
    }).then(async (r) => ({ ...(await this.detalhe(r.id)) }));
  }

  async arquivar(quem: Auditor, id: string) {
    const a = await this.artigo(this.db, id);
    await this.db.query("UPDATE dna_work.conhecimento_artigo SET status = 'arquivado', atualizado_em = now(), id_atualizado_por = $2 WHERE id = $1", [a.id, uuidOuNull(quem.usuario)]);
    await this.auditar(this.db, quem, "arquivado", { artigo: a.id });
    return this.detalhe(a.id);
  }

  /** Tira do arquivo: volta a publicado se já tinha versão publicada; senão, rascunho. */
  async reativar(quem: Auditor, id: string) {
    const a = await this.artigo(this.db, id);
    await this.db.query("UPDATE dna_work.conhecimento_artigo SET status = CASE WHEN versao_publicada IS NULL THEN 'rascunho' ELSE 'publicado' END, atualizado_em = now(), id_atualizado_por = $2 WHERE id = $1", [a.id, uuidOuNull(quem.usuario)]);
    await this.auditar(this.db, quem, "reativado", { artigo: a.id });
    return this.detalhe(a.id);
  }

  async duplicar(quem: Auditor, id: string, novoSlug: string) {
    const d = await this.detalhe(id);
    const base = d.rascunho ?? d.publicada;
    if (!base) throw new AppError(422, "SEM_CONTEUDO", "Artigo sem conteúdo.");
    const novo = await this.criarArtigo(quem, {
      slug: novoSlug,
      meta: { categoria: d.categoria.slug, modulo: d.modulo, revisar_em: null, acesso_paginas: d.acesso.paginas, acesso_integracoes: d.acesso.integracoes, somente_admin: d.acesso.somente_admin },
      conteudo: { titulo: `${base.titulo} (cópia)`.slice(0, 200), resumo: base.resumo, conteudo: base.conteudo, tags: base.tags, palavras_chave: base.palavras_chave, referencia: base.referencia, fonte: base.fonte, nota: `Cópia de ${d.slug}` },
    });
    await this.auditar(this.db, quem, "duplicado", { artigo: novo, detalhe: `origem ${d.slug}` });
    return this.detalhe(novo);
  }

  async versoes(id: string) {
    const a = await this.artigo(this.db, id);
    const { rows } = await this.db.query(
      `SELECT v.versao, v.titulo, v.nota, v.restaurada_de, v.criado_em, v.atualizado_em, u.nome AS autor
       FROM dna_work.conhecimento_versao v LEFT JOIN dna_work.app_usuario u ON u.id = v.id_autor WHERE v.id_artigo = $1 ORDER BY v.versao DESC`, [a.id]);
    return rows.map((r) => ({ ...r, publicada: r.versao === a.versao_publicada, rascunho: a.versao_publicada === null || r.versao > a.versao_publicada }));
  }

  async versao(id: string, versao: number) {
    const a = await this.artigo(this.db, id);
    const { rows } = await this.db.query("SELECT versao, titulo, resumo, conteudo, tags, palavras_chave, referencia, fonte, nota, restaurada_de, criado_em FROM dna_work.conhecimento_versao WHERE id_artigo = $1 AND versao = $2", [a.id, versao]);
    if (!rows[0]) throw new AppError(404, "VERSAO_INEXISTENTE", "Versão inexistente.");
    return rows[0];
  }

  /** Restaura uma versão antiga criando uma NOVA versão (rascunho) com o mesmo conteúdo. Não publica sozinho. */
  async restaurar(quem: Auditor, id: string, versao: number) {
    return this.transacao(async (c) => {
      const a = await this.artigo(c, id, true);
      const { rows } = await c.query("SELECT * FROM dna_work.conhecimento_versao WHERE id_artigo = $1 AND versao = $2", [a.id, versao]);
      if (!rows[0]) throw new AppError(404, "VERSAO_INEXISTENTE", "Versão inexistente.");
      const { rows: m } = await c.query<{ versao: number }>("SELECT max(versao) AS versao FROM dna_work.conhecimento_versao WHERE id_artigo = $1", [a.id]);
      const nova = m[0].versao + 1;
      const o = rows[0];
      await this.inserirVersao(c, quem, a.id, nova, { titulo: o.titulo, resumo: o.resumo, conteudo: o.conteudo, tags: o.tags, palavras_chave: o.palavras_chave, referencia: o.referencia, fonte: o.fonte, nota: `Restaurada da versão ${versao}` }, versao);
      await c.query("UPDATE dna_work.conhecimento_artigo SET atualizado_em = now(), id_atualizado_por = $2 WHERE id = $1", [a.id, uuidOuNull(quem.usuario)]);
      await this.auditar(c, quem, "restaurado", { artigo: a.id, versao: nova, detalhe: `da versão ${versao}` });
      return a.id as string;
    }).then((aid) => this.detalhe(aid));
  }

  async auditoria(f: { artigo?: string; pagina: number; limite: number }) {
    const params: unknown[] = []; let onde = "";
    if (f.artigo) { const a = await this.artigo(this.db, f.artigo); params.push(a.id); onde = "WHERE x.id_artigo = $1"; }
    params.push(f.limite, (f.pagina - 1) * f.limite);
    const { rows } = await this.db.query(`
      SELECT x.id::text, x.ocorrido_em, x.acao, x.versao, x.detalhe, u.nome AS usuario, a.slug AS artigo, i.slug AS integracao, count(*) OVER () AS total
      FROM dna_work.conhecimento_auditoria x LEFT JOIN dna_work.app_usuario u ON u.id = x.id_usuario
      LEFT JOIN dna_work.conhecimento_artigo a ON a.id = x.id_artigo LEFT JOIN dna_work.mcp_integracao i ON i.id = x.id_integracao
      ${onde} ORDER BY x.ocorrido_em DESC, x.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { itens: rows.map(({ total: _t, ...r }) => r), total: rows.length ? Number(rows[0].total) : 0 };
  }

  // ================================================================ importação em lote

  /**
   * Importa artigos SEMPRE como rascunho (nunca publica). `simular` valida tudo e não grava nada.
   * Tudo ou nada: se um item falhar, nenhum é gravado.
   */
  async importar(quem: Auditor, itens: Array<{ slug: string; meta: Meta; conteudo: Conteudo }>, simular: boolean) {
    const erros: Array<{ indice: number; slug: string; erro: string }> = [];
    const vistos = new Set<string>();
    for (const [i, item] of itens.entries()) {
      if (vistos.has(item.slug)) erros.push({ indice: i, slug: item.slug, erro: "identificador repetido no arquivo" });
      vistos.add(item.slug);
    }
    const resultado = await this.transacao(async (c) => {
      const criados: string[] = [];
      for (const [i, item] of itens.entries()) {
        try {
          await c.query("SAVEPOINT item");
          await this.criarArtigo(quem, { ...item, origem: "importacao" }, c);
          criados.push(item.slug);
          await c.query("RELEASE SAVEPOINT item");
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT item");
          if (!erros.some((x) => x.indice === i)) erros.push({ indice: i, slug: item.slug, erro: e instanceof AppError ? e.message : "erro ao gravar" });
        }
      }
      if (simular || erros.length) throw Object.assign(new Error("desfazer"), { desfazer: true, criados });
      return criados;
    }).catch((e) => { if ((e as { desfazer?: boolean }).desfazer) return null; throw e; });
    return { simulado: simular, gravados: resultado ?? [], validos: itens.length - erros.length, erros };
  }
}
