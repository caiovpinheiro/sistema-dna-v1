import { createHash, createHmac } from "node:crypto";

/**
 * Assinatura do contrato interno v1 (gateway → monólito). Precisa ser idêntica à do monólito
 * (backend/src/mcp/assinatura.ts); o teste ponta a ponta garante a compatibilidade.
 */
const PREFIXO = "DNAWORK-MCP-HMAC-V1";
const sha256Hex = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

export type CamposAssinados = {
  metodo: string; caminho: string; contrato: number; chave: string; timestamp: number;
  nonce: string; requestId: string; corpo: Buffer | string; token: string | null;
};

export function stringAssinada(c: CamposAssinados): string {
  return [PREFIXO, c.metodo.toUpperCase(), c.caminho, String(c.contrato), c.chave, String(c.timestamp), c.nonce, c.requestId, sha256Hex(c.corpo), c.token ? sha256Hex(c.token) : "-"].join("\n");
}

export const assinar = (segredo: string, c: CamposAssinados) => createHmac("sha256", segredo).update(stringAssinada(c)).digest("base64url");
