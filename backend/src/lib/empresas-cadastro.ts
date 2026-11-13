import type { Pool } from "pg";

/** Empresas cadastradas (public.empresa) no formato que o gerador de TCE usa. */
export type EmpresaCadastro = {
  id: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  endereco: string;
  cep: string;
  cidade: string;
  estado: string;
  email: string;
  representante: string;
};

type EmpresaRow = {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
};

const COLUNAS = "id::text AS id, razao_social, nome_fantasia, cnpj, email, cep, logradouro, numero, complemento";

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function formatCnpj(value: string) {
  const raw = digits(value);
  if (raw.length !== 14) return value.trim();
  return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatCep(value: string) {
  const raw = digits(value);
  if (raw.length !== 8) return value.trim();
  return raw.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function mapRow(row: EmpresaRow): EmpresaCadastro {
  const linha = [row.logradouro, row.numero].map((part) => part?.trim()).filter(Boolean).join(", ");
  return {
    id: row.id,
    razao_social: row.razao_social?.trim() ?? "",
    nome_fantasia: row.nome_fantasia?.trim() ?? "",
    cnpj: formatCnpj(row.cnpj ?? ""),
    endereco: [linha, row.complemento?.trim()].filter(Boolean).join(" - "),
    cep: formatCep(row.cep ?? ""),
    cidade: "",
    estado: "",
    email: row.email?.trim() ?? "",
    representante: "",
  };
}

/** Empresas do cadastro do sistema (dna_work.empresa, a mesma tela de Empresas), com cidade, UF e responsável. */
type EmpresaSistemaRow = EmpresaRow & { bairro: string | null; cidade: string | null; uf: string | null; responsavel: string | null };

const COLUNAS_SISTEMA = `id_empresa::text AS id, razao_social, nome_fantasia, cnpj::text AS cnpj, email, cep::text AS cep,
  logradouro, numero::text AS numero, complemento, bairro, cidade, uf, responsavel`;

/** Tira entidades HTML que o sistema antigo gravava ("Freire &amp; Pinho"). */
function semEntidades(valor: string) {
  return valor.replace(/&amp;/gi, "&").replace(/&quot;/gi, "\"").replace(/&#0?39;|&apos;/gi, "'");
}

function mapSistema(row: EmpresaSistemaRow): EmpresaCadastro {
  const base = mapRow(row);
  const rua = [row.logradouro, row.numero].map((parte) => parte?.trim()).filter(Boolean).join(", ");
  return {
    ...base,
    razao_social: semEntidades(base.razao_social),
    nome_fantasia: semEntidades(base.nome_fantasia),
    endereco: [rua, row.complemento?.trim(), row.bairro?.trim()].filter(Boolean).join(" - "),
    cidade: row.cidade?.trim() ?? "",
    estado: (row.uf ?? "").trim().toUpperCase(),
    representante: semEntidades(row.responsavel?.trim() ?? ""),
  };
}

function tabelaAusente(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "42703";
}

/**
 * Empresas para o TCE. Vem de dna_work.empresa — onde ficam todas as empresas cadastradas — e não mais só de
 * public.empresa (cópia usada pela Triagem), que não tinha todas: empresa cadastrada não aparecia no TCE.
 */
export async function listEmpresasCadastro(db: Pick<Pool, "query">): Promise<EmpresaCadastro[]> {
  try {
    const { rows } = await db.query<EmpresaSistemaRow>(`
      SELECT ${COLUNAS_SISTEMA} FROM dna_work.empresa
      ORDER BY (status::text = '1') DESC, coalesce(nullif(btrim(nome_fantasia), ''), razao_social)
    `);
    return rows.map(mapSistema);
  } catch (error) {
    if (!tabelaAusente(error)) throw error;
    const { rows } = await db.query<EmpresaRow>(`SELECT ${COLUNAS} FROM public.empresa ORDER BY razao_social`);
    return rows.map(mapRow);
  }
}

export async function getEmpresaCadastro(db: Pick<Pool, "query">, id: string): Promise<EmpresaCadastro | null> {
  const limpo = id.trim();
  if (!limpo) return null;
  try {
    const { rows } = await db.query<EmpresaSistemaRow>(`SELECT ${COLUNAS_SISTEMA} FROM dna_work.empresa WHERE id_empresa::text = $1`, [limpo]);
    if (rows[0]) return mapSistema(rows[0]);
  } catch (error) {
    if (!tabelaAusente(error)) throw error;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpo)) return null;
  const { rows } = await db.query<EmpresaRow>(`SELECT ${COLUNAS} FROM public.empresa WHERE id = $1`, [limpo]);
  return rows[0] ? mapRow(rows[0]) : null;
}
