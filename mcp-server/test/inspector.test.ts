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
  await criarIntegracao(s.amb, "recrutamento", { ferramentas: s.amb.app.mcp!.registro.nomes(), usuarios: [{ id: ana.id }] });
  await s.amb.db.query("INSERT INTO dna_work.empresa (id_empresa, nome_fantasia, cnpj, cidade, uf) VALUES ('E1', 'Loja Alfa', '12345678000199', 'São Paulo', 'SP')");
  await s.amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, salario, status, dataabertura, obs) VALUES ('V1', 'E1', 'Atendente', 2, '2000', 0, '2026-11-01', 'OBS INTERNA')");
  token = (await obterTokens(s.amb, ana, `${MCP_URL}/mcp/recrutamento`)).access_token;
  catalogo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insp-")), "mcp.json");
});
after(async () => { await s?.parar(); });

/** O Inspector pode imprimir avisos depois do JSON: extrai do primeiro "{" ao último "}". */
const extrairJson = (saida: string) => JSON.parse(saida.slice(saida.indexOf("{"), saida.lastIndexOf("}") + 1));

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
  const json = extrairJson(r.saida);
  const nomes = json.tools.map((t: any) => t.name);
  // Ana só tem a página "vagas": vê as ferramentas de vagas (catálogo efetivo), não as de candidatos, gestão ou métricas.
  for (const esperado of ["buscar_vagas", "consultar_vaga", "listar_vagas_abertas", "consultar_filtros_vagas"]) assert.ok(nomes.includes(esperado), esperado);
  for (const proibida of ["buscar_candidatos", "consultar_metricas_clt", "consultar_dashboard", "gerar_dossie"]) assert.ok(!nomes.includes(proibida), proibida);
  assert.ok(json.tools.every((t: any) => t.annotations.readOnlyHint === true && t.outputSchema && t._meta.securitySchemes));
  console.log("INSPECTOR tools/list (com token):", nomes.length, "ferramentas:", nomes.join(", "));
});

test("MCP Inspector (CLI): tools/call executa a ferramenta e devolve conteúdo estruturado", async () => {
  const r = await inspector(["--method", "tools/call", "--tool-name", "buscar_vagas", "--tool-arg", "cargo=atend"]);
  assert.equal(r.codigo, 0, r.saida);
  const json = extrairJson(r.saida);
  assert.ok(!json.isError, r.saida);
  assert.equal(json.structuredContent.vagas[0].id_vaga, "V1");
  assert.ok(!r.saida.includes("OBS INTERNA") && !r.saida.includes("12345678000199"), "campo interno vazou");
  console.log("INSPECTOR tools/call buscar_vagas:", JSON.stringify(json.structuredContent.vagas[0]));
  const negada = await inspector(["--method", "tools/call", "--tool-name", "buscar_candidatos", "--tool-arg", "nome=ana"]);
  assert.notEqual(negada.codigo, 0, "ferramenta sem permissão foi executada");
  console.log("INSPECTOR tools/call sem permissão:", JSON.stringify(negada.saida.slice(0, 160)));
});

test("MCP Inspector (CLI): sem token a descoberta mostra só metadados (com securitySchemes) e a execução é recusada", async () => {
  const lista = await inspector(["--method", "tools/list"], false);
  assert.equal(lista.codigo, 0, lista.saida);
  const json = extrairJson(lista.saida);
  assert.equal(json.tools.length, s.amb.app.mcp!.registro.nomes().length);
  assert.ok(json.tools.every((t: any) => JSON.stringify(t._meta) === JSON.stringify({ securitySchemes: [{ type: "oauth2", scopes: ["mcp:read"] }] })));
  console.log("INSPECTOR sem token / tools/list:", json.tools.length, "ferramentas, só metadados; exemplo:", JSON.stringify({ name: json.tools[0].name, securitySchemes: json.tools[0].securitySchemes }));
  const chamada = await inspector(["--method", "tools/call", "--tool-name", "buscar_vagas", "--tool-arg", "limite=5"], false);
  assert.notEqual(chamada.codigo, 0, chamada.saida);
  assert.ok(!chamada.saida.includes("Loja Alfa") && !chamada.saida.includes("V1"), "dados saíram sem login");
  console.log("INSPECTOR sem token / tools/call:", JSON.stringify(chamada.saida.slice(0, 200)));
});
