export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type Envelope<T> = { success: boolean; data: T; meta?: Record<string, number | string | boolean | null> };

export async function api<T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => null) as Envelope<T> & { error?: { code: string; message: string; details?: Record<string, unknown> } } | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(response.status, body?.error?.code ?? "ERRO", body?.error?.message ?? "Não foi possível concluir a operação.", body?.error?.details);
  }
  return body;
}

export function idempotencyKey(): string {
  return crypto.randomUUID();
}
