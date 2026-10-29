import { AppError } from "./errors.js";

export type ZapSigner = { name: string; email: string; external_id?: string; papel?: string };
export type ZapSignerResult = {
  name?: string;
  email?: string;
  status?: string;
  sign_url?: string;
  token?: string;
  signed_at?: string | null;
};
export type ZapDoc = {
  token?: string;
  status?: string;
  original_file?: string | null;
  signed_file?: string | null;
  signers?: ZapSignerResult[];
};

export async function criarDocumentoZapSign(input: {
  apiUrl: string;
  apiToken: string;
  userToken?: string;
  folderPath?: string;
  name: string;
  externalId: string;
  pdf: Buffer;
  signers: ZapSigner[];
}): Promise<ZapDoc> {
  if (!input.apiToken) {
    throw new AppError(503, "ZAPSIGN_NAO_CONFIGURADA", "Defina ZAPSIGN_API_TOKEN no ambiente antes de enviar um termo.");
  }
  const url = `${input.apiUrl.replace(/\/$/, "")}/api/v1/docs/?api_token=${encodeURIComponent(input.apiToken)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      external_id: input.externalId,
      lang: "pt-br",
      ...(input.folderPath ? { folder_path: input.folderPath } : {}),
      ...(input.userToken ? { user_token: input.userToken } : {}),
      signers: input.signers.map((signer) => ({
        name: signer.name,
        email: signer.email,
        auth_mode: "tokenEmail",
        lock_email: true,
        external_id: signer.external_id,
      })),
      base64_pdf: input.pdf.toString("base64"),
    }),
  });
  const body = await response.json().catch(() => null) as { detail?: string; message?: string } & ZapDoc | null;
  if (!response.ok || !body?.token) {
    throw new AppError(502, "ZAPSIGN_RECUSOU", "A ZapSign não aceitou o termo.", {
      status: response.status,
    });
  }
  return body;
}

export async function consultarDocumentoZapSign(input: {
  apiUrl: string;
  apiToken: string;
  token: string;
}): Promise<ZapDoc | null> {
  if (!input.apiToken || !input.token) return null;
  const url = `${input.apiUrl.replace(/\/$/, "")}/api/v1/docs/${encodeURIComponent(input.token)}/?api_token=${encodeURIComponent(input.apiToken)}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => null) as ZapDoc | null;
  if (!response.ok || !body?.token) return null;
  return body;
}
