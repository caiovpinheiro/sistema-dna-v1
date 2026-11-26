import type { GatewayConfig } from "./config.js";
import { MonolitoClient, MonolitoIndisponivel } from "./monolito.js";
import type { CertStore } from "./tls.js";

export type Prontidao = { pronto: boolean; motivos: string[]; diasCertificado?: number; verificadoEm: string };

/**
 * Prontidão (/ready): certificados válidos + monólito alcançável + contrato compatível + issuer e URL pública
 * idênticos aos do monólito. Não derruba o processo: só tira o gateway do balanceamento e responde 503 nas chamadas.
 */
export class Verificador {
  private cache: { em: number; valor: Prontidao } | null = null;
  encerrando = false;
  constructor(private readonly cfg: GatewayConfig, private readonly monolito: MonolitoClient, private readonly certs: CertStore | null) {}

  /** Uma falha real de chamada derruba o "pronto" em cache na hora (a próxima sonda reavalia). */
  invalidar() { this.cache = null; }

  async verificar(forcar = false): Promise<Prontidao> {
    const agora = Date.now();
    if (!forcar && this.cache && agora - this.cache.em < (this.cache.valor.pronto ? 5_000 : 1_500)) return this.cache.valor;
    const motivos: string[] = [];
    let dias: number | undefined;
    if (this.encerrando) motivos.push("encerrando");
    if (this.certs) {
      const estado = this.certs.estado();
      if (!estado.ok) motivos.push(`certificado: ${estado.motivo}`); else dias = estado.diasRestantes;
    }
    if (!motivos.some((m) => m.startsWith("certificado"))) {
      try {
        const r = await this.monolito.saude();
        const d = r.json?.data;
        if (r.status !== 200 || !d) motivos.push(`monolito: resposta ${r.status}`);
        else {
          if (!Array.isArray(d.contratos) || !d.contratos.includes(this.cfg.contrato)) motivos.push(`contrato ${this.cfg.contrato} não suportado pelo monólito (${JSON.stringify(d.contratos)})`);
          if (d.issuer !== this.cfg.issuerUrl) motivos.push("issuer do monólito diferente de MONOLITO_ISSUER_URL");
          if (d.publicUrl !== this.cfg.publicUrl) motivos.push("URL pública do monólito diferente de MCP_PUBLIC_URL");
        }
      } catch (e) {
        motivos.push(e instanceof MonolitoIndisponivel ? `${e.codigo.toLowerCase()}` : "monolito: erro");
      }
    }
    const valor: Prontidao = { pronto: motivos.length === 0, motivos, diasCertificado: dias, verificadoEm: new Date().toISOString() };
    this.cache = { em: agora, valor };
    return valor;
  }
}
