import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * PKI DESCARTÁVEL para testes (openssl). Nada daqui é usado fora de testes e nenhum arquivo vai para o Git.
 * Emite certificados com datas arbitrárias (inclusive expirados ou futuros) usando `openssl ca`.
 */
export type Par = { cert: string; key: string };
export type Pki = {
  dir: string;
  ca: Par;
  emitir(nome: string, opcoes: { cn?: string; san?: string[]; tipo: "servidor" | "cliente"; inicio?: string; fim?: string; dias?: number; semSan?: boolean }): Par;
  novaCa(nome: string): Pki;
  limpar(): void;
};

const openssl = (args: string[], env: Record<string, string> = {}) =>
  execFileSync("openssl", args, { stdio: "pipe", env: { ...process.env, ...env } });

export function temOpenssl(): boolean {
  try {
    openssl(["version"]);
    return true;
  } catch {
    return false;
  }
}

export function criarPki(nome = "ca-teste", pai?: string): Pki {
  const dir = fs.mkdtempSync(path.join(pai ?? os.tmpdir(), "mcp-pki-"));
  fs.mkdirSync(path.join(dir, "novos"));
  fs.writeFileSync(path.join(dir, "index.txt"), "");
  fs.writeFileSync(path.join(dir, "serial"), "1000\n");
  const cfg = path.join(dir, "ca.cnf");
  fs.writeFileSync(cfg, `
[ca]
default_ca = CA_default
[CA_default]
dir = ${dir}
database = ${dir}/index.txt
new_certs_dir = ${dir}/novos
serial = ${dir}/serial
default_md = sha256
policy = pol
unique_subject = no
copy_extensions = none
[pol]
commonName = supplied
[v3_servidor]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $ENV::SAN
[v3_servidor_sem_san]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[v3_cliente]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
`);
  const caKey = path.join(dir, "ca.key.pem");
  const caCert = path.join(dir, "ca.cert.pem");
  openssl(["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", caKey]);
  openssl(["req", "-x509", "-new", "-key", caKey, "-sha256", "-days", "30", "-subj", `/CN=${nome}`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", caCert]);
  let contador = 0;
  const pki: Pki = {
    dir,
    ca: { cert: caCert, key: caKey },
    emitir(nomeArquivo, o) {
      contador += 1;
      const base = path.join(dir, `${nomeArquivo}-${contador}`);
      const key = `${base}.key.pem`;
      const csr = `${base}.csr`;
      const cert = `${base}.cert.pem`;
      openssl(["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", key]);
      openssl(["req", "-new", "-key", key, "-subj", `/CN=${o.cn ?? nomeArquivo}`, "-out", csr]);
      const secao = o.tipo === "cliente" ? "v3_cliente" : o.semSan ? "v3_servidor_sem_san" : "v3_servidor";
      const datas = o.inicio && o.fim ? ["-startdate", o.inicio, "-enddate", o.fim] : ["-days", String(o.dias ?? 7)];
      const san = (o.san ?? ["DNS:localhost", "IP:127.0.0.1"]).join(",");
      openssl(["ca", "-batch", "-config", cfg, "-keyfile", caKey, "-cert", caCert, "-extensions", secao, "-in", csr, "-out", cert, "-notext", ...datas], { SAN: san });
      return { cert, key };
    },
    novaCa: (outroNome) => criarPki(outroNome, dir),
    limpar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return pki;
}
