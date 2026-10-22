import type { Pool } from "pg";
import { AppError } from "./errors.js";
import { ESCOLA_KEYS } from "./tce-fields.js";

type InstituicaoRow = {
  id_instiduicao: string | number;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  representante_legal: string | null;
  responsavel: string | null;
};

export type EscolaOpcao = {
  id: string;
  rotulo: string;
  campos: Record<(typeof ESCOLA_KEYS)[number], string>;
};

const SELECT = `
  SELECT id_instiduicao, razao_social, nome_fantasia, cnpj, email, logradouro, numero,
         complemento, bairro, cidade, uf, cep, representante_legal, responsavel
  FROM dna_work.instituicao
`;

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCnpj(value: string) {
  const raw = digits(value);
  if (raw.length !== 14) return value;
  return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatCep(value: string) {
  const raw = digits(value);
  if (raw.length !== 8) return value;
  return raw.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function semAcento(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function mapRow(row: InstituicaoRow): EscolaOpcao {
  const fantasia = text(row.nome_fantasia);
  const razao = text(row.razao_social);
  const cidade = text(row.cidade);
  const uf = text(row.uf);
  let representante = text(row.representante_legal) || text(row.responsavel);
  let email = text(row.email);
  if (!email && representante.includes("@")) {
    email = representante;
    representante = text(row.responsavel);
    if (representante.includes("@")) representante = "";
  }
  const local = cidade && uf ? `${cidade}/${uf}` : cidade || uf;
  const linha = [text(row.logradouro), text(row.numero)].filter(Boolean).join(", ");
  return {
    id: text(row.id_instiduicao),
    rotulo: [fantasia || razao, local].filter(Boolean).join(" · "),
    campos: {
      nome_escola: razao || fantasia,
      escola_cnpj_inep: formatCnpj(text(row.cnpj)),
      escola_representante: representante,
      escola_email: email,
      escola_endereco: [linha, text(row.complemento), text(row.bairro)].filter(Boolean).join(" - "),
      escola_cep: formatCep(text(row.cep)),
      escola_cidade: cidade,
      escola_estado: uf,
    },
  };
}

function falha(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "42P01") {
    throw new AppError(503, "ESCOLAS_INDISPONIVEIS", "A tabela de instituições não está no PostgreSQL atual.");
  }
  if (code === "42703") {
    throw new AppError(503, "ESCOLAS_INDISPONIVEIS", "A tabela de instituições não tem as colunas esperadas.");
  }
  throw error;
}

export function mensagemEscola(error: unknown) {
  if (error instanceof AppError) return error.message;
  return "Não foi possível buscar as escolas.";
}

export async function searchEscolas(db: Pool, termo: string): Promise<EscolaOpcao[]> {
  const consulta = termo.trim();
  if (consulta.length < 2) return [];
  const like = `%${consulta.replace(/[%_]/g, "")}%`;
  const acento = `%${semAcento(consulta).replace(/[%_]/g, "")}%`;
  try {
    const result = await db.query<InstituicaoRow>(`
      ${SELECT}
      WHERE razao_social ILIKE $1 OR nome_fantasia ILIKE $1 OR cnpj ILIKE $1
         OR translate(lower(coalesce(razao_social, '')), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiioooooouuuuc') ILIKE $2
         OR translate(lower(coalesce(nome_fantasia, '')), 'áàãâäéèêëíìîïóòõôöúùûüç', 'aaaaaeeeeiiiioooooouuuuc') ILIKE $2
      ORDER BY nome_fantasia ASC
      LIMIT 15
    `, [like, acento]);
    return result.rows.map(mapRow);
  } catch (error) {
    falha(error);
  }
}

export async function getEscola(db: Pool, id: string): Promise<EscolaOpcao | null> {
  const clean = id.trim();
  if (!clean || clean.length > 255) return null;
  try {
    const result = await db.query<InstituicaoRow>(`${SELECT} WHERE id_instiduicao::text = $1 LIMIT 1`, [clean]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  } catch (error) {
    falha(error);
  }
}
