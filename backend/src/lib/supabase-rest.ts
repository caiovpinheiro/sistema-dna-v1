import { AppError } from "./errors.js";

type SupabaseAuth = { url: string; key: string };

export function supabaseRest(auth: SupabaseAuth) {
  const base = `${auth.url.replace(/\/$/, "")}/rest/v1`;
  const headers = {
    apikey: auth.key,
    Authorization: `Bearer ${auth.key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!response.ok) {
      const body = await response.text();
      let message = "Falha ao gravar no Supabase.";
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        message = body.slice(0, 240) || message;
      }
      throw new AppError(502, "SUPABASE", message);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    get<T>(path: string) {
      return request<T>(path);
    },
    insert<T>(table: string, body: unknown) {
      return request<T>(table, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      });
    },
    update(path: string, body: unknown) {
      return request<void>(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
    },
    remove(path: string) {
      return request<void>(path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
  };
}
