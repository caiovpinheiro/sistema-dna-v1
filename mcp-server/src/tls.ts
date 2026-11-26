import { createPrivateKey, X509Certificate } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import type { GatewayConfig } from "./config.js";

export class ErroCertificado extends Error {}

const DIA_MS = 86_400_000;

function ler(caminho: string, nome: string): Buffer {
  try {
    const dados = fs.readFileSync(caminho);
    if (!dados.length) throw new Error("vazio");
    return dados;
  } catch (e) {
    throw new ErroCertificado(`não foi possível ler ${nome} (${(e as Error).message})`);
  }
}

function pems(buf: Buffer, nome: string): X509Certificate[] {
  const blocos = buf.toString("utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocos.length) throw new ErroCertificado(`${nome} não contém certificado PEM`);
  try { return blocos.map((b) => new X509Certificate(b)); } catch { throw new ErroCertificado(`${nome} inválido`); }
}

export type Material = { ca: Buffer; cert: Buffer; key: Buffer; diasRestantes: number };

/** Valida o par de cliente e a CA. Falha fechada: ausente, ilegível, expirado, ainda não válido, chave que não casa ou fora da CA. */
export function validarMaterial(arq: { ca: string; cert: string; key: string }, agora: Date): Material {
  const ca = ler(arq.ca, "a CA");
  const cert = ler(arq.cert, "o certificado do gateway");
  const key = ler(arq.key, "a chave do gateway");
  const cas = pems(ca, "a CA");
  const [cliente] = pems(cert, "o certificado do gateway");
  let chave;
  try { chave = createPrivateKey(key); } catch { throw new ErroCertificado("chave do gateway inválida"); }
  if (!cliente.checkPrivateKey(chave)) throw new ErroCertificado("a chave não corresponde ao certificado do gateway");
  const verificar = (c: X509Certificate, nome: string) => {
    if (new Date(c.validFrom) > agora) throw new ErroCertificado(`${nome} ainda não é válido`);
    if (new Date(c.validTo) <= agora) throw new ErroCertificado(`${nome} expirado`);
  };
  verificar(cliente, "certificado do gateway");
  cas.forEach((c, i) => verificar(c, `CA #${i + 1}`));
  if (!cas.some((c) => cliente.checkIssued(c) && cliente.verify(c.publicKey))) throw new ErroCertificado("o certificado do gateway não foi emitido pela CA informada");
  return { ca, cert, key, diasRestantes: Math.floor((new Date(cliente.validTo).getTime() - agora.getTime()) / DIA_MS) };
}

/**
 * Guarda o material mTLS e o recarrega quando os arquivos mudam (renovação sem reiniciar).
 * A validade é conferida a CADA uso, com o relógio atual: certificado vencido derruba as chamadas na hora (falha fechada).
 */
export class CertStore {
  private agente: https.Agent | null = null;
  private assinatura = "";
  private ultimoCheck = 0;
  private material: Material | null = null;
  private erro: string | null = null;

  constructor(private readonly arq: { ca: string; cert: string; key: string }, private readonly intervaloMs: number, private readonly agora: () => Date = () => new Date()) {}

  private mtimes() {
    return [this.arq.ca, this.arq.cert, this.arq.key].map((c) => { try { return String(fs.statSync(c).mtimeMs); } catch { return "ausente"; } }).join("|");
  }

  /** Devolve o agente https com o material atual, ou lança ErroCertificado. */
  obter(): https.Agent {
    const agora = this.agora();
    if (!this.agente || agora.getTime() - this.ultimoCheck > this.intervaloMs || this.assinatura !== this.mtimes()) {
      this.ultimoCheck = agora.getTime();
      this.assinatura = this.mtimes();
      try {
        this.material = validarMaterial(this.arq, agora);
        this.agente?.destroy();
        this.agente = new https.Agent({ ca: this.material.ca, cert: this.material.cert, key: this.material.key, keepAlive: true, maxSockets: 64, minVersion: "TLSv1.2" });
        this.erro = null;
      } catch (e) {
        this.agente?.destroy();
        this.agente = null;
        this.material = null;
        this.erro = (e as Error).message;
      }
    }
    if (!this.agente || !this.material) throw new ErroCertificado(this.erro ?? "certificado indisponível");
    // O agente em cache pode ter passado da validade desde a última checagem.
    validarMaterial(this.arq, agora);
    return this.agente;
  }

  estado(): { ok: boolean; motivo?: string; diasRestantes?: number } {
    try { this.obter(); return { ok: true, diasRestantes: this.material?.diasRestantes }; } catch (e) { return { ok: false, motivo: (e as Error).message }; }
  }

  fechar() { this.agente?.destroy(); this.agente = null; }
}
