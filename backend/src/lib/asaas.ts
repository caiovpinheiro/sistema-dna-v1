import { AppError } from "./errors.js";

type AsaasErrorBody = { errors?: Array<{ description?: string }> };

export class AsaasClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.apiKey) {
      throw new AppError(503, "ASAAS_NAO_CONFIGURADO", "Defina ASAAS_API_KEY no ambiente.");
    }
    const response = await fetch(this.url(path), {
      method,
      headers: {
        accept: "application/json",
        access_token: this.apiKey,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => null) as (T & AsaasErrorBody) | null;
    if (!response.ok) {
      const detail = payload?.errors?.map((item) => item.description).filter(Boolean).join(" ");
      throw new AppError(502, "ASAAS_RECUSOU", detail || "O Asaas não aceitou a operação.");
    }
    return payload as T;
  }

  criarCliente(body: Record<string, unknown>) {
    return this.request<{ id: string }>("POST", "/v3/customers", body);
  }

  atualizarCliente(id: string, body: Record<string, unknown>) {
    return this.request<{ id: string }>("PUT", `/v3/customers/${id}`, body);
  }

  criarCobranca(body: Record<string, unknown>) {
    return this.request<{ id: string; invoiceUrl?: string; invoiceNumber?: string; netValue?: number; status?: string }>("POST", "/v3/payments", body);
  }

  consultarCobranca(id: string) {
    return this.request<{ id: string; status?: string; invoiceUrl?: string; netValue?: number; paymentDate?: string | null }>("GET", `/v3/payments/${id}`);
  }

  receberEmDinheiro(id: string, paymentDate: string, value: number) {
    return this.request<{ status?: string; paymentDate?: string }>("POST", `/v3/payments/${id}/receiveInCash`, {
      paymentDate,
      value,
      notifyCustomer: false,
    });
  }

  excluirCobranca(id: string) {
    return this.request<{ deleted?: boolean }>("DELETE", `/v3/payments/${id}`);
  }

  agendarNota(body: Record<string, unknown>) {
    return this.request<{ id: string; status?: string }>("POST", "/v3/invoices", body);
  }

  emitirNota(id: string) {
    return this.request<{ id: string; status?: string; pdfUrl?: string }>("POST", `/v3/invoices/${id}/authorize`);
  }

  consultarNota(id: string) {
    return this.request<{ id: string; status?: string; pdfUrl?: string }>("GET", `/v3/invoices/${id}`);
  }

  cancelarNota(id: string) {
    return this.request<{ id: string; status?: string }>("POST", `/v3/invoices/${id}/cancel`);
  }
}
