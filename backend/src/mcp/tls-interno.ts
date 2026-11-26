import { createPrivateKey, X509Certificate } from "node:crypto";
import fs from "node:fs";
import type { Server } from "node:tls";

export type ArquivosTls = { cert: string; key: string; ca: string };
export type MaterialTls = { key: Buffer; cert: Buffer; ca: Buffer; diasRestantes: number; cns: string[] };

const DIA_MS = 86_400_000;

function lerArquivo(caminho: string, nome: string): Buffer {
  try {
    const dados = fs.readFileSync(caminho);
    if (!dados.length) throw new Error("vazio");
    return dados;
  } catch (error) {
    throw new Error(`TLS interno: não foi possível ler ${nome} (${(error as Error).message}).`);
  }
}

function certificados(pem: Buffer, nome: string): X509Certificate[] {
  const blocos = pem.toString("utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocos.length) throw new Error(`TLS interno: ${nome} não contém certificado PEM.`);
  try {
    return blocos.map((bloco) => new X509Certificate(bloco));
  } catch {
    throw new Error(`TLS interno: ${nome} inválido.`);
  }
}

function dentroDaValidade(cert: X509Certificate, agora: Date, nome: string): number {
  if (new Date(cert.validFrom) > agora) throw new Error(`TLS interno: ${nome} ainda não é válido.`);
  const fim = new Date(cert.validTo);
  if (fim <= agora) throw new Error(`TLS interno: ${nome} expirado.`);
  return Math.floor((fim.getTime() - agora.getTime()) / DIA_MS);
}

/**
 * Valida o material do listener interno e falha fechado: arquivo ausente/ilegível, certificado expirado ou
 * ainda não válido, chave que não casa com o certificado, servidor sem SAN, servidor não emitido por uma CA do bundle.
 */
export function validarMaterialTls(arquivos: ArquivosTls, agora: Date = new Date()): MaterialTls {
  if (!arquivos.cert || !arquivos.key || !arquivos.ca) {
    throw new Error("TLS interno: informe MCP_INTERNAL_TLS_CERT, MCP_INTERNAL_TLS_KEY e MCP_INTERNAL_TLS_CA.");
  }
  const cert = lerArquivo(arquivos.cert, "o certificado do servidor");
  const key = lerArquivo(arquivos.key, "a chave do servidor");
  const ca = lerArquivo(arquivos.ca, "a CA");
  const [servidor] = certificados(cert, "o certificado do servidor");
  const cas = certificados(ca, "a CA");
  let chave;
  try {
    chave = createPrivateKey(key);
  } catch {
    throw new Error("TLS interno: chave do servidor inválida.");
  }
  if (!servidor.checkPrivateKey(chave)) throw new Error("TLS interno: a chave não corresponde ao certificado do servidor.");
  if (!servidor.subjectAltName) throw new Error("TLS interno: o certificado do servidor precisa de SAN.");
  const dias = dentroDaValidade(servidor, agora, "certificado do servidor");
  for (const [indice, autoridade] of cas.entries()) dentroDaValidade(autoridade, agora, `CA #${indice + 1}`);
  if (!cas.some((autoridade) => servidor.checkIssued(autoridade) && servidor.verify(autoridade.publicKey))) {
    throw new Error("TLS interno: o certificado do servidor não foi emitido pela CA informada.");
  }
  return { key, cert, ca, diasRestantes: dias, cns: [] };
}

export function opcoesServidor(material: MaterialTls) {
  // mTLS obrigatório: sem certificado de cliente válido, o handshake falha antes de qualquer HTTP.
  return { key: material.key, cert: material.cert, ca: material.ca, requestCert: true, rejectUnauthorized: true, minVersion: "TLSv1.2" as const };
}

type Log = { info(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; error(o: unknown, m?: string): void };

/**
 * Renovação sem reiniciar: a cada minuto confere se os arquivos mudaram e troca o contexto TLS do listener.
 * Se o material novo for inválido, mantém o anterior e registra o erro (não derruba o serviço).
 */
export function observarTls(servidor: Server, arquivos: ArquivosTls, log: Log, intervaloMs = 60_000): () => void {
  const assinatura = () => [arquivos.cert, arquivos.key, arquivos.ca].map((caminho) => {
    try {
      return String(fs.statSync(caminho).mtimeMs);
    } catch {
      return "ausente";
    }
  }).join("|");
  let ultima = assinatura();
  const temporizador = setInterval(() => {
    const atual = assinatura();
    if (atual === ultima) return;
    ultima = atual;
    try {
      const material = validarMaterialTls(arquivos);
      servidor.setSecureContext(opcoesServidor(material));
      log.info({ diasRestantes: material.diasRestantes }, "mcp tls interno: certificados recarregados");
    } catch (error) {
      log.error({ mensagem: (error as Error).message }, "mcp tls interno: novo material recusado; mantendo o anterior");
    }
  }, intervaloMs);
  temporizador.unref();
  return () => clearInterval(temporizador);
}
