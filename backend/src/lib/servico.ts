export async function pingServico(baseUrl: string, token: string): Promise<{ ok: boolean; servico?: string }> {
  if (!baseUrl || !token) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/servico/ping`, {
      headers: { "x-service-token": token },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { data?: { servico?: string } };
    return { ok: true, servico: body.data?.servico };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

export function tokenDoServico(header: string | string[] | undefined, esperado: string): boolean {
  if (!esperado) return false;
  const recebido = Array.isArray(header) ? header[0] : header;
  return recebido === esperado;
}
