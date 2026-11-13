import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError } from "../lib/errors.js";
import { onlyDigits, semEntidades } from "../lib/normalize.js";

/** Campos do formulário "Nova instituição de ensino". */
export type NovaInstituicao = {
  tipo_ensino: string;
  tipo_instituicao?: string;
  cnpj_inep?: string;
  ie_im?: string;
  mantenedora?: string;
  razao_social: string;
  nome_fantasia?: string;
  diretor?: string;
  diretor_email?: string;
  diretor_cpf?: string;
  diretor_rg?: string;
  representante_legal?: string;
  representante_cpf?: string;
  representante_cargo?: string;
  representante_email?: string;
  telefone?: string;
  telefone2?: string;
  email?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  latitude?: string;
  longitude?: string;
};

/**
 * Para cada campo do formulário, os nomes de coluna possíveis em dna_work.instituicao (cópia do sistema antigo,
 * com nomes legados como "tipo_encino"). Grava na primeira que existir; campo sem coluna volta em "ignorados".
 */
export const COLUNAS_DO_CAMPO: Record<keyof NovaInstituicao, string[]> = {
  tipo_ensino: ["tipo_encino", "tipo_ensino"],
  tipo_instituicao: ["tipo_instituicao", "tipo_intituicao", "tipo"],
  cnpj_inep: ["cnpj", "cnpj_inep", "inep"],
  ie_im: ["ie_im", "ie", "im", "inscricao_estadual"],
  mantenedora: ["mantenedora"],
  razao_social: ["razao_social"],
  nome_fantasia: ["nome_fantasia"],
  diretor: ["diretor", "responsavel"],
  diretor_email: ["diretor_email", "email_diretor"],
  diretor_cpf: ["diretor_cpf", "cpf_diretor"],
  diretor_rg: ["diretor_rg", "rg_diretor"],
  representante_legal: ["representante_legal", "representante"],
  representante_cpf: ["representante_legal_cpf", "representante_cpf", "cpf_representante", "cpf_representante_legal"],
  representante_cargo: ["cargo_representante_legal", "representante_cargo", "cargo_representante"],
  representante_email: ["representante_email", "email_representante", "email_representante_legal"],
  telefone: ["telefone", "telefone1", "fone"],
  telefone2: ["telefone2", "segundo_telefone", "celular"],
  email: ["email"],
  cep: ["cep"],
  logradouro: ["logradouro", "rua", "endereco"],
  numero: ["numero"],
  complemento: ["complemento"],
  bairro: ["bairro"],
  cidade: ["cidade"],
  uf: ["uf", "estado"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon"],
};

const CAMPOS_COM_NOME = new Set<keyof NovaInstituicao>(["mantenedora", "razao_social", "nome_fantasia", "diretor", "representante_legal", "logradouro", "bairro", "cidade"]);

type Coluna = { column_name: string; data_type: string; column_default: string | null };

/** Valor de cada campo já limpo; CPF, CNPJ, CEP e telefone só com dígitos, como no restante do cadastro antigo. */
export function valorDoCampo(campo: keyof NovaInstituicao, valor: string | undefined): string {
  const texto = String(valor ?? "").trim();
  if (!texto) return "";
  if (campo === "cep" || campo === "diretor_cpf" || campo === "representante_cpf" || campo === "telefone" || campo === "telefone2") return onlyDigits(texto);
  if (campo === "uf") return texto.toUpperCase().slice(0, 2);
  if (CAMPOS_COM_NOME.has(campo)) return semEntidades(texto);
  return texto;
}

/** Junta campos e colunas existentes: o que vai para o INSERT e o que não tem onde gravar. */
export function montarGravacao(input: NovaInstituicao, colunas: Set<string>) {
  const valores = new Map<string, string>();
  const ignorados: string[] = [];
  for (const campo of Object.keys(COLUNAS_DO_CAMPO) as Array<keyof NovaInstituicao>) {
    const valor = valorDoCampo(campo, input[campo]);
    if (!valor) continue;
    const coluna = COLUNAS_DO_CAMPO[campo].find((nome) => colunas.has(nome) && !valores.has(nome));
    if (coluna) valores.set(coluna, valor);
    else ignorados.push(campo);
  }
  return { valores, ignorados };
}

export class InstituicaoService {
  constructor(private readonly db: Pool) {}

  private async colunas(client: PoolClient): Promise<Coluna[]> {
    const { rows } = await client.query<Coluna>(
      `SELECT column_name, data_type, column_default FROM information_schema.columns
       WHERE table_schema = 'dna_work' AND table_name = 'instituicao'`,
    );
    return rows;
  }

  async criar(input: NovaInstituicao) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const colunas = await this.colunas(client);
      if (!colunas.length) throw new AppError(503, "TABELA_AUSENTE", "A tabela de instituições não está disponível neste banco.");
      const nomes = new Set(colunas.map((coluna) => coluna.column_name));
      // Trava a tabela para o id (quando não há sequência) e a checagem de duplicada não correrem em paralelo.
      await client.query("LOCK TABLE dna_work.instituicao IN SHARE ROW EXCLUSIVE MODE");

      const documento = onlyDigits(String(input.cnpj_inep ?? ""));
      if (documento && nomes.has("cnpj")) {
        const repetida = await client.query<{ nome: string | null }>(
          `SELECT coalesce(nullif(btrim(nome_fantasia), ''), razao_social) AS nome FROM dna_work.instituicao
           WHERE regexp_replace(coalesce(cnpj::text, ''), '\\D', '', 'g') = $1 LIMIT 1`,
          [documento],
        );
        if (repetida.rows[0]) {
          throw new AppError(409, "INSTITUICAO_DUPLICADA", `Já existe uma instituição com esse CNPJ/INEP: ${semEntidades(repetida.rows[0].nome ?? "sem nome")}.`);
        }
      }

      const { valores, ignorados } = montarGravacao(input, nomes);
      const id = colunas.find((coluna) => coluna.column_name === "id_instiduicao");
      let novoId: string | null = null;
      if (id && !id.column_default) {
        if (/int|numeric/.test(id.data_type)) {
          const { rows } = await client.query<{ proximo: string }>("SELECT (coalesce(max(id_instiduicao), 0) + 1)::text AS proximo FROM dna_work.instituicao");
          novoId = rows[0].proximo;
        } else {
          novoId = randomUUID();
        }
        valores.set("id_instiduicao", novoId);
      }

      const lista = [...valores.keys()];
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO dna_work.instituicao (${lista.map((coluna) => `"${coluna}"`).join(", ")})
         VALUES (${lista.map((_, indice) => `$${indice + 1}`).join(", ")})
         RETURNING ${id ? "id_instiduicao::text" : "NULL::text"} AS id`,
        lista.map((coluna) => valores.get(coluna)),
      );
      await client.query("COMMIT");
      return { id: rows[0]?.id ?? novoId, ignorados };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const erro = error as { code?: string; column?: string };
      if (erro.code === "23502") throw new AppError(422, "CAMPO_OBRIGATORIO", `O banco exige o campo "${erro.column ?? "desconhecido"}" na instituição.`);
      if (erro.code === "22P02" || erro.code === "22003") throw new AppError(422, "VALOR_INVALIDO", "Algum valor não está no formato que o banco aceita. Confira latitude, longitude e números.");
      if (erro.code === "22001") throw new AppError(422, "VALOR_LONGO", "Algum campo passou do tamanho que o banco aceita.");
      throw error;
    } finally {
      client.release();
    }
  }
}
