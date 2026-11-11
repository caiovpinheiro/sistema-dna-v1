import { AppError } from "./errors.js";

const LOGIN_URL = "https://cursos.dnawork.ai/login";
const CHAVES_SENHA = ["password", "senha", "plainPassword", "temporaryPassword", "generatedPassword"];

export type AcessoLmsInput = {
  token: string;
  baseUrl?: string;
  name: string;
  email: string;
  trails?: string[];
  password?: string;
  resetPassword?: boolean;
  fetchImpl?: typeof fetch;
};

export type AcessoLms = {
  name: string;
  email: string;
  trails: string[];
  password: string | null;
  contaNova: boolean | null;
  loginUrl: string;
};

/** Cria ou reaproveita o aluno no LMS. A senha só volta quando o LMS a definiu nesta chamada. */
export async function criarAcessoLms(input: AcessoLmsInput): Promise<AcessoLms> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new AppError(422, "NOME_AUSENTE", "O candidato precisa ter nome para criar o acesso.");
  if (!email.includes("@")) throw new AppError(422, "EMAIL_AUSENTE", "O candidato precisa ter e-mail para criar o acesso.");

  const trails = [...new Set((input.trails ?? []).map((item) => item.trim()).filter(Boolean))];
  if (trails.some((item) => item.length > 80)) {
    throw new AppError(422, "TRILHA_INVALIDA", "Cada trilha pode ter no máximo 80 caracteres.");
  }
  const password = input.password?.trim() || undefined;
  if (password && password.length < 8) {
    throw new AppError(422, "SENHA_CURTA", "A senha precisa ter pelo menos 8 caracteres.");
  }

  const token = input.token.trim();
  if (!token) {
    throw new AppError(503, "LMS_INDISPONIVEL", "O LMS não está configurado. Defina LMS_ACCESS_TOKEN no ambiente.");
  }

  const body: Record<string, unknown> = { name, email };
  if (trails.length) body.trails = trails;
  if (password) body.password = password;
  if (input.resetPassword) body.resetPassword = true;

  const base = (input.baseUrl || "https://cursos.dnawork.ai").replace(/\/$/, "");
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${base}/api/integracao/acessos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AppError(502, "LMS_INDISPONIVEL", "Não foi possível falar com o LMS.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) throw erroDoLms(response.status);
  return {
    name,
    email,
    trails,
    password: senhaDaResposta(payload),
    contaNova: contaNova(payload),
    loginUrl: LOGIN_URL,
  };
}

function erroDoLms(status: number): AppError {
  if (status === 401) return new AppError(502, "LMS_CREDENCIAL", "A credencial do LMS foi recusada.");
  if (status === 422) return new AppError(422, "TRILHA_INEXISTENTE", "A trilha informada não existe no LMS.");
  if (status === 503) return new AppError(503, "LMS_INDISPONIVEL", "O LMS não está configurado.");
  return new AppError(502, "LMS_INDISPONIVEL", "O LMS não concluiu a criação do acesso.");
}

function senhaDaResposta(payload: unknown): string | null {
  const visitados = new Set<unknown>();
  const fila: unknown[] = [payload];
  while (fila.length) {
    const atual = fila.shift();
    if (!atual || typeof atual !== "object" || visitados.has(atual)) continue;
    visitados.add(atual);
    const registro = atual as Record<string, unknown>;
    for (const chave of CHAVES_SENHA) {
      const valor = registro[chave];
      if (typeof valor === "string" && valor.trim()) return valor;
    }
    for (const aninhado of [registro.data, registro.aluno, registro.student, registro.user]) {
      if (aninhado && typeof aninhado === "object") fila.push(aninhado);
    }
  }
  return null;
}

function contaNova(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const registro = payload as Record<string, unknown>;
  const data = registro.data && typeof registro.data === "object" ? registro.data as Record<string, unknown> : null;
  const criado = registro.created ?? data?.created;
  const jaExistia = registro.alreadyExists ?? data?.alreadyExists ?? registro.exists ?? data?.exists;
  if (criado === true || jaExistia === false) return true;
  if (criado === false || jaExistia === true) return false;
  return null;
}
