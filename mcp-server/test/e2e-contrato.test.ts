import assert from "node:assert/strict";
import https from "node:https";
import fs from "node:fs";
import test from "node:test";
import { criarIntegracao, criarUsuario, obterTokens } from "../../backend/test/mcp-suporte.js";
import { APP_URL, MCP_URL, portaLivre, subirSistema } from "./suporte-e2e.js";

const RECURSO = `${MCP_URL}/mcp/recrutamento`;
const lista = (base: string, t: string) => fetch(`${base}/mcp/recrutamento`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });

test("compatibilidade entre versões consecutivas do contrato interno: monólito N e N+1 aceitam gateway N; gateway N+1 só fala com monólito que já suporta N+1", async () => {
  // Monólito adiantado (aceita 1 e 2): gateway antigo (1) e gateway novo (2) funcionam.
  const a = await subirSistema({ monolitoEnv: { MCP_CONTRATOS: "1,2" } });
  try {
    const ana = await criarUsuario(a.amb, "Ana", ["vagas"]);
    await criarIntegracao(a.amb, "recrutamento", { usuarios: [{ id: ana.id }] });
    const token = (await obterTokens(a.amb, ana, RECURSO)).access_token;
    for (const contrato of ["1", "2"]) {
      const g = await a.novoGateway({ MCP_CONTRATO: contrato });
      assert.equal((await lista(g.base, token)).status, 200, `gateway v${contrato} contra monólito [1,2]`);
      assert.equal((await fetch(`${g.base}/ready`)).status, 200);
      await g.parar();
    }
  } finally { await a.parar(); }

  // Monólito antigo (só 1): gateway novo (2) falha de forma controlada e fica "não pronto".
  const b = await subirSistema();
  try {
    const ana = await criarUsuario(b.amb, "Ana", ["vagas"]);
    await criarIntegracao(b.amb, "recrutamento", { usuarios: [{ id: ana.id }] });
    const token = (await obterTokens(b.amb, ana, RECURSO)).access_token;
    const g = await b.novoGateway({ MCP_CONTRATO: "2" });
    const r = await lista(g.base, token);
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as any).error.code, "CONTRATO_INCOMPATIVEL");
    const ready = await fetch(`${g.base}/ready`);
    assert.equal(ready.status, 503);
    assert.match(JSON.stringify(await ready.json()), /contrato_incompativel/);
    assert.equal((await fetch(`${g.base}/health`)).status, 200);
    await g.parar();
  } finally { await b.parar(); }
});

test("o gateway tolera campos novos e versão de contrato maior nas respostas do monólito (monólito adiantado)", async () => {
  const s = await subirSistema();
  const porta = await portaLivre();
  const servidor = https.createServer({ key: fs.readFileSync(s.certs.servidorKey), cert: fs.readFileSync(s.certs.servidorCert), ca: fs.readFileSync(s.certs.ca), requestCert: true, rejectUnauthorized: true }, (req, res) => {
    const responder = (data: unknown) => { res.writeHead(200, { "content-type": "application/json", "x-mcp-contract-version": "2" }); res.end(JSON.stringify({ success: true, data, meta: { novo: 1 }, extraNivelRaiz: true })); };
    req.resume();
    req.on("end", () => {
      if (req.url === "/internal/mcp/saude") return responder({ contratos: [1, 2], issuer: APP_URL, publicUrl: MCP_URL, tls: null, campoFuturo: { a: 1 } });
      if (req.url?.endsWith("/autenticar")) return responder({ integracao: { slug: "x", nome: "X", instrucoes: null, campoFuturo: 1 }, usuario: { id: "u", apelido: "novo" }, escopos: ["mcp:read"], outro: [] });
      if (req.url?.endsWith("/ferramentas")) return responder({ ferramentas: [{ nome: "ferramenta_futura", titulo: "T", descricao: "D", versao: 2, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, novaDica: true }, outputSchema: { type: "object" }, extra: "x" }], paginacao: { proximo: null } });
      if (req.url?.endsWith("/executar")) return responder({ isError: false, content: [{ type: "text", text: "ok" }], structuredContent: { a: 1 }, telemetria: { ms: 3 } });
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise<void>((ok) => servidor.listen(porta, "127.0.0.1", ok));
  const g = await s.novoGateway({ MONOLITO_INTERNAL_URL: `https://localhost:${porta}` });
  try {
    const token = "t".repeat(43);
    const { client, transport } = s.cliente("xx", token, g.base);
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools[0].name, "ferramenta_futura");
    const r = await client.callTool({ name: "ferramenta_futura", arguments: {} });
    assert.deepEqual(r.structuredContent, { a: 1 });
    assert.ok(!("telemetria" in r), "campo desconhecido não deve ser repassado ao cliente MCP");
    await client.close();
    assert.equal((await fetch(`${g.base}/ready`)).status, 200);
  } finally { await g.parar(); await new Promise((ok) => servidor.close(ok)); await s.parar(); }
});
