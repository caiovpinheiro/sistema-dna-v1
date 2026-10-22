import { AppError } from "./errors.js";

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

const COLUMNS = "id,razao_social,nome_fantasia,cnpj,email,cep,logradouro,numero,complemento";

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

async function supabaseGet<T>(baseUrl: string, key: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new AppError(502, "CADASTRO_INDISPONIVEL", "Não foi possível consultar as empresas.");
  return response.json() as Promise<T>;
}

export async function listEmpresasCadastro(url: string, key: string): Promise<EmpresaCadastro[]> {
  if (!url || !key) throw new AppError(503, "CADASTRO_NAO_CONFIGURADO", "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  const rows = await supabaseGet<EmpresaRow[]>(url, key, `empresa?select=${COLUMNS}&order=razao_social.asc`);
  return rows.map(mapRow);
}

export async function getEmpresaCadastro(url: string, key: string, id: string): Promise<EmpresaCadastro | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (!url || !key) throw new AppError(503, "CADASTRO_NAO_CONFIGURADO", "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  const rows = await supabaseGet<EmpresaRow[]>(url, key, `empresa?id=eq.${id}&select=${COLUMNS}`);
  return rows[0] ? mapRow(rows[0]) : null;
}
