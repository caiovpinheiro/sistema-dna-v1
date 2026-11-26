import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import type { AcessoService } from "../services/acesso.service.js";
import { CONTRATO_VERSAO } from "./assinatura.js";
import { ESCOPO_LEITURA, ESCOPOS_SUPORTADOS } from "./oauth.js";
import { carregarContexto, explicarNegativa } from "./politica.js";
import { PERMISSAO_CONTATO } from "./ferramentas/candidatos.js";
import { PERMISSAO_INDICADORES } from "./ferramentas/gestao.js";
import { IntegracoesMcpService } from "./integracoes.service.js";
import type { RegistroFerramentas } from "./registro.js";
import type { McpRuntime } from "./index.js";

const ok = <T>(data: T) => ({ success: true as const, data, meta: {} });

/** Módulos na ordem da tela. `planejado` = ainda sem ferramentas (aparece para o administrador saber o que vem). */
export const MODULOS: ReadonlyArray<{ id: string; rotulo: string; finalidade: string; planejado?: boolean }> = [
  { id: "vagas", rotulo: "Vagas", finalidade: "Consultar vagas, modelos e filtros para apoiar o atendimento e a triagem." },
  { id: "empresas", rotulo: "Empresas", finalidade: "Consultar empresas clientes e as vagas de cada uma." },
  { id: "triagem", rotulo: "Triagem", finalidade: "Sugerir vagas por CEP e apoiar a apresentação da vaga ao candidato." },
  { id: "candidatos", rotulo: "Candidatos", finalidade: "Consultar a ficha resumida, o perfil profissional e o histórico de candidatos." },
  { id: "dossies", rotulo: "Dossiês", finalidade: "Ler os dados da triagem e gerar o rascunho do dossiê (nada é gravado no CRM)." },
  { id: "processos", rotulo: "Processos", finalidade: "Consultar processos seletivos e suas etapas." },
  { id: "contratacoes", rotulo: "Contratações", finalidade: "Consultar contratações, sem salário e sem documentos." },
  { id: "gestao", rotulo: "Gestão", finalidade: "Indicadores gerenciais agregados (restritos à administração por padrão)." },
  { id: "conhecimento", rotulo: "Base de conhecimento", finalidade: "Consultar orientações oficiais da DNA Work (Fase 5, ainda não implementada).", planejado: true },
];

/** Permissões individuais que o administrador pode conceder a um colaborador (liberam campos ou ferramentas gerenciais). */
export const PERMISSOES_INDIVIDUAIS = [
  { id: PERMISSAO_CONTATO, rotulo: "Contato do candidato", descricao: "Celular e e-mail do candidato (desligado por padrão)." },
  { id: PERMISSAO_INDICADORES, rotulo: "Indicadores gerenciais", descricao: "Dashboard, indicadores de contratações e origem dos candidatos (por padrão só administradores)." },
] as const;

/** Abrangências. `proprios` e `equipe` ficam INDISPONÍVEIS: o banco não registra responsável, dono nem equipe (docs/mcp/abrangencia.md). */
export const ABRANGENCIAS = [
  { id: "nenhuma", rotulo: "Sem acesso", disponivel: true, descricao: "Ferramentas com dados individuais ficam bloqueadas (padrão)." },
  { id: "proprios", rotulo: "Próprios registros", disponivel: false, descricao: "Indisponível: o sistema não registra o responsável por candidatos, processos ou contratações." },
  { id: "equipe", rotulo: "Registros de uma equipe", disponivel: false, descricao: "Indisponível: o sistema não tem equipes nem vínculo de equipe nos registros." },
  { id: "autorizados", rotulo: "Registros autorizados", disponivel: true, descricao: "Só os candidatos e empresas que o administrador escolher; apenas consultas por id." },
  { id: "todos", rotulo: "Todos os registros", disponivel: true, descricao: "Todos os registros que a página do painel permitir." },
] as const;

const LIMITE_REGISTROS = 100;
const SLUG = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;
const slugSchema = z.string().regex(SLUG, "Use letras minúsculas, números e hífens (2 a 60 caracteres).");
const textoCurto = z.string().trim().min(2).max(120);

export type DepsAdmin = {
  db: Pool;
  config: AppConfig;
  acesso: AcessoService;
  registro: RegistroFerramentas;
  /** Presente só com MCP_ENABLED ligado. */
  runtime: McpRuntime | null;
};

const dias = (data: Date) => Math.floor((data.getTime() - Date.now()) / 86_400_000);

/** Gestão administrativa do MCP. Tudo aqui é só do administrador (o prefixo /configuracoes já exige admin) e nada devolve segredo. */
export class AdminMcpService {
  private readonly integracoes: IntegracoesMcpService;
  constructor(private readonly deps: DepsAdmin) {
    this.integracoes = new IntegracoesMcpService(deps.db, { publicUrl: this.publicUrl() ?? "" }, deps.registro);
  }

  private publicUrl(): string | null {
    if (this.deps.runtime) return this.deps.runtime.config.publicUrl;
    const bruto = this.deps.config.MCP_PUBLIC_URL?.trim();
    try { return bruto ? new URL(bruto).origin : null; } catch { return null; }
  }

  private urlDe(slug: string): string | null {
    const base = this.publicUrl();
    return base ? `${base}/mcp/${slug}` : null;
  }

  // ---------------------------------------------------------------- catálogo

  catalogo() {
    const ferramentas = this.deps.registro.listar();
    return {
      modulos: MODULOS.map((m) => ({
        ...m,
        ferramentas: ferramentas.filter((f) => f.modulo === m.id).map((f) => ({
          nome: f.nome, titulo: f.titulo, descricao: f.descricao, finalidade: f.finalidade ?? m.finalidade, paginas: [...f.paginas], somenteAdmin: f.adminOnly === true,
          permissaoExigida: f.exigePermissao ?? null, permissoesIndividuais: [...(f.permissoesIndividuais ?? [])],
          servicoExterno: f.consumo === "servico_externo", limitePorHora: f.limitePorHora ?? null, dados: f.dados ?? null,
        })),
      })),
      permissoesIndividuais: PERMISSOES_INDIVIDUAIS,
      abrangencias: ABRANGENCIAS,
      total: ferramentas.length,
    };
  }

  // ---------------------------------------------------------------- integrações

  async listar() {
    const { rows } = await this.deps.db.query(`
      SELECT i.id, i.slug, i.nome, i.descricao, i.finalidade, i.ativa, i.criado_em, i.atualizado_em,
        (SELECT count(*)::int FROM dna_work.mcp_integracao_ferramenta f WHERE f.id_integracao = i.id) AS ferramentas,
        (SELECT count(*)::int FROM dna_work.mcp_integracao_usuario u WHERE u.id_integracao = i.id) AS colaboradores,
        (SELECT max(a.ocorrido_em) FROM dna_work.mcp_auditoria a WHERE a.id_integracao = i.id AND a.operacao = 'executar') AS ultimo_uso
      FROM dna_work.mcp_integracao i ORDER BY i.ativa DESC, lower(i.nome)`);
    const conexoes = await this.conexoesAtivas();
    return rows.map((r) => ({ ...this.formatar(r), ferramentas: r.ferramentas, colaboradores: r.colaboradores, ultimoUso: r.ultimo_uso, conexoesAtivas: conexoes.porIntegracao.get(r.slug) ?? 0 }));
  }

  private formatar(r: Record<string, any>) {
    return { id: r.id as string, slug: r.slug as string, nome: r.nome as string, descricao: r.descricao as string | null, finalidade: r.finalidade as string | null, instrucoes: (r.instrucoes ?? null) as string | null,
      ativa: r.ativa as boolean, url: this.urlDe(r.slug), criadoEm: r.criado_em, atualizadoEm: r.atualizado_em };
  }

  /** Grants OAuth ainda válidos, por integração (recurso) e por usuário. Nunca devolve ids de token. */
  private async conexoesAtivas() {
    const { rows } = await this.deps.db.query<{ conta: string; recursos: string[] }>(`
      SELECT payload ->> 'accountId' AS conta,
             coalesce(ARRAY(SELECT jsonb_object_keys(payload -> 'resources')), '{}') AS recursos
      FROM dna_work.mcp_oauth_registro
      WHERE tipo = 'Grant' AND (expira_em IS NULL OR expira_em > now()) AND payload ? 'accountId'`);
    const base = this.publicUrl();
    const porIntegracao = new Map<string, number>();
    const porUsuarioIntegracao = new Map<string, number>();
    for (const g of rows) {
      for (const recurso of g.recursos ?? []) {
        if (!base || !recurso.startsWith(`${base}/mcp/`)) continue;
        const slug = recurso.slice(`${base}/mcp/`.length);
        porIntegracao.set(slug, (porIntegracao.get(slug) ?? 0) + 1);
        porUsuarioIntegracao.set(`${g.conta}|${slug}`, (porUsuarioIntegracao.get(`${g.conta}|${slug}`) ?? 0) + 1);
      }
    }
    return { porIntegracao, porUsuarioIntegracao };
  }

  async criar(input: { slug: string; nome: string; descricao?: string; finalidade?: string; instrucoes?: string }) {
    const criada = await this.integracoes.criar({ slug: input.slug, nome: input.nome, descricao: input.descricao, instrucoes: input.instrucoes });
    if (input.finalidade) await this.deps.db.query("UPDATE dna_work.mcp_integracao SET finalidade = $2 WHERE id = $1", [criada.id, input.finalidade.trim()]);
    return this.detalhe(criada.id);
  }

  private async obter(id: string) {
    const { rows } = await this.deps.db.query("SELECT * FROM dna_work.mcp_integracao WHERE id = $1", [id]);
    if (!rows[0]) throw new AppError(404, "INTEGRACAO_NAO_ENCONTRADA", "Integração não encontrada.");
    return rows[0] as Record<string, any>;
  }

  async editar(id: string, dados: { nome?: string; descricao?: string | null; finalidade?: string | null; instrucoes?: string | null }) {
    await this.obter(id);
    const campos: string[] = []; const params: unknown[] = [id];
    for (const [coluna, valor] of Object.entries({ nome: dados.nome?.trim(), descricao: dados.descricao, finalidade: dados.finalidade, instrucoes: dados.instrucoes })) {
      if (valor === undefined) continue;
      params.push(valor === "" ? null : valor);
      campos.push(`${coluna} = $${params.length}`);
    }
    if (campos.length) await this.deps.db.query(`UPDATE dna_work.mcp_integracao SET ${campos.join(", ")}, atualizado_em = now() WHERE id = $1`, params);
    return this.detalhe(id);
  }

  async definirAtiva(id: string, ativa: boolean) {
    await this.integracoes.definirAtiva(id, ativa); // desativar revoga as conexões
    return this.detalhe(id);
  }

  async definirFerramentas(id: string, nomes: string[]) {
    await this.obter(id);
    await this.integracoes.definirFerramentas(id, nomes);
    // Restrição individual que ficou com ferramenta que saiu da integração: remove só o excedente.
    await this.deps.db.query(
      `UPDATE dna_work.mcp_integracao_usuario SET ferramentas = ARRAY(SELECT x FROM unnest(ferramentas) x WHERE x = ANY($2::text[]))
       WHERE id_integracao = $1 AND ferramentas IS NOT NULL`, [id, nomes]);
    return this.detalhe(id);
  }

  /** Duplica a configuração (nome, descrição, finalidade, instruções e ferramentas). NÃO copia colaboradores, permissões, abrangência, registros nem conexões. Nasce desativada. */
  async duplicar(id: string, novo: { slug: string; nome: string }) {
    const origem = await this.obter(id);
    const criada = await this.integracoes.criar({ slug: novo.slug, nome: novo.nome, descricao: origem.descricao ?? undefined, instrucoes: origem.instrucoes ?? undefined });
    await this.deps.db.query("UPDATE dna_work.mcp_integracao SET finalidade = $2 WHERE id = $1", [criada.id, origem.finalidade]);
    const { rows } = await this.deps.db.query<{ ferramenta: string }>("SELECT ferramenta FROM dna_work.mcp_integracao_ferramenta WHERE id_integracao = $1", [id]);
    await this.integracoes.definirFerramentas(criada.id, rows.map((r) => r.ferramenta));
    return this.detalhe(criada.id);
  }

  async detalhe(id: string) {
    const integracao = await this.obter(id);
    const [{ rows: ligadas }, { rows: vinculos }, conexoes] = await Promise.all([
      this.deps.db.query<{ ferramenta: string }>("SELECT ferramenta FROM dna_work.mcp_integracao_ferramenta WHERE id_integracao = $1 ORDER BY 1", [id]),
      this.deps.db.query(`
        SELECT v.id_usuario::text AS id_usuario, u.nome, u.email, u.ativo, v.ferramentas, v.permissoes, v.abrangencia, v.criado_em,
          (SELECT count(*)::int FROM dna_work.mcp_integracao_usuario_registro r WHERE r.id_integracao = v.id_integracao AND r.id_usuario = v.id_usuario) AS registros,
          (SELECT max(a.ocorrido_em) FROM dna_work.mcp_auditoria a WHERE a.id_integracao = v.id_integracao AND a.id_usuario = v.id_usuario) AS ultimo_acesso,
          (SELECT count(*)::int FROM dna_work.mcp_auditoria a WHERE a.id_integracao = v.id_integracao AND a.id_usuario = v.id_usuario AND a.operacao = 'executar') AS chamadas,
          (SELECT count(*)::int FROM dna_work.mcp_auditoria a WHERE a.id_integracao = v.id_integracao AND a.id_usuario = v.id_usuario AND a.resultado = 'negado') AS negados
        FROM dna_work.mcp_integracao_usuario v JOIN dna_work.app_usuario u ON u.id = v.id_usuario
        WHERE v.id_integracao = $1 ORDER BY lower(u.nome)`, [id]),
      this.conexoesAtivas(),
    ]);
    return {
      ...this.formatar(integracao),
      ferramentas: ligadas.map((l) => l.ferramenta),
      colaboradores: vinculos.map((v) => ({
        id: v.id_usuario as string, nome: v.nome as string, email: v.email as string, ativo: v.ativo as boolean,
        ferramentas: v.ferramentas as string[] | null, permissoes: v.permissoes as string[], abrangencia: v.abrangencia as string, registros: v.registros as number,
        conexoesAtivas: conexoes.porUsuarioIntegracao.get(`${v.id_usuario}|${integracao.slug}`) ?? 0, ultimoAcesso: v.ultimo_acesso, chamadas: v.chamadas, negados: v.negados,
      })),
      conexoesAtivas: conexoes.porIntegracao.get(integracao.slug) ?? 0,
    };
  }

  // ---------------------------------------------------------------- colaboradores

  async salvarVinculo(idIntegracao: string, idUsuario: string, dados: {
    ferramentas?: string[] | null; permissoes?: string[]; abrangencia?: string; candidatos?: string[]; empresas?: string[];
  }) {
    await this.obter(idIntegracao);
    const { rows: usuarios } = await this.deps.db.query("SELECT id, ativo FROM dna_work.app_usuario WHERE id::text = $1", [idUsuario]);
    if (!usuarios[0]) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Colaborador não encontrado. Só usuários cadastrados no painel podem usar o MCP.");
    if (!usuarios[0].ativo) throw new AppError(422, "USUARIO_INATIVO", "O colaborador está bloqueado no painel.");
    const abrangencia = dados.abrangencia ?? "nenhuma";
    const info = ABRANGENCIAS.find((a) => a.id === abrangencia);
    if (!info) throw new AppError(422, "ABRANGENCIA_INVALIDA", "Abrangência desconhecida.");
    if (!info.disponivel) throw new AppError(422, "ABRANGENCIA_INDISPONIVEL", info.descricao);
    const permissoes = [...new Set(dados.permissoes ?? [])];
    const validas = new Set<string>(PERMISSOES_INDIVIDUAIS.map((p) => p.id));
    const invalida = permissoes.find((p) => !validas.has(p));
    if (invalida) throw new AppError(422, "PERMISSAO_INVALIDA", `Permissão individual desconhecida: ${invalida}.`);
    const { rows: ligadas } = await this.deps.db.query<{ ferramenta: string }>("SELECT ferramenta FROM dna_work.mcp_integracao_ferramenta WHERE id_integracao = $1", [idIntegracao]);
    const nomesLigados = new Set(ligadas.map((l) => l.ferramenta));
    let restritas: string[] | null = null;
    if (dados.ferramentas) {
      const fora = dados.ferramentas.filter((f) => !nomesLigados.has(f));
      if (fora.length) throw new AppError(422, "FERRAMENTA_FORA_DA_INTEGRACAO", `Ferramenta não liberada na integração: ${fora.join(", ")}.`);
      restritas = [...new Set(dados.ferramentas)];
    }
    const candidatos = abrangencia === "autorizados" ? [...new Set(dados.candidatos ?? [])] : [];
    const empresas = abrangencia === "autorizados" ? [...new Set(dados.empresas ?? [])] : [];
    if (candidatos.length + empresas.length > LIMITE_REGISTROS) throw new AppError(422, "REGISTROS_DEMAIS", `No máximo ${LIMITE_REGISTROS} registros autorizados por colaborador.`);
    // Só ids que EXISTEM (nada de vínculo inventado).
    if (candidatos.length) {
      const { rows } = await this.deps.db.query<{ id: string }>("SELECT id_candidato AS id FROM dna_work.candidato WHERE id_candidato = ANY($1::text[])", [candidatos]);
      const faltam = candidatos.filter((c) => !rows.some((r) => String(r.id) === c));
      if (faltam.length) throw new AppError(422, "CANDIDATO_INEXISTENTE", `Candidato inexistente: ${faltam.slice(0, 5).join(", ")}.`);
    }
    if (empresas.length) {
      const { rows } = await this.deps.db.query<{ id: string }>("SELECT id_empresa AS id FROM dna_work.empresa WHERE id_empresa = ANY($1::text[])", [empresas]);
      const faltam = empresas.filter((c) => !rows.some((r) => String(r.id) === c));
      if (faltam.length) throw new AppError(422, "EMPRESA_INEXISTENTE", `Empresa inexistente: ${faltam.slice(0, 5).join(", ")}.`);
    }
    const client = await this.deps.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO dna_work.mcp_integracao_usuario (id_integracao, id_usuario, ferramentas, permissoes, abrangencia) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id_integracao, id_usuario) DO UPDATE SET ferramentas = EXCLUDED.ferramentas, permissoes = EXCLUDED.permissoes, abrangencia = EXCLUDED.abrangencia`,
        [idIntegracao, idUsuario, restritas, permissoes, abrangencia]);
      await client.query("DELETE FROM dna_work.mcp_integracao_usuario_registro WHERE id_integracao = $1 AND id_usuario = $2", [idIntegracao, idUsuario]);
      for (const [tipo, ids] of [["candidato", candidatos], ["empresa", empresas]] as const) {
        for (const id of ids) {
          await client.query("INSERT INTO dna_work.mcp_integracao_usuario_registro (id_integracao, id_usuario, tipo, id_registro) VALUES ($1, $2, $3, $4)", [idIntegracao, idUsuario, tipo, id]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.detalhe(idIntegracao);
  }

  async registrosDoVinculo(idIntegracao: string, idUsuario: string) {
    const { rows } = await this.deps.db.query<{ tipo: string; id_registro: string }>(
      "SELECT tipo, id_registro FROM dna_work.mcp_integracao_usuario_registro WHERE id_integracao = $1 AND id_usuario::text = $2 ORDER BY tipo, id_registro", [idIntegracao, idUsuario]);
    const nomes = async (tabela: "candidato" | "empresa", ids: string[]) => {
      if (!ids.length) return new Map<string, string | null>();
      const sql = tabela === "candidato"
        ? "SELECT id_candidato AS id, nome FROM dna_work.candidato WHERE id_candidato = ANY($1::text[])"
        : "SELECT id_empresa AS id, coalesce(nome_fantasia, razao_social) AS nome FROM dna_work.empresa WHERE id_empresa = ANY($1::text[])";
      const r = await this.deps.db.query<{ id: string; nome: string | null }>(sql, [ids]);
      return new Map(r.rows.map((x) => [String(x.id), x.nome]));
    };
    const cands = rows.filter((r) => r.tipo === "candidato").map((r) => r.id_registro);
    const emps = rows.filter((r) => r.tipo === "empresa").map((r) => r.id_registro);
    const [nc, ne] = await Promise.all([nomes("candidato", cands), nomes("empresa", emps)]);
    return { candidatos: cands.map((id) => ({ id, nome: nc.get(id) ?? null })), empresas: emps.map((id) => ({ id, nome: ne.get(id) ?? null })) };
  }

  async desvincular(idIntegracao: string, idUsuario: string) {
    await this.obter(idIntegracao);
    await this.integracoes.desvincularUsuario(idIntegracao, idUsuario);
    return this.detalhe(idIntegracao);
  }

  async revogar(filtro: { usuarioId?: string; integracaoId?: string }) {
    return this.integracoes.revogar(filtro);
  }

  async usuarios() {
    const { rows } = await this.deps.db.query(`
      SELECT u.id::text AS id, u.nome, u.email, u.ativo, u.admin,
        (SELECT count(*)::int FROM dna_work.mcp_integracao_usuario v WHERE v.id_usuario = u.id) AS integracoes,
        (SELECT max(a.ocorrido_em) FROM dna_work.mcp_auditoria a WHERE a.id_usuario = u.id) AS ultimo_acesso
      FROM dna_work.app_usuario u ORDER BY u.ativo DESC, lower(u.nome)`);
    return rows.map((r) => ({ id: r.id as string, nome: r.nome as string, email: r.email as string, ativo: r.ativo as boolean, admin: r.admin === true, integracoes: r.integracoes as number, ultimoAcesso: r.ultimo_acesso }));
  }

  /** Visão completa de UM colaborador: por integração, o que ele realmente consegue usar e o que está bloqueado (e por quem). */
  async usuario(id: string) {
    const { rows } = await this.deps.db.query("SELECT id::text AS id, nome, email, ativo, admin FROM dna_work.app_usuario WHERE id::text = $1", [id]);
    const u = rows[0];
    if (!u) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Colaborador não encontrado.");
    const { rows: ints } = await this.deps.db.query<{ id: string; slug: string; nome: string; ativa: boolean }>(
      `SELECT i.id, i.slug, i.nome, i.ativa FROM dna_work.mcp_integracao i JOIN dna_work.mcp_integracao_usuario v ON v.id_integracao = i.id WHERE v.id_usuario::text = $1 ORDER BY lower(i.nome)`, [id]);
    const conexoes = await this.conexoesAtivas();
    const integracoes = [];
    for (const i of ints) {
      const r = await carregarContexto(this.deps.db, this.deps.acesso, { usuarioId: id, slug: i.slug, escopos: [ESCOPO_LEITURA] }, { ignorarIntegracaoDesativada: true });
      if (!r.ok) { integracoes.push({ ...i, erro: r.mensagem, ferramentas: [] }); continue; }
      const c = r.contexto;
      const [{ rows: [est] }, registros] = await Promise.all([
        this.deps.db.query(`SELECT max(ocorrido_em) AS ultimo, count(*) FILTER (WHERE operacao = 'executar')::int AS chamadas, count(*) FILTER (WHERE resultado = 'negado')::int AS negados
                            FROM dna_work.mcp_auditoria WHERE id_usuario::text = $1 AND id_integracao = $2`, [id, i.id]),
        c.abrangencia === "autorizados" ? this.registrosDoVinculo(i.id, id) : Promise.resolve({ candidatos: [], empresas: [] }),
      ]);
      integracoes.push({
        id: i.id, slug: i.slug, nome: i.nome, ativa: i.ativa, abrangencia: c.abrangencia, registros,
        permissoes: [...c.permissoes], contato: c.permissoes.has(PERMISSAO_CONTATO), restritas: c.restritas ? [...c.restritas] : null,
        conexoesAtivas: conexoes.porUsuarioIntegracao.get(`${id}|${i.slug}`) ?? 0, ultimoAcesso: est.ultimo, chamadas: est.chamadas, negados: est.negados,
        ferramentas: this.deps.registro.listar().map((f) => {
          const b = explicarNegativa(c, f);
          return { nome: f.nome, titulo: f.titulo, modulo: f.modulo, disponivel: b === null, bloqueio: b };
        }),
      });
    }
    return { usuario: { id: u.id, nome: u.nome, email: u.email, ativo: u.ativo, admin: u.admin === true }, integracoes };
  }

  // ---------------------------------------------------------------- auditoria

  async auditoria(f: { integracao?: string; usuario?: string; ferramenta?: string; de?: string; ate?: string; resultado?: string; pagina: number; limite: number }) {
    const cond: string[] = []; const p: unknown[] = [];
    const add = (sql: string, v: unknown) => { p.push(v); cond.push(sql.replace("?", `$${p.length}`)); };
    if (f.integracao) add("a.id_integracao = ?", f.integracao);
    if (f.usuario) add("a.id_usuario::text = ?", f.usuario);
    if (f.ferramenta) add("a.ferramenta = ?", f.ferramenta);
    if (f.resultado) add("a.resultado = ?", f.resultado);
    if (f.de) add("a.ocorrido_em >= ?::date", f.de);
    if (f.ate) add("a.ocorrido_em < (?::date + 1)", f.ate);
    const onde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
    const externas = this.deps.registro.listar().filter((t) => t.consumo === "servico_externo").map((t) => t.nome);
    const [{ rows: [tot] }, { rows: itens }, { rows: topFerr }, { rows: topUsu }, { rows: ext }] = await Promise.all([
      this.deps.db.query(`SELECT count(*) FILTER (WHERE a.operacao = 'executar')::int AS chamadas,
          count(*) FILTER (WHERE a.operacao = 'executar' AND a.resultado = 'ok')::int AS sucesso,
          count(*) FILTER (WHERE a.resultado IN ('erro', 'invalido'))::int AS erros,
          count(*) FILTER (WHERE a.resultado = 'negado')::int AS negados,
          count(*) FILTER (WHERE a.resultado = 'limite')::int AS limites,
          round(avg(a.duracao_ms) FILTER (WHERE a.operacao = 'executar' AND a.duracao_ms IS NOT NULL))::int AS tempo_medio_ms,
          count(*)::int AS eventos
        FROM dna_work.mcp_auditoria a ${onde}`, p),
      this.deps.db.query(`SELECT a.id, a.ocorrido_em, a.operacao, a.ferramenta, a.resultado, a.codigo, a.duracao_ms, a.slug, a.cliente, u.nome AS usuario
        FROM dna_work.mcp_auditoria a LEFT JOIN dna_work.app_usuario u ON u.id = a.id_usuario ${onde}
        ORDER BY a.ocorrido_em DESC, a.id DESC LIMIT ${f.limite} OFFSET ${(f.pagina - 1) * f.limite}`, p),
      this.deps.db.query(`SELECT a.ferramenta, count(*)::int AS chamadas FROM dna_work.mcp_auditoria a ${onde ? `${onde} AND` : "WHERE"} a.operacao = 'executar' AND a.ferramenta IS NOT NULL
        GROUP BY a.ferramenta ORDER BY 2 DESC, 1 LIMIT 5`, p),
      this.deps.db.query(`SELECT u.nome, count(*)::int AS chamadas FROM dna_work.mcp_auditoria a JOIN dna_work.app_usuario u ON u.id = a.id_usuario
        ${onde ? `${onde} AND` : "WHERE"} a.operacao = 'executar' GROUP BY u.nome ORDER BY 2 DESC, 1 LIMIT 5`, p),
      externas.length
        ? this.deps.db.query(`SELECT a.ferramenta, count(*)::int AS chamadas FROM dna_work.mcp_auditoria a ${onde ? `${onde} AND` : "WHERE"} a.operacao = 'executar' AND a.resultado = 'ok' AND a.ferramenta = ANY($${p.length + 1}::text[])
            GROUP BY a.ferramenta ORDER BY 2 DESC`, [...p, externas])
        : Promise.resolve({ rows: [] as Array<{ ferramenta: string; chamadas: number }> }),
    ]);
    return {
      indicadores: {
        chamadas: tot.chamadas, sucesso: tot.sucesso, erros: tot.erros, negados: tot.negados, limites: tot.limites, tempoMedioMs: tot.tempo_medio_ms,
        ferramentasMaisUsadas: topFerr, colaboradoresMaisAtivos: topUsu,
        servicosExternos: { chamadasPorFerramenta: ext, observacao: "Conta chamadas concluídas de ferramentas que usam serviços externos. Quantidade de chamadas não é custo financeiro." },
      },
      eventos: itens.map((e) => ({ id: String(e.id), quando: e.ocorrido_em, operacao: e.operacao, ferramenta: e.ferramenta, resultado: e.resultado, motivo: e.codigo, duracaoMs: e.duracao_ms, integracao: e.slug, cliente: e.cliente, colaborador: e.usuario })),
      paginacao: { pagina: f.pagina, limite: f.limite, total: tot.eventos },
      retencaoDias: this.deps.config.MCP_AUDITORIA_RETENCAO_DIAS,
    };
  }

  // ---------------------------------------------------------------- infraestrutura

  /** Estado do MCP visto pelo monólito. Nunca devolve chave privada, segredo HMAC nem token: só nomes, datas e contagens. */
  async infra() {
    const cfg = this.deps.config;
    const rt = this.deps.runtime;
    let certificado: { validoAte: string; diasRestantes: number; emDia: boolean } | null = null;
    let erroCertificado: string | null = null;
    if (rt && !rt.config.inseguro && cfg.MCP_INTERNAL_TLS_CERT) {
      try {
        const x = new X509Certificate(fs.readFileSync(cfg.MCP_INTERNAL_TLS_CERT));
        const fim = new Date(x.validTo);
        certificado = { validoAte: fim.toISOString(), diasRestantes: dias(fim), emDia: fim.getTime() > Date.now() };
      } catch { erroCertificado = "Não foi possível ler o certificado do monólito."; }
    }
    const [{ rows: [visto] }, { rows: [banco] }] = await Promise.all([
      this.deps.db.query("SELECT max(ocorrido_em) AS ultimo FROM dna_work.mcp_auditoria WHERE operacao IN ('autenticar', 'listar_ferramentas', 'executar', 'catalogo_publico')"),
      this.deps.db.query("SELECT (SELECT count(*)::int FROM dna_work.mcp_integracao WHERE ativa) AS ativas, (SELECT count(*)::int FROM dna_work.mcp_integracao) AS total"),
    ]);
    const habilitado = rt !== null;
    const url = this.publicUrl();
    const prontidao = [
      { item: "MCP habilitado no monólito (MCP_ENABLED)", ok: habilitado },
      { item: "Endereço público do gateway configurado", ok: Boolean(url) },
      { item: "Canal interno protegido por mTLS", ok: habilitado && rt!.config.inseguro === false },
      { item: "Certificado do canal interno válido", ok: certificado?.emDia === true },
      { item: "Segredos de assinatura (HMAC) configurados", ok: habilitado && rt!.config.segredos.size > 0 },
      { item: "Servidor OAuth ativo", ok: habilitado },
      { item: "Ao menos uma integração ativa", ok: (banco.ativas as number) > 0 },
    ];
    return {
      mcp: { habilitado, urlPublica: url, painel: rt?.config.appUrl ?? null },
      monolito: { comunicacao: visto.ultimo ? "o gateway já falou com o monólito" : "nenhuma chamada do gateway registrada ainda", ultimaChamadaDoGateway: visto.ultimo },
      contrato: { versaoDoMonolito: CONTRATO_VERSAO, aceitas: rt?.config.contratos ?? [] },
      oauth: habilitado ? { ativo: true, emissor: rt!.config.appUrl, escopos: ESCOPOS_SUPORTADOS, escopoPadrao: rt!.config.escopoPadrao, registroDinamicoDeClientes: cfg.MCP_OAUTH_DCR, clientesPreCadastrados: rt!.config.clientesPreCadastrados.length, clientesPorDocumento: rt!.config.cimdUrls.length } : { ativo: false },
      mtls: { modo: !habilitado ? "desligado" : rt!.config.inseguro ? "texto puro (somente desenvolvimento)" : "mTLS", certificado, erro: erroCertificado, clientesPermitidos: rt?.config.clientesInternos.length ?? 0 },
      integracoes: { ativas: banco.ativas, total: banco.total },
      prontidao: { pronto: prontidao.every((p) => p.ok), itens: prontidao },
      retencao: { auditoriaDias: cfg.MCP_AUDITORIA_RETENCAO_DIAS, oauthDias: cfg.MCP_OAUTH_RETENCAO_DIAS },
      chatgpt: {
        passos: [
          "No ChatGPT, abra Configurações › Aplicativos (Conectores) › Modo desenvolvedor e escolha criar um aplicativo/conector MCP.",
          "Cole o endereço de conexão da integração (veja o botão Copiar URL na integração).",
          "Escolha OAuth como autenticação. O ChatGPT descobre o servidor de autorização sozinho; não é preciso informar client id nem segredo.",
          "Ao conectar, o painel DNA Work abre a tela de autorização: entre com o seu usuário e clique em Autorizar.",
          "Só aparecem as ferramentas que o administrador liberou para você e que o seu acesso no painel permite.",
        ],
        observacao: "A URL final do painel e do gateway é definida no EasyPanel; esta tela mostra a que está configurada agora.",
      },
      segredos: "Chaves privadas, certificados e segredos HMAC são configurados só no EasyPanel e nunca aparecem aqui.",
    };
  }
}

const idUsuario = z.string().uuid();
const idInteg = z.string().uuid();

export function registrarAdminMcp(app: FastifyInstance, deps: DepsAdmin): AdminMcpService {
  const svc = new AdminMcpService(deps);
  const base = "/api/v1/configuracoes/mcp";
  const p = (campos: Record<string, z.ZodTypeAny>) => ({ params: z.object(campos) });

  app.get(`${base}/resumo`, async () => ok(await svc.infra()));
  app.get(`${base}/ferramentas`, async () => ok(svc.catalogo()));
  app.get(`${base}/integracoes`, async () => ok(await svc.listar()));
  app.post(`${base}/integracoes`, {
    schema: { body: z.object({ slug: slugSchema, nome: textoCurto, descricao: z.string().trim().max(500).optional(), finalidade: z.string().trim().max(500).optional(), instrucoes: z.string().max(4000).optional() }) },
  }, async (request) => ok(await svc.criar(request.body as never)));
  app.get(`${base}/integracoes/:id`, { schema: p({ id: idInteg }) }, async (request) => ok(await svc.detalhe((request.params as { id: string }).id)));
  app.patch(`${base}/integracoes/:id`, {
    schema: { ...p({ id: idInteg }), body: z.object({ nome: textoCurto.optional(), descricao: z.string().trim().max(500).nullable().optional(), finalidade: z.string().trim().max(500).nullable().optional(), instrucoes: z.string().max(4000).nullable().optional() }) },
  }, async (request) => ok(await svc.editar((request.params as { id: string }).id, request.body as never)));
  app.post(`${base}/integracoes/:id/ativa`, { schema: { ...p({ id: idInteg }), body: z.object({ ativa: z.boolean() }) } },
    async (request) => ok(await svc.definirAtiva((request.params as { id: string }).id, (request.body as { ativa: boolean }).ativa)));
  app.put(`${base}/integracoes/:id/ferramentas`, { schema: { ...p({ id: idInteg }), body: z.object({ ferramentas: z.array(z.string().max(80)).max(100) }) } },
    async (request) => ok(await svc.definirFerramentas((request.params as { id: string }).id, (request.body as { ferramentas: string[] }).ferramentas)));
  app.post(`${base}/integracoes/:id/duplicar`, { schema: { ...p({ id: idInteg }), body: z.object({ slug: slugSchema, nome: textoCurto }) } },
    async (request) => ok(await svc.duplicar((request.params as { id: string }).id, request.body as never)));
  app.put(`${base}/integracoes/:id/colaboradores/:usuario`, {
    schema: {
      ...p({ id: idInteg, usuario: idUsuario }),
      body: z.object({
        ferramentas: z.array(z.string().max(80)).max(100).nullable().optional(), permissoes: z.array(z.string().max(60)).max(10).optional(),
        abrangencia: z.string().max(20).optional(), candidatos: z.array(z.string().trim().min(1).max(64)).max(100).optional(), empresas: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
      }),
    },
  }, async (request) => { const { id, usuario } = request.params as { id: string; usuario: string }; return ok(await svc.salvarVinculo(id, usuario, request.body as never)); });
  app.get(`${base}/integracoes/:id/colaboradores/:usuario/registros`, { schema: p({ id: idInteg, usuario: idUsuario }) },
    async (request) => { const { id, usuario } = request.params as { id: string; usuario: string }; return ok(await svc.registrosDoVinculo(id, usuario)); });
  app.delete(`${base}/integracoes/:id/colaboradores/:usuario`, { schema: p({ id: idInteg, usuario: idUsuario }) },
    async (request) => { const { id, usuario } = request.params as { id: string; usuario: string }; return ok(await svc.desvincular(id, usuario)); });
  app.post(`${base}/integracoes/:id/revogar`, { schema: { ...p({ id: idInteg }), body: z.object({ usuario: idUsuario.optional() }) } },
    async (request) => ok(await svc.revogar({ integracaoId: (request.params as { id: string }).id, usuarioId: (request.body as { usuario?: string }).usuario })));
  app.get(`${base}/colaboradores`, async () => ok(await svc.usuarios()));
  app.get(`${base}/colaboradores/:id`, { schema: p({ id: idUsuario }) }, async (request) => ok(await svc.usuario((request.params as { id: string }).id)));
  app.post(`${base}/colaboradores/:id/revogar`, { schema: p({ id: idUsuario }) },
    async (request) => ok(await svc.revogar({ usuarioId: (request.params as { id: string }).id })));
  app.get(`${base}/auditoria`, {
    schema: {
      querystring: z.object({
        integracao: idInteg.optional(), usuario: idUsuario.optional(), ferramenta: z.string().max(80).optional(), resultado: z.enum(["ok", "negado", "erro", "invalido", "limite"]).optional(),
        de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        pagina: z.coerce.number().int().min(1).max(10000).default(1), limite: z.coerce.number().int().min(1).max(100).default(30),
      }),
    },
  }, async (request) => ok(await svc.auditoria(request.query as never)));
  return svc;
}

