import { randomInt, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { EmpresaRepository } from "../repositories/empresa.repository.js";
import type { EmpresaCreate, EmpresaListQuery, EmpresaPatch } from "../schemas/empresa.js";
import { presentEmpresa } from "./presenters.js";
import { sincronizarEnderecoEmpresas } from "../lib/empresa-endereco.js";
import { cobrarDaPropria, cobrarPela, listarPagadoras, pagadoraDe } from "../lib/cobranca-pela-matriz.js";
import type { Logger } from "./notion-sync.service.js";

const MENU_PORTAL = "9%34%35%37";
const SUB1_PORTAL = "146%203%206";
const SUB2_PORTAL = "47%51%52%86%89";

/** Acesso ao portal como aparece na ficha: a senha nunca fica salva, então não volta aqui. */
export type AcessoPortal = {
  ativo: boolean;
  email: string | null;
  nome: string | null;
};

export type LoginPortalResultado = {
  /** trocado: o login passou a ser o e-mail novo; juntado: a empresa entrou no login que já tinha esse e-mail; igual: o login já era esse e-mail; mantido: a empresa tem vários logins e nenhum usava o e-mail antigo; sem_acesso: a empresa não tem login. */
  acao: "trocado" | "juntado" | "igual" | "mantido" | "sem_acesso";
  email: string;
  empresas?: string[];
};

type PlanoLogin = {
  acao: "trocado" | "juntado" | "igual" | "mantido";
  alvos: Array<{ id_u: string; email_u: string | null; empresa_u: string | null }>;
  dono: string | null;
};

/** A senha em texto que versões antigas guardavam em `senha_envio` é apagada uma vez por processo. */
let senhaEnvioLimpa = false;

export type UsoPortal = {
  ultimo_login: string | null;
  ultimo_uso: string | null;
  logins: number;
  email: string | null;
};

const PATCHABLE = new Set([
  "razao_social", "nome_fantasia", "cnpj", "email", "telefone", "celular", "cep", "logradouro",
  "numero", "complemento", "bairro", "cidade", "uf", "status", "responsavel", "tipo_empresa",
  "matriz", "ie", "site", "obs",
]);

const ENDERECO = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"];

export class EmpresaService {
  constructor(
    private readonly db: Pool,
    private readonly repo: EmpresaRepository,
    /** Para levar o endereço novo à triagem (public.empresa e public.vaga) logo depois de editar a ficha. */
    private readonly endereco?: { apiKey: string; log: Logger },
  ) {}

  private async assertMatriz(matriz: string | undefined, selfId?: string) {
    if (!matriz) return;
    if (selfId && matriz === selfId) {
      throw new AppError(422, "MATRIZ_INVALIDA", "A empresa não pode ser matriz dela mesma.");
    }
    const found = await this.repo.findById(this.db, matriz);
    if (!found) throw new AppError(422, "MATRIZ_INVALIDA", "A matriz informada não existe.");
  }

  async create(input: EmpresaCreate) {
    const duplicated = input.cnpj ? await this.repo.findByCnpj(this.db, input.cnpj) : null;
    if (duplicated) {
      throw new AppError(409, "CNPJ_DUPLICADO", "Já existe uma empresa com este CNPJ.", {
        id_empresa: duplicated.id_empresa,
      });
    }
    await this.assertMatriz(input.matriz);
    const id = randomUUID();
    await this.repo.insert(this.db, input, id);
    return presentEmpresa((await this.repo.findById(this.db, id))!);
  }

  async update(id: string, input: EmpresaPatch) {
    const current = await this.repo.findById(this.db, id);
    if (!current) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    const patch: EmpresaPatch = {};
    for (const [key, value] of Object.entries(input)) {
      if (!PATCHABLE.has(key) || value === undefined) continue;
      (patch as Record<string, unknown>)[key] = value;
    }
    const mudaCobranca = input.cobranca_por !== undefined;
    if (mudaCobranca) {
      // Quem cobra a empresa decide a matriz: o campo antigo de matriz não vale junto.
      delete patch.matriz;
      await this.trocarCobranca(id, input.cobranca_por ?? null, current.nome_fantasia || current.razao_social || "Unidade");
      if (Object.keys(patch).length === 0) return this.get(id);
    }
    if (Object.keys(patch).length === 0) {
      throw new AppError(400, "NADA_PARA_ATUALIZAR", "Nenhum campo informado para atualização.");
    }
    if (patch.cnpj) {
      const duplicated = await this.repo.findByCnpj(this.db, patch.cnpj, id);
      if (duplicated) {
        throw new AppError(409, "CNPJ_DUPLICADO", "Já existe uma empresa com este CNPJ.", {
          id_empresa: duplicated.id_empresa,
        });
      }
    }
    if (patch.matriz === id) delete patch.matriz;
    await this.assertMatriz(patch.matriz, id);
    // E-mail novo: o login do portal acompanha. O plano é montado antes de gravar, para um conflito não deixar meia edição.
    const emailNovo = typeof patch.email === "string" ? patch.email.trim().toLowerCase() : "";
    const emailMudou = Boolean(emailNovo) && emailNovo !== (current.email ?? "").trim().toLowerCase();
    const plano = emailMudou ? await this.planoLogin(id, current.email, emailNovo, input.juntar_login === true) : null;
    await this.repo.update(this.db, id, patch);
    let loginPortal: LoginPortalResultado | null = null;
    if (emailMudou) {
      await this.db.query("UPDATE public.empresa SET email = $2 WHERE id::text = $1", [id, emailNovo]).catch((error: unknown) => {
        if (!["42P01", "42703"].includes(codigoPg(error) ?? "")) throw error;
      });
      loginPortal = plano ? await this.aplicarLogin(id, emailNovo, plano) : { acao: "sem_acesso", email: emailNovo };
    }
    if (this.endereco && ENDERECO.some((campo) => campo in patch)) {
      // Falha aqui não desfaz a edição: o sync das vagas confere o endereço de novo no próximo horário.
      await sincronizarEnderecoEmpresas(this.db, this.endereco.apiKey, this.endereco.log, { ids: [id] }).catch((error: unknown) =>
        this.endereco!.log.error({ id_empresa: id, erro: error instanceof Error ? error.message : String(error) }, "endereço da empresa: falha ao atualizar a triagem"));
    }
    return { ...presentEmpresa((await this.repo.findById(this.db, id))!), ...(loginPortal ? { login_portal: loginPortal } : {}) };
  }

  /**
   * Quem do portal muda junto com o e-mail da empresa: os logins desta empresa com o e-mail antigo ou, se ela tem
   * um login só, esse login. Se o e-mail novo já é login de outra empresa, só segue com `juntar` (409 LOGIN_EM_USO):
   * aí esta empresa passa a entrar por aquele login, com a senha dele.
   */
  private async planoLogin(id: string, emailAntigo: string | null, emailNovo: string, juntar: boolean): Promise<PlanoLogin | null> {
    let usuarios: Array<{ id_u: string; email_u: string | null; empresa_u: string | null }>;
    try {
      usuarios = (await this.db.query<{ id_u: string; email_u: string | null; empresa_u: string | null }>(`
        select u.id_u, u.email_u, u.empresa_u
        from dna_work.usuario_empresa u
        where u.status = 1 and (
          u.empresa_u = $1
          or exists (select 1 from dna_work.vinculo_empresa_usuario v where v.id_usuario = u.id_u and v.id_empresa = $1)
        )
      `, [id])).rows;
    } catch (error) {
      if (codigoPg(error) === "42P01") return null;
      throw error;
    }
    if (!usuarios.length) return null;
    const antigo = (emailAntigo ?? "").trim().toLowerCase();
    let alvos = usuarios.filter((usuario) => antigo && (usuario.email_u ?? "").trim().toLowerCase() === antigo);
    if (!alvos.length && usuarios.length === 1) alvos = usuarios;
    if (!alvos.length) return { acao: "mantido", alvos: [], dono: null };
    if (alvos.every((usuario) => (usuario.email_u ?? "").trim().toLowerCase() === emailNovo)) return { acao: "igual", alvos: [], dono: null };
    const ids = alvos.map((usuario) => usuario.id_u);
    const dono = (await this.db.query<{ id_u: string; nome_u: string | null }>(`
      select id_u, nome_u from dna_work.usuario_empresa
      where status = 1 and lower(trim(email_u)) = $1 and not (id_u = any($2::varchar[]))
      order by id_u limit 1
    `, [emailNovo, ids])).rows[0];
    if (!dono) return { acao: "trocado", alvos, dono: null };
    if (!juntar) {
      const empresas = await this.empresasDoLogin(dono.id_u);
      throw new AppError(409, "LOGIN_EM_USO", `${emailNovo} já entra no portal por ${empresas.length ? empresas.join(", ") : "outra empresa"}. Confirme para esta empresa usar o mesmo login.`, { empresas, email: emailNovo });
    }
    return { acao: "juntado", alvos, dono: dono.id_u };
  }

  private async aplicarLogin(id: string, emailNovo: string, plano: PlanoLogin): Promise<LoginPortalResultado> {
    if (plano.acao === "mantido" || plano.acao === "igual") return { acao: plano.acao, email: emailNovo };
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (plano.acao === "trocado") {
        await client.query("update dna_work.usuario_empresa set email_u = $2 where id_u = any($1::varchar[])", [plano.alvos.map((usuario) => usuario.id_u), emailNovo]);
      } else {
        await client.query(`
          insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa)
          select $1::varchar, $2::varchar
          where not exists (select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1::varchar and id_empresa = $2::varchar)
        `, [plano.dono, id]);
        for (const usuario of plano.alvos) {
          // O login antigo deixa de abrir esta empresa; se não sobra nenhuma, ele é desativado.
          await client.query("delete from dna_work.vinculo_empresa_usuario where id_usuario = $1 and id_empresa = $2", [usuario.id_u, id]);
          const outra = (await client.query<{ id_empresa: string }>(
            "select id_empresa from dna_work.vinculo_empresa_usuario where id_usuario = $1 order by id_empresa limit 1",
            [usuario.id_u],
          )).rows[0]?.id_empresa;
          if (usuario.empresa_u === id || !usuario.empresa_u) {
            if (outra) await client.query("update dna_work.usuario_empresa set empresa_u = $2 where id_u = $1", [usuario.id_u, outra]);
            else await client.query("update dna_work.usuario_empresa set status = 0 where id_u = $1", [usuario.id_u]);
          }
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (plano.acao === "trocado") return { acao: "trocado", email: emailNovo };
    return { acao: "juntado", email: emailNovo, empresas: await this.empresasDoLogin(plano.dono!) };
  }

  /** Nomes das empresas que um login do portal abre. */
  private async empresasDoLogin(usuarioId: string): Promise<string[]> {
    const rows = await this.db.query<{ nome: string }>(`
      select coalesce(nullif(trim(e.nome_fantasia), ''), e.razao_social, e.id_empresa) as nome
      from dna_work.empresa e
      where e.id_empresa in (
        select empresa_u from dna_work.usuario_empresa where id_u = $1 and empresa_u is not null
        union
        select id_empresa from dna_work.vinculo_empresa_usuario where id_usuario = $1
      )
      order by 1
    `, [usuarioId]);
    return rows.rows.map((row) => row.nome);
  }

  async get(id: string) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    return {
      ...presentEmpresa(row),
      cobranca_por: await pagadoraDe(this.db, id),
      ...(await this.portalDe(id)),
      uso_portal: await this.usoDe(id),
    };
  }

  /** Empresas que podem pagar por outra (com CNPJ e faturadas por elas mesmas), as do grupo primeiro. */
  async pagadoras(filtro: { q?: string; grupo?: string; excluir?: string }) {
    return listarPagadoras(this.db, filtro);
  }

  /** Liga a empresa à que paga por ela (copiando as condições de cobrança que faltarem) ou volta a cobrar a própria. */
  private async trocarCobranca(id: string, pagadora: string | null, nome: string) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (pagadora) await cobrarPela(client, id, pagadora, nome);
      else await cobrarDaPropria(client, id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(query: EmpresaListQuery) {
    await this.garantirTabelaAcesso();
    const result = await this.repo.list(this.db, query);
    const ids = result.rows.map((row) => row.id_empresa);
    const comAcesso = await this.idsComAcesso(ids);
    const uso = await this.usosDe(ids);
    return {
      data: result.rows.map((row) => ({
        ...presentEmpresa(row),
        acesso_portal: comAcesso.has(row.id_empresa),
        uso_portal: uso.get(row.id_empresa) ?? null,
      })),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }

  /**
   * Cria o login do portal ou gera nova senha. A senha só volta nesta resposta, para a equipe
   * copiar e enviar: no banco fica só o Argon2id (`senha_hash`); o MD5 antigo (`senha_u`) é apagado
   * (o portal confere o Argon2id primeiro). `atualiza_senha = 1` obriga a empresa a criar outra no primeiro acesso.
   */
  async gerarAcessoPortal(id: string, input: { email?: string; redefinir?: boolean; juntar?: boolean }): Promise<AcessoPortal & { senha: string; criado: boolean; juntado?: boolean; empresas?: string[] }> {
    const empresa = await this.repo.findById(this.db, id);
    if (!empresa) throw new AppError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
    await this.limparSenhaEnvio();
    const atual = await this.usuarioPortal(id);
    if (atual && !input.redefinir) {
      throw new AppError(409, "ACESSO_EXISTENTE", "Esta empresa já tem acesso ao portal.");
    }
    const senha = senhaInicial();
    const senhaHash = await hash(senha);
    const hoje = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
    if (atual) {
      await this.db.query(`
        update dna_work.usuario_empresa
        set senha_u = null, senha_hash = $2, status = 1, atualiza_senha = 1, data_senha = $3
        where id_u = $1
      `, [atual.id, senhaHash, hoje]);
      return { ativo: true, email: atual.email, senha, nome: atual.nome, criado: false };
    }

    const email = (input.email || empresa.email || "").trim().toLowerCase();
    if (!emailValido(email)) {
      throw new AppError(422, "EMAIL_INVALIDO", "Informe um e-mail válido para o acesso da empresa.");
    }
    const nome = nomePortal(empresa.responsavel, empresa.nome_fantasia, empresa.razao_social);
    const telefone = (empresa.celular || empresa.telefone || "").replace(/\D/g, "").slice(0, 11);
    const ocupado = await this.db.query<{ id_u: string; nome_u: string }>(`
      select u.id_u, u.nome_u
      from dna_work.usuario_empresa u
      where lower(u.email_u) = $1
        and u.status = 1
        and u.empresa_u is distinct from $2
        and not exists (
          select 1 from dna_work.vinculo_empresa_usuario v
          where v.id_usuario = u.id_u and v.id_empresa = $2
        )
      limit 1
    `, [email, id]);
    if (ocupado.rows[0]) {
      const dono = ocupado.rows[0];
      const empresas = await this.empresasDoLogin(dono.id_u);
      if (!input.juntar) {
        throw new AppError(409, "EMAIL_EM_USO", `${email} já entra no portal por ${empresas.length ? empresas.join(", ") : "outra empresa"}. Confirme para esta empresa usar o mesmo login.`, { empresas, email });
      }
      // Mesmo login para mais uma empresa: vincula e mantém a senha que a pessoa já usa.
      await this.db.query(`
        insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa)
        select $1::varchar, $2::varchar
        where not exists (select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1::varchar and id_empresa = $2::varchar)
      `, [dono.id_u, id]);
      return { ativo: true, email, senha: "", nome: dono.nome_u, criado: false, juntado: true, empresas: await this.empresasDoLogin(dono.id_u) };
    }
    const mesmoEmail = await this.db.query<{ id_u: string }>(`
      select id_u from dna_work.usuario_empresa
      where lower(email_u) = $1 and (empresa_u = $2 or exists (
        select 1 from dna_work.vinculo_empresa_usuario v
        where v.id_usuario = id_u and v.id_empresa = $2
      ))
      limit 1
    `, [email, id]);
    const usuarioId = mesmoEmail.rows[0]?.id_u ?? randomUUID();
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      if (mesmoEmail.rows[0]) {
        await client.query(`
          update dna_work.usuario_empresa
          set nome_u = $2, email_u = $3, senha_u = null, senha_hash = $4,
              telefone_u = $5, empresa_u = $6, status = 1, tipo = 1, atualiza_senha = 1, data_senha = $7
          where id_u = $1
        `, [usuarioId, nome, email, senhaHash, telefone, id, hoje]);
      } else {
        await client.query(`
          insert into dna_work.usuario_empresa
            (id_u, nome_u, email_u, senha_u, senha_hash, telefone_u, empresa_u, status, tipo, data_senha, atualiza_senha)
          values ($1,$2,$3,null,$4,$5,$6,1,1,$7,1)
        `, [usuarioId, nome, email, senhaHash, telefone, id, hoje]);
      }
      await client.query(`
        insert into dna_work.vinculo_empresa_usuario (id_usuario, id_empresa)
        select $1::varchar, $2::varchar
        where not exists (
          select 1 from dna_work.vinculo_empresa_usuario where id_usuario = $1::varchar and id_empresa = $2::varchar
        )
      `, [usuarioId, id]);
      await client.query(`
        insert into dna_work.paginas_usuario_empresa (id_usuario, menu, sub1, sub2, paginas)
        select $1::varchar, $2, $3, $4, ''
        where not exists (select 1 from dna_work.paginas_usuario_empresa where id_usuario = $1::varchar)
      `, [usuarioId, MENU_PORTAL, SUB1_PORTAL, SUB2_PORTAL]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.db.query(`
      update dna_work.empresa set recrutamento = 1
      where id_empresa = $1 and coalesce(recrutamento, 0) <> 1
    `, [id]).catch((error: { code?: string }) => {
      if (error.code !== "42703") throw error;
    });
    return { ativo: true, email, senha, nome, criado: !mesmoEmail.rows[0] };
  }

  private async portalDe(id: string): Promise<{ acesso_portal: boolean; portal: AcessoPortal }> {
    const vazio: AcessoPortal = { ativo: false, email: null, nome: null };
    try {
      await this.limparSenhaEnvio();
      const usuario = await this.usuarioPortal(id);
      if (!usuario) return { acesso_portal: false, portal: vazio };
      return {
        acesso_portal: true,
        portal: { ativo: true, email: usuario.email, nome: usuario.nome },
      };
    } catch (error) {
      if (codigoPg(error) === "42P01") return { acesso_portal: false, portal: vazio };
      throw error;
    }
  }

  private async idsComAcesso(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    try {
      const rows = await this.db.query<{ id: string }>(`
        select distinct e.id
        from unnest($1::varchar[]) as e(id)
        where exists (
          select 1 from dna_work.usuario_empresa u
          where u.status = 1 and (
            u.empresa_u = e.id
            or exists (
              select 1 from dna_work.vinculo_empresa_usuario v
              where v.id_usuario = u.id_u and v.id_empresa = e.id
            )
          )
        )
      `, [ids]);
      return new Set(rows.rows.map((row) => row.id));
    } catch (error) {
      if (codigoPg(error) === "42P01") return new Set();
      throw error;
    }
  }

  private async usuarioPortal(id: string): Promise<{ id: string; email: string; nome: string } | null> {
    const rows = await this.db.query<{ id_u: string; email_u: string; nome_u: string }>(`
      select u.id_u, u.email_u, u.nome_u
      from dna_work.usuario_empresa u
      where u.status = 1 and (
        u.empresa_u = $1
        or exists (
          select 1 from dna_work.vinculo_empresa_usuario v
          where v.id_usuario = u.id_u and v.id_empresa = $1
        )
      )
      order by case when u.empresa_u = $1 then 0 else 1 end, u.nome_u
      limit 1
    `, [id]);
    const usuario = rows.rows[0];
    if (!usuario) return null;
    return { id: usuario.id_u, email: usuario.email_u, nome: usuario.nome_u };
  }

  /**
   * Apaga, uma vez por processo, as senhas em texto que versões antigas guardavam em `senha_envio`.
   * A coluna continua existindo (uma versão antiga ainda rodando pode lê-la); remover depois.
   * Não mexe em `senha_hash` nem em `senha_u`: o login do portal confere o Argon2id e, se não houver, o MD5 antigo.
   */
  private async limparSenhaEnvio(): Promise<void> {
    if (senhaEnvioLimpa) return;
    try {
      await this.db.query("update dna_work.usuario_empresa set senha_envio = null where senha_envio is not null");
    } catch (error) {
      // Sem a tabela (42P01) ainda não há o que limpar; tenta de novo depois.
      if (codigoPg(error) === "42P01") return;
      // Sem a coluna (42703) não há senha guardada.
      if (codigoPg(error) !== "42703") throw error;
    }
    senhaEnvioLimpa = true;
  }

  private async garantirTabelaAcesso(): Promise<void> {
    await this.db.query(`
      create table if not exists dna_work.portal_empresa_acesso (
        id_empresa varchar(40) primary key,
        id_usuario varchar(40),
        email varchar(255),
        primeiro_login timestamptz,
        ultimo_login timestamptz,
        ultimo_uso timestamptz,
        logins integer not null default 0
      )
    `);
  }

  private async usosDe(ids: string[]): Promise<Map<string, UsoPortal>> {
    const uso = new Map<string, UsoPortal>();
    if (!ids.length) return uso;
    const rows = await this.db.query<{ id_empresa: string; ultimo_login: Date | null; ultimo_uso: Date | null; logins: number; email: string | null }>(`
      select id_empresa, ultimo_login, ultimo_uso, logins, email
      from dna_work.portal_empresa_acesso
      where id_empresa = any($1::varchar[])
    `, [ids]);
    for (const row of rows.rows) {
      uso.set(row.id_empresa, {
        ultimo_login: iso(row.ultimo_login),
        ultimo_uso: iso(row.ultimo_uso),
        logins: Number(row.logins) || 0,
        email: row.email,
      });
    }
    return uso;
  }

  private async usoDe(id: string): Promise<UsoPortal | null> {
    await this.garantirTabelaAcesso();
    return (await this.usosDe([id])).get(id) ?? null;
  }
}

function nomePortal(responsavel: string | null, fantasia: string | null, razao: string | null): string {
  const nome = [responsavel, fantasia, razao].map((item) => item?.trim() ?? "").find((item) => item.length >= 2);
  return (nome || "Responsável").slice(0, 255);
}

function emailValido(email: string): boolean {
  return email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function senhaInicial(): string {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const numeros = "23456789";
  const caracteres = [
    ...Array.from({ length: 8 }, () => letras[randomInt(letras.length)]),
    ...Array.from({ length: 4 }, () => numeros[randomInt(numeros.length)]),
  ];
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join("");
}

function codigoPg(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const data = value instanceof Date ? value : new Date(value);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}
