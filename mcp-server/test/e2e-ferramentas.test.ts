import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import Ajv from "ajv";
import { criarUsuario, criarIntegracao, obterTokens, type UsuarioTeste } from "../../backend/test/mcp-suporte.js";
import { MCP_URL, subirSistema, type Sistema } from "./suporte-e2e.js";

let s: Sistema;
let ana: UsuarioTeste;
let adm: UsuarioTeste;
const RECURSO = `${MCP_URL}/mcp/recrutamento`;

before(async () => {
  s = await subirSistema();
  ana = await criarUsuario(s.amb, "Ana", ["vagas", "empresas", "candidatos"]);
  adm = await criarUsuario(s.amb, "Admin", [], { admin: true });
  await criarIntegracao(s.amb, "recrutamento", { ferramentas: s.amb.app.mcp!.registro.nomes(), usuarios: [{ id: ana.id }, { id: adm.id }] });
  await s.amb.db.query("INSERT INTO dna_work.empresa (id_empresa, nome_fantasia, cnpj, cidade, uf, bairro, status) VALUES ('E1','Loja Alfa','12345678000199','São Paulo','SP','Centro',1)");
  await s.amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, salario, status, dataabertura, carga_horaria, quantidade_posicoes, obs) VALUES ('V1','E1','Atendente',2,'2000',0,'2026-11-01','44',2,'OBS INTERNA')");
});
after(async () => { await s?.parar(); });

test("catálogo pelo gateway: 28 ferramentas com schemas válidos (JSON Schema compilável), annotations de leitura e securitySchemes oauth2", async () => {
  const { client, transport } = s.cliente("recrutamento", (await obterTokens(s.amb, adm, RECURSO)).access_token);
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, s.amb.app.mcp!.registro.nomes().length);
    assert.ok(tools.length >= 28);
    const ajv = new Ajv({ strict: false });
    for (const t of tools as any[]) {
      assert.equal(t.annotations.readOnlyHint, true, t.name); assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.deepEqual(t._meta.securitySchemes, [{ type: "oauth2", scopes: ["mcp:read"] }], t.name);
      assert.equal(t.inputSchema.type, "object", t.name); assert.equal(t.outputSchema.type, "object", t.name);
      assert.doesNotThrow(() => ajv.compile(t.inputSchema), `${t.name}: inputSchema`);
      assert.doesNotThrow(() => ajv.compile(t.outputSchema), `${t.name}: outputSchema`);
      assert.ok(t.description.length > 60, t.name);
    }
    const externas = (tools as any[]).filter((t) => t.annotations.openWorldHint).map((t) => t.name).sort();
    assert.deepEqual(externas, ["buscar_vagas_por_cep", "consultar_compatibilidade_profissional", "consultar_origem_candidatos", "gerar_dossie"]);
  } finally { await client.close(); }
});

test("o cliente MCP valida a saída estruturada contra o outputSchema: ferramentas reais passam pelo gateway", async () => {
  const { client, transport } = s.cliente("recrutamento", (await obterTokens(s.amb, ana, RECURSO)).access_token);
  await client.connect(transport);
  try {
    const busca = await client.callTool({ name: "buscar_vagas", arguments: { cargo: "atend" } });
    assert.ok(!busca.isError, JSON.stringify(busca.content));
    assert.equal((busca.structuredContent as any).vagas[0].id_vaga, "V1");
    const vaga = await client.callTool({ name: "consultar_vaga", arguments: { id_vaga: "V1" } });
    assert.ok(!vaga.isError); assert.equal((vaga.structuredContent as any).vaga.remuneracao, 2000);
    const emp = await client.callTool({ name: "buscar_empresas", arguments: { nome: "alfa" } });
    assert.deepEqual((emp.structuredContent as any).empresas.map((e: any) => e.id_empresa), ["E1"]);
    const texto = JSON.stringify([busca, vaga, emp]);
    for (const proibido of ["12345678000199", "OBS INTERNA"]) assert.ok(!texto.includes(proibido), `vazou: ${proibido}`);
    assert.equal(((await client.callTool({ name: "buscar_vagas", arguments: { limite: 99 } })) as any).isError, true);
  } finally { await client.close(); }
});
