import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { criarAmbiente, type Ambiente } from "./mcp-suporte.js";

let amb: Ambiente;
let dir: string;
let porta = 0;
let temOpenssl = true;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tls-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem"), "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  } catch {
    temOpenssl = false;
    return;
  }
  amb = await criarAmbiente({
    MCP_INTERNAL_TLS_CERT: path.join(dir, "cert.pem"),
    MCP_INTERNAL_TLS_KEY: path.join(dir, "key.pem"),
    MCP_INTERNAL_TLS_CA: path.join(dir, "cert.pem"), // mTLS: só quem apresenta certificado desta CA entra
  });
  await amb.app.mcp!.interno.listen({ port: 0, host: "127.0.0.1" });
  porta = (amb.app.mcp!.interno.server.address() as { port: number }).port;
});
after(async () => { await amb?.fechar(); });

function pedir(opcoes: https.RequestOptions): Promise<number> {
  return new Promise((resolver, rejeitar) => {
    const req = https.request({ host: "127.0.0.1", port: porta, path: "/internal/mcp/x/ferramentas", method: "POST", ca: fs.readFileSync(path.join(dir, "cert.pem")), servername: "localhost", headers: { "content-type": "application/json" }, ...opcoes }, (res) => {
      res.resume();
      resolver(res.statusCode ?? 0);
    });
    req.on("error", rejeitar);
    req.end("{}");
  });
}

test("listener interno com TLS: quem não apresenta certificado de cliente (mTLS) nem chega à aplicação", async (t) => {
  if (!temOpenssl) return t.skip("openssl indisponível");
  await assert.rejects(() => pedir({}));
});

test("listener interno com mTLS: com certificado válido chega à aplicação, que ainda exige a assinatura HMAC", async (t) => {
  if (!temOpenssl) return t.skip("openssl indisponível");
  const status = await pedir({ cert: fs.readFileSync(path.join(dir, "cert.pem")), key: fs.readFileSync(path.join(dir, "key.pem")) });
  assert.equal(status, 401);
});

test("listener interno com TLS não responde em HTTP puro", async (t) => {
  if (!temOpenssl) return t.skip("openssl indisponível");
  const resposta = await fetch(`http://127.0.0.1:${porta}/internal/mcp/x/ferramentas`, { method: "POST", body: "{}" }).then((r) => r.status, () => 0);
  assert.equal(resposta, 0, "respondeu em HTTP sem TLS");
});
