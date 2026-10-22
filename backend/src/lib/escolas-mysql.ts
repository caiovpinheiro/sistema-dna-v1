import mysql from "mysql2/promise";
import type { AppConfig } from "../config.js";
import { AppError } from "./errors.js";
import { ESCOLA_KEYS } from "./tce-fields.js";

type InstituicaoRow = mysql.RowDataPacket & {
  id_instiduicao: string;
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
  FROM instituicao
`;

let pool: mysql.Pool | null = null;

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

function getPool(config: AppConfig) {
  if (!config.MYSQL_HOST || !config.MYSQL_USER || !config.MYSQL_PASSWORD || !config.MYSQL_DATABASE) {
    throw new AppError(503, "ESCOLAS_NAO_CONFIGURADAS", "Defina MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD e MYSQL_DATABASE no ambiente.");
  }
  if (!pool) {
    pool = mysql.createPool({
      host: config.MYSQL_HOST,
      port: Number(config.MYSQL_PORT || 3306),
      user: config.MYSQL_USER,
      password: config.MYSQL_PASSWORD,
      database: config.MYSQL_DATABASE,
      ssl: { rejectUnauthorized: false },
      connectTimeout: 10000,
      connectionLimit: 4,
    });
  }
  return pool;
}

export function mensagemEscola(error: unknown) {
  if (error instanceof AppError) return error.message;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return "O servidor não alcança o cadastro de escolas.";
  }
  return "Não foi possível buscar as escolas.";
}

export async function searchEscolas(config: AppConfig, termo: string): Promise<EscolaOpcao[]> {
  const consulta = termo.trim();
  if (consulta.length < 2) return [];
  const like = `%${consulta.replace(/[%_]/g, "")}%`;
  const semAcento = `%${consulta.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[%_]/g, "")}%`;
  const [rows] = await getPool(config).query<InstituicaoRow[]>(
    `${SELECT}
     WHERE razao_social LIKE ? OR nome_fantasia LIKE ? OR razao_sem_acento LIKE ?
        OR fantasia_sem_acento LIKE ? OR cnpj LIKE ?
     ORDER BY nome_fantasia ASC
     LIMIT 15`,
    [like, like, semAcento, semAcento, like],
  );
  return rows.map(mapRow);
}

export async function getEscola(config: AppConfig, id: string): Promise<EscolaOpcao | null> {
  const clean = id.trim();
  if (!clean || clean.length > 255) return null;
  const [rows] = await getPool(config).query<InstituicaoRow[]>(`${SELECT} WHERE id_instiduicao = ? LIMIT 1`, [clean]);
  return rows[0] ? mapRow(rows[0]) : null;
}
