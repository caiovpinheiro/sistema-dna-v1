import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { executarManutencao } from "../src/mcp/manutencao.js";
import { criarAmbiente, type Ambiente } from "./mcp-suporte.js";

let amb: Ambiente;
before(async () => { amb = await criarAmbiente(); });
after(async () => { await amb?.fechar(); });
const n = async (sql: string) => Number((await amb.db.query(sql)).rows[0].n);

test("manutenção: apaga só o vencido (nonces, limites, OAuth além da retenção, auditoria além da retenção) e preserva o que vale", async () => {
  const q = (sql: string, p: unknown[] = []) => amb.db.query(sql, p);
  await q("INSERT INTO dna_work.mcp_nonce (chave, nonce, expira_em) VALUES ('k1','velho',now() - interval '1 hour'), ('k1','novo',now() + interval '1 hour')");
  await q("INSERT INTO dna_work.mcp_limite (chave, janela, n) VALUES ('u:x', 1, 5), ('u:x', floor(extract(epoch from now())/60), 1)");
  const reg = "INSERT INTO dna_work.mcp_oauth_registro (tipo, id, payload, expira_em) VALUES ($1, $2, '{}'::jsonb, $3)";
  await q(reg, ["AccessToken", "vencido-ha-30-dias", new Date(Date.now() - 30 * 86_400_000)]);
  await q(reg, ["AccessToken", "vencido-ontem", new Date(Date.now() - 86_400_000)]);
  await q(reg, ["AccessToken", "valido", new Date(Date.now() + 3_600_000)]);
  await q(reg, ["Client", "cliente-dcr-sem-validade", null]);
  const chaveAntes = await n("SELECT count(*)::int AS n FROM dna_work.mcp_oauth_registro WHERE tipo = 'ChaveAssinatura'");
  await q("INSERT INTO dna_work.mcp_auditoria (ocorrido_em, operacao, resultado) VALUES (now() - interval '400 days','executar','ok'), (now() - interval '100 days','executar','ok'), (now(),'executar','ok')");

  const r = await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 180, MCP_OAUTH_RETENCAO_DIAS: 7 });
  assert.equal(r.executada, true);
  assert.deepEqual([r.nonces, r.limites, r.oauth, r.auditoria], [1, 1, 1, 1]);
  assert.equal(await n("SELECT count(*)::int AS n FROM dna_work.mcp_nonce WHERE nonce = 'novo'"), 1);
  assert.equal(await n("SELECT count(*)::int AS n FROM dna_work.mcp_oauth_registro WHERE id IN ('vencido-ontem','valido','cliente-dcr-sem-validade')"), 3);
  assert.equal(await n("SELECT count(*)::int AS n FROM dna_work.mcp_oauth_registro WHERE tipo = 'ChaveAssinatura'"), chaveAntes, "a chave de assinatura nunca é apagada");
  assert.equal(await n("SELECT count(*)::int AS n FROM dna_work.mcp_auditoria"), 2);
});

test("retenção configurável: auditoria com 0 = nunca apaga; valor abaixo de 30 dias é elevado a 30; OAuth com retenção 0 apaga o que venceu", async () => {
  await amb.db.query("INSERT INTO dna_work.mcp_auditoria (ocorrido_em, operacao, resultado) VALUES (now() - interval '1000 days','executar','ok'), (now() - interval '20 days','executar','ok'), (now() - interval '45 days','executar','ok')");
  const a = await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 0, MCP_OAUTH_RETENCAO_DIAS: 7 });
  assert.equal(a.auditoria, 0);
  const b = await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 5, MCP_OAUTH_RETENCAO_DIAS: 7 });
  assert.equal(b.auditoria, 3, "o mínimo de 30 dias vale (apaga 1000, 100 e 45 dias; mantém 20)");
  assert.equal(await n("SELECT count(*)::int AS n FROM dna_work.mcp_auditoria WHERE ocorrido_em > now() - interval '30 days'"), 2);
  await amb.db.query("INSERT INTO dna_work.mcp_oauth_registro (tipo, id, payload, expira_em) VALUES ('AccessToken','venceu-agora','{}'::jsonb, now() - interval '1 minute')");
  const c = await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 180, MCP_OAUTH_RETENCAO_DIAS: 0 });
  assert.ok(c.oauth >= 1);
});

test("com várias réplicas só uma executa a manutenção por vez (trava no banco)", async () => {
  const segurando = await amb.db.connect();
  try {
    await segurando.query("SELECT pg_advisory_lock(7042026)");
    const r = await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 180, MCP_OAUTH_RETENCAO_DIAS: 7 });
    assert.equal(r.executada, false);
  } finally { await segurando.query("SELECT pg_advisory_unlock(7042026)"); segurando.release(); }
  assert.equal((await executarManutencao(amb.db, { MCP_AUDITORIA_RETENCAO_DIAS: 180, MCP_OAUTH_RETENCAO_DIAS: 7 })).executada, true);
});

test("TTL do nonce nunca fica abaixo de 2x a janela do HMAC", async () => {
  assert.ok(amb.app.mcp!.config.nonceTtlS >= amb.config.MCP_HMAC_JANELA_S * 2);
  const { lerMcpConfig } = await import("../src/mcp/config.js");
  const base = { ...amb.config, MCP_NONCE_TTL_S: 1, MCP_HMAC_JANELA_S: 60 };
  assert.ok(lerMcpConfig(base as never).nonceTtlS >= 120, "TTL menor que a janela abriria brecha de replay");
});
