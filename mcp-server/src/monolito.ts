import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { assinar } from "./assinatura.js";
import type { GatewayConfig } from "./config.js";
import { CertStore, ErroCertificado } from "./tls.js";

/** O monólito não pôde ser consultado: rede, TLS/certificado, timeout, contrato ou configuração. Vira 503 controlado. */
export class MonolitoIndisponivel extends Error {
  constructor(public readonly codigo: "MONOLITO_INDISPONIVEL" | "CERTIFICADO_INVALIDO" | "CONTRATO_INCOMPATIVEL" | "CONFIGURACAO_INVALIDA" | "MONOLITO_ERRO", mensagem: string) { super(mensagem); }
}

export type RespostaMonolito = { status: number; json: any; retryAfter?: string };

export class MonolitoClient {
  constructor(private readonly cfg: GatewayConfig, private readonly certs: CertStore | null, private readonly relogio: () => number = () => Date.now()) {}

  private requisitar(caminho: string, corpo: string, token: string | null, requestId: string): Promise<RespostaMonolito> {
    const cfg = this.cfg;
    const nonce = randomBytes(18).toString("base64url");
    const timestamp = Math.floor(this.relogio() / 1000);
    const assinatura = assinar(cfg.secret, { metodo: "POST", caminho, contrato: cfg.contrato, chave: cfg.keyId, timestamp, nonce, requestId, corpo, token });
    const tls = cfg.monolito.protocol === "https:";
    let agent: https.Agent | undefined;
    if (tls) {
      try { agent = this.certs!.obter(); } catch (e) {
        return Promise.reject(new MonolitoIndisponivel("CERTIFICADO_INVALIDO", e instanceof ErroCertificado ? e.message : "certificado indisponível"));
      }
    }
    return new Promise((resolver, rejeitar) => {
      const opcoes: https.RequestOptions = {
        host: cfg.monolito.hostname, port: cfg.monolito.port || (tls ? 443 : 80), path: caminho, method: "POST",
        timeout: cfg.requestTimeoutMs,
        headers: {
          "content-type": "application/json", "content-length": Buffer.byteLength(corpo),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "x-mcp-contract": String(cfg.contrato), "x-mcp-key-id": cfg.keyId, "x-mcp-timestamp": String(timestamp),
          "x-mcp-nonce": nonce, "x-mcp-request-id": requestId, "x-mcp-signature": assinatura,
        },
        ...(tls ? { agent, servername: cfg.servername } : {}),
      };
      const req = (tls ? https : http).request(opcoes, (res) => {
        const partes: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > 2_000_000) { req.destroy(new Error("resposta grande demais")); return; }
          partes.push(c);
        });
        res.on("end", () => {
          let json: unknown = null;
          try { json = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { /* corpo não JSON */ }
          resolver({ status: res.statusCode ?? 0, json, retryAfter: typeof res.headers["retry-after"] === "string" ? res.headers["retry-after"] : undefined });
        });
        res.on("error", rejeitar);
      });
      let conectado = false;
      req.on("socket", (socket) => {
        const limite = setTimeout(() => { if (!conectado) req.destroy(Object.assign(new Error("tempo de conexão esgotado"), { code: "ETIMEDOUT" })); }, cfg.connectTimeoutMs);
        limite.unref();
        const ok = () => { conectado = true; clearTimeout(limite); };
        if (!socket.connecting && (!tls || (socket as import("node:tls").TLSSocket).authorized !== undefined)) ok(); else socket.once(tls ? "secureConnect" : "connect", ok);
        socket.once("close", () => clearTimeout(limite));
      });
      req.on("timeout", () => req.destroy(Object.assign(new Error("tempo esgotado"), { code: "ETIMEDOUT" })));
      req.on("error", rejeitar);
      req.end(corpo);
    }).catch((e: NodeJS.ErrnoException) => {
      const tlsErro = /cert|ssl|tls|altname|self.signed|unable to verify|handshake|ECONNRESET|socket hang up/i.test(`${e.code ?? ""} ${e.message}`);
      if (e instanceof MonolitoIndisponivel) throw e;
      throw new MonolitoIndisponivel(tlsErro && tls && e.code !== "ECONNREFUSED" ? "CERTIFICADO_INVALIDO" : "MONOLITO_INDISPONIVEL", "O serviço interno não respondeu.");
    }) as Promise<RespostaMonolito>;
  }

  /**
   * Chamada ao contrato interno. Erros do gateway ↔ monólito (assinatura, contrato, 5xx) viram MonolitoIndisponivel;
   * erros de negócio (401 do token, 403, 404, 429) voltam como resposta para o chamador mapear.
   */
  async chamar(caminho: string, opcoes: { token?: string | null; corpo?: unknown; requestId?: string } = {}): Promise<RespostaMonolito> {
    const r = await this.requisitar(caminho, JSON.stringify(opcoes.corpo ?? {}), opcoes.token ?? null, opcoes.requestId ?? randomUUID());
    const codigo = r.json?.error?.code as string | undefined;
    if (r.status === 400 && codigo === "CONTRATO_NAO_SUPORTADO") throw new MonolitoIndisponivel("CONTRATO_INCOMPATIVEL", "Versão do contrato interno incompatível.");
    if (r.status === 401 && (codigo === "ASSINATURA_INVALIDA" || codigo === "CERTIFICADO_CLIENTE_INVALIDO")) throw new MonolitoIndisponivel("CONFIGURACAO_INVALIDA", "O monólito recusou a identidade do gateway.");
    if (r.status === 403 && codigo === "CERTIFICADO_CLIENTE_NAO_PERMITIDO") throw new MonolitoIndisponivel("CONFIGURACAO_INVALIDA", "O monólito recusou o certificado do gateway.");
    if (r.status >= 500 || r.status === 0 || r.json === null) throw new MonolitoIndisponivel("MONOLITO_ERRO", "O serviço interno respondeu com erro.");
    return r;
  }

  integracao = (slug: string, requestId?: string) => this.chamar(`/internal/mcp/${slug}/integracao`, { requestId });
  autenticar = (slug: string, token: string, requestId?: string) => this.chamar(`/internal/mcp/${slug}/autenticar`, { token, requestId });
  ferramentas = (slug: string, token: string, requestId?: string) => this.chamar(`/internal/mcp/${slug}/ferramentas`, { token, requestId });
  executar = (slug: string, token: string, corpo: { ferramenta: string; argumentos: unknown }, requestId?: string) => this.chamar(`/internal/mcp/${slug}/executar`, { token, corpo, requestId });
  saude = () => this.chamar("/internal/mcp/saude");
}
