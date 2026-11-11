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

export async function listEmpresasCadastro(db: Pick<Pool, "query">): Promise<EmpresaCadastro[]> {
  const { rows } = await db.query<EmpresaRow>(`SELECT ${COLUNAS} FROM public.empresa ORDER BY razao_social`);
  return rows.map(mapRow);
}

export async function getEmpresaCadastro(db: Pick<Pool, "query">, id: string): Promise<EmpresaCadastro | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await db.query<EmpresaRow>(`SELECT ${COLUNAS} FROM public.empresa WHERE id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}
