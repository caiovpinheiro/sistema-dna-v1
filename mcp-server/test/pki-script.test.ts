import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validarMaterial } from "../src/tls.js";
import { validarMaterialTls } from "../../backend/src/mcp/tls-interno.js";

const script = path.resolve(import.meta.dirname, "../scripts/mtls-pki.sh");
const sh = (...args: string[]) => execFileSync("bash", [script, ...args], { encoding: "utf8", stdio: "pipe" });

test("script de emissão: CA, servidor e cliente emitidos; aceitos pelo monólito e pelo gateway; chaves 0600", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pki-script-"));
  try {
    sh("ca", dir);
    sh("servidor", dir, "--nome", "monolito", "--san", "DNS:monolito,DNS:localhost,IP:127.0.0.1", "--dias", "30");
    sh("cliente", dir, "--nome", "gateway-mcp", "--dias", "30");
    for (const chave of ["ca.key.pem", "monolito.key.pem", "gateway-mcp.key.pem"]) assert.equal((fs.statSync(path.join(dir, chave)).mode & 0o777).toString(8), "600", chave);
    const servidor = validarMaterialTls({ cert: path.join(dir, "monolito.cert.pem"), key: path.join(dir, "monolito.key.pem"), ca: path.join(dir, "ca-bundle.pem") });
    assert.ok(servidor.diasRestantes >= 29);
    const cliente = validarMaterial({ cert: path.join(dir, "gateway-mcp.cert.pem"), key: path.join(dir, "gateway-mcp.key.pem"), ca: path.join(dir, "ca-bundle.pem") }, new Date());
    assert.ok(cliente.diasRestantes >= 29);
    const verificar = sh("verificar", dir);
    assert.match(verificar, /monolito\.cert\.pem: cadeia=ok/);
    assert.match(verificar, /gateway-mcp\.cert\.pem: cadeia=ok/);
    assert.match(verificar, /SAN: .*DNS:monolito/);
    // CA existente não é sobrescrita.
    assert.notEqual(spawnSync("bash", [script, "ca", dir]).status, 0);
    // Certificado perto de vencer faz o verificador falhar (alerta de renovação).
    sh("cliente", dir, "--nome", "gw-quase-vencendo", "--dias", "5");
    assert.notEqual(spawnSync("bash", [script, "verificar", dir], { encoding: "utf8" }).status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("script de emissão recusa gravar dentro de um repositório Git (nunca vai para o GitHub)", () => {
  const raiz = path.resolve(import.meta.dirname, "../..");
  const dentro = path.join(raiz, ".tmp-pki-recusado");
  try {
    const r = spawnSync("bash", [script, "ca", dentro], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /RECUSADO/);
    assert.ok(!fs.existsSync(path.join(dentro, "ca.key.pem")));
  } finally { fs.rmSync(dentro, { recursive: true, force: true }); }
});
