import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { criarIntegracao, criarUsuario, obterTokens } from "../../backend/test/mcp-suporte.js";
import { MCP_URL, subirSistema, type Sistema } from "./suporte-e2e.js";

/** MCP Inspector oficial (CLI), versão fixa. Precisa de rede para baixar o pacote do npm na primeira execução. */
const INSPECTOR = "@modelcontextprotocol/inspector@2.16.0";
let s: Sistema;
let token: string;
let catalogo: string;

before(async () => {
  s = await subirSistema();
  const ana = await criarUsuario(s.amb, "Ana", ["vagas"]);
  await criarIntegracao(s.amb, "recrutamento", { usuarios: [{ id: ana.id }] });
  await s.amb.db.query("INSERT INTO dna_work.empresa (id_empresa, nome_fantasia) VALUES ('E1', 'Loja Alfa')");
  await s.amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, status) VALUES ('V1', 'E1', 'Atendente', 2, 0)");
  token = (await obterTokens(s.amb, ana, `${MCP_URL}/mcp/recrutamento`)).access_token;
  catalogo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insp-")), "mcp.json");
});
after(async () => { await s?.parar(); });

function inspector(args: string[], comToken = true): Promise<{ codigo: number | null; saida: string }> {
  return new Promise((ok) => {
    const filho = spawn("npx", ["-y", INSPECTOR, "--cli", `${s.base}/mcp/recrutamento`, "--transport", "http", ...(comToken ? ["--header", `Authorization: Bearer ${token}`] : []), ...args], { env: { ...process.env, MCP_CATALOG_PATH: catalogo }, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    filho.stdout.on("data", (d) => { saida += d; });
    filho.stderr.on("data", (d) => { saida += d; });
    const t = setTimeout(() => filho.kill("SIGKILL"), 120_000);
    filho.on("exit", (c) => { clearTimeout(t); ok({ codigo: c, saida }); });
  });
}

test("MCP Inspector (CLI): tools/list descobre a ferramenta pelo gateway", async () => {
  const r = await inspector(["--method", "tools/list"]);
  assert.equal(r.codigo, 0, r.saida);
  const json = JSON.parse(r.saida.slice(r.saida.indexOf("{")));
  assert.deepEqual(json.tools.map((t: any) => t.name), ["consultar_filtros_vagas"]);
  assert.equal(json.tools[0].annotations.readOnlyHint, true);
  console.log("INSPECTOR tools/list:", JSON.stringify(json.tools.map((t: any) => ({ name: t.name, annotations: t.annotations }))));
});

test("MCP Inspector (CLI): tools/call executa a ferramenta e devolve conteúdo estruturado", async () => {
  const r = await inspector(["--method", "tools/call", "--tool-name", "consultar_filtros_vagas", "--tool-arg", "limite=5"]);
  assert.equal(r.codigo, 0, r.saida);
  const json = JSON.parse(r.saida.slice(r.saida.indexOf("{")));
  assert.ok(!json.isError);
  assert.deepEqual(json.structuredContent.empresas, [{ id: "E1", nome: "Loja Alfa" }]);
  console.log("INSPECTOR tools/call:", JSON.stringify(json.structuredContent));
});

test("MCP Inspector (CLI): sem token a conexão falha (401) e nada é executado", async () => {
  const r = await inspector(["--method", "tools/list"], false);
  assert.notEqual(r.codigo, 0, r.saida);
  console.log("INSPECTOR sem token (saida):", JSON.stringify(r.saida.slice(0, 400)));
  assert.match(r.saida, /401|nauthorized|unauthor|auth/i);
  console.log("INSPECTOR sem token:", r.saida.split("\n").slice(0, 2).join(" | "));
});
