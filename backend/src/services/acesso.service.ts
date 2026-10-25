import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { IDS_PAGINA, PAGINAS } from "../lib/paginas.js";
import { many, one } from "../repositories/sql.js";

type UsuarioAcesso = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  admin: boolean;
  paginas: string[];
};

export class AcessoService {
  constructor(private readonly db: Pool, private readonly config: AppConfig) {}

  async daSessao(sub: string, email: string) {
    if (sub === "bootstrap-admin" || email.toLowerCase() === this.config.ADMIN_EMAIL.toLowerCase()) {
      return { admin: true, paginas: PAGINAS.map((pagina) => pagina.id), ativo: true };
    }
    const usuario = await one<{ id: string; ativo: boolean; admin: boolean }>(this.db, `
      SELECT id, ativo, admin FROM dna_work.app_usuario WHERE id = $1
    `, [sub]);
    if (!usuario || !usuario.ativo) return { admin: false, paginas: [] as string[], ativo: false };
    if (usuario.admin) return { admin: true, paginas: PAGINAS.map((pagina) => pagina.id), ativo: true };
    const paginas = await many<{ pagina: string }>(this.db, `
      SELECT pagina FROM dna_work.app_usuario_pagina WHERE id_usuario = $1
    `, [usuario.id]);
    return { admin: false, paginas: paginas.map((linha) => linha.pagina), ativo: true };
  }

  async listar() {
    const usuarios = await many<UsuarioAcesso>(this.db, `
      SELECT u.id, u.nome, u.email, u.ativo, u.admin,
             coalesce(array_agg(p.pagina) FILTER (WHERE p.pagina IS NOT NULL), '{}') AS paginas
      FROM dna_work.app_usuario u
      LEFT JOIN dna_work.app_usuario_pagina p ON p.id_usuario = u.id
      GROUP BY u.id
      ORDER BY u.admin DESC, u.ativo DESC, u.nome
    `);
    const marcados = usuarios.map((usuario) => ({
      ...usuario,
      paginas: comoLista(usuario.paginas),
      admin: usuario.admin || usuario.email.toLowerCase() === this.config.ADMIN_EMAIL.toLowerCase(),
    }));
    return {
      total: marcados.length,
      com_acesso: marcados.filter((usuario) => usuario.ativo).length,
      sem_acesso: marcados.filter((usuario) => !usuario.ativo).length,
      paginas: PAGINAS,
      usuarios: marcados,
    };
  }

  async salvar(id: string, input: { ativo: boolean; paginas: string[] }) {
    const usuario = await one<{ id: string; email: string; admin: boolean }>(this.db, `
      SELECT id, email, admin FROM dna_work.app_usuario WHERE id = $1
    `, [id]);
    if (!usuario) throw new AppError(404, "USUARIO_NAO_ENCONTRADO", "Usuário não encontrado.");
    const admin = usuario.admin || usuario.email.toLowerCase() === this.config.ADMIN_EMAIL.toLowerCase();
    if (admin) throw new AppError(409, "ADMIN_PROTEGIDO", "O administrador mantém acesso a todas as páginas.");
    const paginas = [...new Set(input.paginas.filter((pagina) => IDS_PAGINA.has(pagina)))];
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE dna_work.app_usuario SET ativo = $2 WHERE id = $1", [id, input.ativo]);
      await client.query("DELETE FROM dna_work.app_usuario_pagina WHERE id_usuario = $1", [id]);
      for (const pagina of paginas) {
        await client.query("INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina) VALUES ($1, $2)", [id, pagina]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.listar();
  }
}

function comoLista(valor: string[] | string | null) {
  if (Array.isArray(valor)) return valor;
  if (!valor || valor === "{}") return [];
  return valor.replace(/^\{|\}$/g, "").split(",").map((item) => item.trim()).filter(Boolean);
}
