import { createHmac } from "node:crypto";
import { iguaisSeguro, sha256Hex } from "./util.js";

/**
 * Assinatura gateway → monólito (contrato interno v1).
 * Cobre tudo que muda o sentido da requisição: método, caminho com query, versão do contrato, chave,
 * instante, nonce, id de rastreio, hash do corpo e hash do token do usuário (o token em si nunca entra).
 * O mesmo algoritmo é implementado no mcp-server (Fase 2B); mudar aqui exige subir o contrato.
 */
export const CONTRATO_VERSAO = 1;
export const CONTRATOS_SUPORTADOS = [1];
const PREFIXO = "DNAWORK-MCP-HMAC-V1";

export type CamposAssinados = {
  metodo: string;
  caminho: string; // path + query exatamente como enviado
  contrato: number;
  chave: string;
  timestamp: number; // segundos desde 1970
  nonce: string;
  requestId: string;
  corpo: Buffer | string;
  token: string | null;
};

export function stringAssinada(campos: CamposAssinados): string {
  return [
    PREFIXO,
    campos.metodo.toUpperCase(),
    campos.caminho,
    String(campos.contrato),
    campos.chave,
    String(campos.timestamp),
    campos.nonce,
    campos.requestId,
    sha256Hex(campos.corpo),
    campos.token ? sha256Hex(campos.token) : "-",
  ].join("\n");
}

export function assinar(segredo: string, campos: CamposAssinados): string {
  return createHmac("sha256", segredo).update(stringAssinada(campos)).digest("base64url");
}

export function assinaturaConfere(segredo: string, campos: CamposAssinados, recebida: string): boolean {
  return iguaisSeguro(assinar(segredo, campos), recebida);
}

export type Segredos = Map<string, string>;

/** "k2:segredo,k1:antigo" → Map(id → segredo). Rejeita segredo curto ou id repetido. */
export function lerSegredos(texto: string): Segredos {
  const mapa: Segredos = new Map();
  for (const parte of texto.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separador = parte.indexOf(":");
    const id = separador > 0 ? parte.slice(0, separador) : "";
    const segredo = separador > 0 ? parte.slice(separador + 1) : "";
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error("MCP_GATEWAY_SECRETS: id inválido (use letras, números, _ ou -).");
    if (segredo.length < 32) throw new Error("MCP_GATEWAY_SECRETS: cada segredo precisa ter pelo menos 32 caracteres.");
    if (mapa.has(id)) throw new Error("MCP_GATEWAY_SECRETS: id repetido.");
    mapa.set(id, segredo);
  }
  return mapa;
}
