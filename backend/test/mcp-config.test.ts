import assert from "node:assert/strict";
import test from "node:test";
import { CONTRATO_VERSAO, assinar, assinaturaConfere, lerSegredos, stringAssinada, type CamposAssinados } from "../src/mcp/assinatura.js";
import { lerMcpConfig, recursoDaIntegracao, slugDoRecurso } from "../src/mcp/config.js";
import { RegistroFerramentas, descreverFerramenta, type Ferramenta } from "../src/mcp/registro.js";
import { z } from "zod";

const SEGREDO = "segredo-de-teste-segredo-de-teste-12345678";
const base = (): CamposAssinados => ({
  metodo: "POST", caminho: "/internal/mcp/x/executar?a=1", contrato: CONTRATO_VERSAO, chave: "k1", timestamp: 1_700_000_000,
  nonce: "nonce-abcdef123456", requestId: "req-12345678", corpo: '{"a":1}', token: "token-do-usuario-0123456789",
});

test("assinatura: cada componente muda o resultado (método, caminho/query, contrato, chave, tempo, nonce, request id, corpo, token)", () => {
  const original = assinar(SEGREDO, base());
  const variacoes: Array<Partial<CamposAssinados>> = [
    { metodo: "GET" }, { caminho: "/internal/mcp/y/executar?a=1" }, { caminho: "/internal/mcp/x/executar?a=2" },
    { contrato: 2 }, { chave: "k2" }, { timestamp: 1_700_000_001 }, { nonce: "nonce-abcdef123457" },
    { requestId: "req-12345679" }, { corpo: '{"a":2}' }, { token: "outro-token-0123456789" }, { token: null },
  ];
  for (const v of variacoes) assert.notEqual(assinar(SEGREDO, { ...base(), ...v }), original, JSON.stringify(v));
  assert.equal(assinaturaConfere(SEGREDO, base(), original), true);
  assert.equal(assinaturaConfere(SEGREDO + "x", base(), original), false);
  assert.equal(assinaturaConfere(SEGREDO, base(), original.slice(0, -2) + "AA"), false);
});

test("o token nunca entra na string assinada, só o hash dele", () => {
  assert.ok(!stringAssinada(base()).includes("token-do-usuario-0123456789"));
});

test("segredos: formato id:segredo, mínimo de 32 caracteres, ids únicos, rotação com dois", () => {
  assert.equal(lerSegredos("k2:" + "a".repeat(32) + ",k1:" + "b".repeat(40)).size, 2);
  assert.throws(() => lerSegredos("k1:curto"), /32/);
  assert.throws(() => lerSegredos("sem-id"), /id/);
  assert.throws(() => lerSegredos("k1:" + "a".repeat(32) + ",k1:" + "b".repeat(32)), /repetido/);
  assert.equal(lerSegredos("").size, 0);
});

const envBase = { MCP_PUBLIC_URL: "https://mcp.dnawork.ai", APP_PUBLIC_URL: "https://painel.dnawork.ai", MCP_GATEWAY_SECRETS: `k1:${SEGREDO}`, MCP_OAUTH_CLIENTS: "", MCP_OAUTH_REDIRECT_HOSTS: "" };

test("configuração: URLs só https e só origem; segredos obrigatórios; falha no boot", () => {
  const ok = lerMcpConfig(envBase as never);
  assert.equal(ok.publicUrl, "https://mcp.dnawork.ai");
  assert.throws(() => lerMcpConfig({ ...envBase, MCP_PUBLIC_URL: "http://mcp.dnawork.ai" } as never), /https/);
  assert.throws(() => lerMcpConfig({ ...envBase, MCP_PUBLIC_URL: "https://mcp.dnawork.ai/mcp" } as never), /origem/);
  assert.throws(() => lerMcpConfig({ ...envBase, MCP_PUBLIC_URL: "" } as never), /URL/);
  assert.throws(() => lerMcpConfig({ ...envBase, APP_PUBLIC_URL: "" } as never), /URL/);
  assert.throws(() => lerMcpConfig({ ...envBase, MCP_GATEWAY_SECRETS: "" } as never), /MCP_GATEWAY_SECRETS/);
  assert.throws(() => lerMcpConfig({ ...envBase, MCP_OAUTH_CLIENTS: JSON.stringify([{ client_id: "abc", redirect_uris: ["nao-e-url"] }]) } as never));
});

test("recurso OAuth é exatamente a URL do endpoint /mcp/:slug", () => {
  const mcp = { publicUrl: "https://mcp.dnawork.ai" };
  assert.equal(recursoDaIntegracao(mcp, "vendas"), "https://mcp.dnawork.ai/mcp/vendas");
  assert.equal(slugDoRecurso(mcp, "https://mcp.dnawork.ai/mcp/vendas"), "vendas");
  for (const ruim of ["https://mcp.dnawork.ai/mcp/vendas/", "https://mcp.dnawork.ai/mcp/", "https://mcp.dnawork.ai/mcp/Vendas", "https://mcp.dnawork.ai/mcp/a/b", "http://mcp.dnawork.ai/mcp/vendas", "https://mcp.dnawork.ai.evil.com/mcp/vendas", "https://mcp.dnawork.ai/mcp/-x", "https://mcp.dnawork.ai/mcp/vendas?x=1"]) {
    assert.equal(slugDoRecurso(mcp, ruim), null, ruim);
  }
});

const ferramentaOk = (extra: Partial<Ferramenta> = {}): Ferramenta => ({
  nome: "consultar_algo", titulo: "Consultar algo", descricao: "Descrição.", modulo: "teste", tipo: "leitura", paginas: [], escopo: "mcp:read",
  entrada: z.object({ q: z.string().optional() }), async executar() { return { dados: {} }; }, ...extra,
});

test("registro: nomes estáveis, sem repetição, só leitura na v1, módulo financeiro desligado", () => {
  const r = new RegistroFerramentas();
  r.registrar(ferramentaOk());
  assert.throws(() => r.registrar(ferramentaOk()), /repetida/);
  assert.throws(() => r.registrar(ferramentaOk({ nome: "Nome Ruim" })), /inválido/);
  assert.throws(() => r.registrar(ferramentaOk({ nome: "atualiza_vaga", tipo: "escrita" as never })), /só aceita ferramentas de leitura/);
  assert.throws(() => r.registrar(ferramentaOk({ nome: "sem_descricao", descricao: " " })), /obrigat/);
  r.registrar(ferramentaOk({ nome: "consultar_saldo", modulo: "financeiro" }));
  assert.ok(r.obter("consultar_algo"));
  assert.equal(r.obter("consultar_saldo"), undefined, "financeiro deve ficar desativado por padrão");
  assert.ok(!r.nomes().includes("consultar_saldo"));
});

test("catálogo: annotations coerentes com ferramenta somente leitura; openWorld só quando chama serviço externo", () => {
  const d = descreverFerramenta(ferramentaOk({ abertoAoMundo: true }));
  assert.deepEqual(d.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  assert.equal(descreverFerramenta(ferramentaOk()).annotations.openWorldHint, false);
  assert.equal(d.inputSchema.type, "object");
  assert.ok(!("$schema" in d.inputSchema));
});
