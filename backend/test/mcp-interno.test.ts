import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after, before } from "node:test";
import {
  APP_URL, MCP_URL, SEGREDO_ANTIGO, SEGREDO_ATUAL, criarAmbiente, criarIntegracao, criarUsuario, obterTokens, requisicaoInterna,
  type Ambiente, type UsuarioTeste,
} from "./mcp-suporte.js";

let amb: Ambiente;
let ana: UsuarioTeste; // vagas
let caio: UsuarioTeste; // sem páginas
let dora: UsuarioTeste; // não vinculada
let recurso: string;
let integracaoId: string;
let tokenAna: string;

const chamar = (o: Parameters<typeof requisicaoInterna>[1]) => requisicaoInterna(amb, o);
const dados = (r: { json(): unknown }) => (r.json() as { data: any }).data;
const erro = (r: { json(): unknown }) => (r.json() as { error: { code: string } }).error.code;

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await amb.db.query(sql, params);
  return Number(rows[0].n);
}

before(async () => {
  amb = await criarAmbiente();
  ana = await criarUsuario(amb, "Ana", ["vagas"]);
  caio = await criarUsuario(amb, "Caio", ["painel"]);
  dora = await criarUsuario(amb, "Dora", ["vagas"]);
  const integracao = await criarIntegracao(amb, "recrutamento", { usuarios: [{ id: ana.id }, { id: caio.id }] });
  integracaoId = integracao.id;
  recurso = integracao.recurso;
  await criarIntegracao(amb, "outra", { usuarios: [{ id: ana.id }] });
  // Dados reais no banco de teste, com campos que NÃO podem sair pelo MCP.
  await amb.db.query("INSERT INTO dna_work.empresa (id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, logradouro) VALUES ('E1', 'Razão Secreta LTDA', 'Loja Alfa', '12345678000199', 'financeiro@alfa.test', '11999990000', 'Rua Sigilosa 10')");
  await amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, status, quantidade_posicoes) VALUES ('V1', 'E1', 'Atendente de Loja', 2, 0, 2)");
  await amb.db.query("INSERT INTO public.grupo (nome) VALUES ('Grupo Varejo')");
  tokenAna = (await obterTokens(amb, ana, recurso)).access_token;
});
after(async () => { await amb?.fechar(); });

// ------------------------------------------------------------------ assinatura / replay

test("sem assinatura ou com cabeçalhos incompletos: 401 genérico", async () => {
  const r = await amb.app.mcp!.interno.inject({ method: "POST", url: "/internal/mcp/recrutamento/ferramentas", headers: { "content-type": "application/json", authorization: `Bearer ${tokenAna}`, "x-mcp-contract": "1" }, payload: "{}" });
  assert.equal(r.statusCode, 401);
  assert.equal(erro(r), "ASSINATURA_INVALIDA");
});

test("o SERVICE_TOKEN compartilhado e cabeçalhos de identidade forjados não autenticam nada", async () => {
  const r = await amb.app.mcp!.interno.inject({
    method: "POST", url: "/internal/mcp/recrutamento/ferramentas",
    headers: { "content-type": "application/json", "x-service-token": "qualquer-coisa", "x-user-id": ana.id, "x-mcp-user": ana.id }, payload: "{}",
  });
  assert.equal(r.statusCode, 401);
});

test("assinatura inválida: chave desconhecida, segredo errado, corpo/caminho/token adulterados", async () => {
  const base = { slug: "recrutamento", operacao: "ferramentas" as const, token: tokenAna };
  assert.equal((await chamar({ ...base, chave: "k9" })).statusCode, 401);
  assert.equal((await chamar({ ...base, segredo: "x".repeat(48) })).statusCode, 401);
  // Corpo trocado depois de assinar.
  assert.equal((await chamar({ ...base, operacao: "executar", corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} }, corpoEnviado: JSON.stringify({ ferramenta: "consultar_filtros_vagas", argumentos: { limite: 200 } }) })).statusCode, 401);
  // Token trocado: a assinatura cobre o hash do token.
  const outro = await obterTokens(amb, ana, recurso);
  const r = await amb.app.mcp!.interno.inject({ method: "POST", url: "/internal/mcp/recrutamento/ferramentas", headers: { "content-type": "application/json", authorization: `Bearer ${outro.access_token}` }, payload: "{}" });
  assert.equal(r.statusCode, 401);
});

test("janela de tempo: timestamp antigo ou futuro é recusado", async () => {
  const agora = Math.floor(Date.now() / 1000);
  for (const ts of [agora - 3600, agora + 3600, agora - 61]) {
    const r = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna, timestamp: ts });
    assert.equal(r.statusCode, 401, `aceitou timestamp ${ts - agora}s`);
  }
});

test("replay: a mesma requisição assinada só vale uma vez", async () => {
  const nonce = randomBytes(12).toString("base64url");
  const par = { slug: "recrutamento", operacao: "ferramentas" as const, token: tokenAna, nonce, timestamp: Math.floor(Date.now() / 1000) };
  const primeira = await chamar(par);
  assert.equal(primeira.statusCode, 200, primeira.body);
  const segunda = await chamar(par);
  assert.equal(segunda.statusCode, 401);
});

test("nonce atômico: 12 requisições idênticas simultâneas → exatamente uma passa", async () => {
  const nonce = randomBytes(12).toString("base64url");
  const par = { slug: "recrutamento", operacao: "ferramentas" as const, token: tokenAna, nonce, timestamp: Math.floor(Date.now() / 1000) };
  const respostas = await Promise.all(Array.from({ length: 12 }, () => chamar(par)));
  assert.equal(respostas.filter((r) => r.statusCode === 200).length, 1);
  assert.equal(respostas.filter((r) => r.statusCode === 401).length, 11);
});

test("rotação de segredo: a chave antiga ainda vale enquanto listada; depois de removida, não", async () => {
  const antiga = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna, chave: "k0", segredo: SEGREDO_ANTIGO });
  assert.equal(antiga.statusCode, 200, antiga.body);
  amb.app.mcp!.config.segredos.delete("k0");
  const removida = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna, chave: "k0", segredo: SEGREDO_ANTIGO });
  assert.equal(removida.statusCode, 401);
  amb.app.mcp!.config.segredos.set("k0", SEGREDO_ANTIGO);
});

test("versão do contrato: desconhecida é recusada com a lista de suportadas", async () => {
  const r = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna, contrato: 2 });
  assert.equal(r.statusCode, 400);
  assert.equal(erro(r), "CONTRATO_NAO_SUPORTADO");
  assert.deepEqual((r.json() as any).error.details.suportados, [1]);
});

test("resposta traz a versão do contrato e nunca é cacheável", async () => {
  const r = await chamar({ slug: "recrutamento", operacao: "integracao" });
  assert.equal(r.headers["x-mcp-contract-version"], "1");
  assert.equal(r.headers["cache-control"], "no-store");
});

// ------------------------------------------------------------------ isolamento de listeners

test("o app público não tem rotas /internal (nem como SPA) e o interno só tem /internal/mcp", async () => {
  for (const metodo of ["GET", "POST"] as const) {
    const r = await amb.app.inject({ method: metodo, url: "/internal/mcp/recrutamento/ferramentas", payload: metodo === "POST" ? "{}" : undefined, headers: metodo === "POST" ? { "content-type": "application/json" } : {} });
    assert.equal(r.statusCode, 404, `${metodo} /internal no listener público`);
  }
  // O listener interno não serve nada além de /internal/mcp: rota desconhecida exige assinatura (401) ou não existe (404), nunca dados.
  for (const url of ["/api/v1/vagas", "/health", "/oauth/token", "/"]) {
    const r = await amb.app.mcp!.interno.inject({ method: "GET", url });
    assert.ok(r.statusCode === 401 || r.statusCode === 404, `${url} → ${r.statusCode}`);
    assert.ok(!r.body.includes('"data"'));
  }
});

test("em portas reais: o listener público não serve /internal e a porta interna exige assinatura", async () => {
  await amb.app.listen({ port: 0, host: "127.0.0.1" });
  await amb.app.mcp!.interno.listen({ port: 0, host: "127.0.0.1" });
  const porta = (srv: { server: { address(): unknown } }) => (srv.server.address() as { port: number }).port;
  const publica = await fetch(`http://127.0.0.1:${porta(amb.app)}/internal/mcp/recrutamento/ferramentas`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(publica.status, 404);
  const interna = await fetch(`http://127.0.0.1:${porta(amb.app.mcp!.interno)}/internal/mcp/recrutamento/ferramentas`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(interna.status, 401);
  const fora = await fetch(`http://127.0.0.1:${porta(amb.app.mcp!.interno)}/api/v1/vagas`);
  assert.ok(fora.status === 401 || fora.status === 404);
});

// ------------------------------------------------------------------ token / identidade

test("o token MCP não vale como credencial das APIs do painel", async () => {
  for (const url of ["/api/v1/vagas", "/api/v1/auth/me", "/api/v1/candidatos", "/api/v1/configuracoes/acessos"]) {
    const r = await amb.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokenAna}` } });
    assert.equal(r.statusCode, 401, `${url} aceitou o token MCP`);
  }
});

test("sem token, token lixo ou de outro recurso: 401 sempre igual", async () => {
  const sem = await chamar({ slug: "recrutamento", operacao: "ferramentas" });
  assert.equal(sem.statusCode, 401);
  assert.equal(erro(sem), "TOKEN_INVALIDO");
  const lixo = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: "a".repeat(43) });
  assert.equal(lixo.statusCode, 401);
  assert.equal(erro(lixo), "TOKEN_INVALIDO");
});

test("isolamento entre integrações: token de uma não funciona na outra", async () => {
  const naOutra = await chamar({ slug: "outra", operacao: "ferramentas", token: tokenAna });
  assert.equal(naOutra.statusCode, 401);
  const tokenOutra = (await obterTokens(amb, ana, `${MCP_URL}/mcp/outra`)).access_token;
  assert.equal((await chamar({ slug: "outra", operacao: "ferramentas", token: tokenOutra })).statusCode, 200);
  assert.equal((await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenOutra })).statusCode, 401);
});

test("token expirado ou revogado deixa de valer na chamada seguinte", async () => {
  const t = (await obterTokens(amb, ana, recurso)).access_token;
  assert.equal((await chamar({ slug: "recrutamento", operacao: "autenticar", token: t })).statusCode, 200);
  await amb.db.query("UPDATE dna_work.mcp_oauth_registro SET expira_em = now() - interval '1 minute' WHERE tipo = 'AccessToken' AND id = encode(sha256($1::bytea), 'hex')", [t]);
  assert.equal((await chamar({ slug: "recrutamento", operacao: "autenticar", token: t })).statusCode, 401);

  const t2 = (await obterTokens(amb, ana, recurso)).access_token;
  assert.equal((await chamar({ slug: "recrutamento", operacao: "autenticar", token: t2 })).statusCode, 200);
  const revogados = await amb.app.mcp!.integracoes.revogar({ usuarioId: ana.id, integracaoId });
  assert.ok(revogados.revogados >= 1);
  assert.equal((await chamar({ slug: "recrutamento", operacao: "autenticar", token: t2 })).statusCode, 401, "token revogado ainda funcionou");
  tokenAna = (await obterTokens(amb, ana, recurso)).access_token; // renova para os próximos testes
});

// ------------------------------------------------------------------ política / permissões

test("catálogo dinâmico: Ana (página vagas) vê a ferramenta; Caio (sem página vagas) não vê nada", async () => {
  const cat = dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna }));
  assert.deepEqual(cat.ferramentas.map((f: any) => f.nome), ["consultar_filtros_vagas"]);
  const f = cat.ferramentas[0];
  assert.deepEqual(f.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(f.inputSchema.type, "object");
  assert.ok(f.inputSchema.properties.limite);
  assert.equal(f.versao, 1);
  assert.match(f.descricao, /Só leitura/);

  const tokenCaio = (await obterTokens(amb, caio, recurso)).access_token;
  const catCaio = dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenCaio }));
  assert.deepEqual(catCaio.ferramentas, []);
  const exec = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenCaio, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
  assert.equal(exec.statusCode, 404);
  assert.equal(erro(exec), "FERRAMENTA_INDISPONIVEL");
});

test("alterar permissão tem efeito imediato, sem cache: remover/devolver a página muda o catálogo na hora", async () => {
  const antes = dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna }));
  assert.equal(antes.ferramentas.length, 1);
  await amb.db.query("DELETE FROM dna_work.app_usuario_pagina WHERE id_usuario = $1 AND pagina = 'vagas'", [ana.id]);
  const durante = dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna }));
  assert.equal(durante.ferramentas.length, 0);
  const negada = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
  assert.equal(negada.statusCode, 404);
  await amb.db.query("INSERT INTO dna_work.app_usuario_pagina (id_usuario, pagina) VALUES ($1, 'vagas')", [ana.id]);
  const depois = dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna }));
  assert.equal(depois.ferramentas.length, 1);
});

test("restrição individual e desligar a ferramenta na integração tiram a ferramenta na hora", async () => {
  await amb.app.mcp!.integracoes.vincularUsuario(integracaoId, ana.id, { ferramentas: [] });
  assert.equal(dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna })).ferramentas.length, 0);
  await amb.app.mcp!.integracoes.vincularUsuario(integracaoId, ana.id, { ferramentas: null });
  assert.equal(dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna })).ferramentas.length, 1);
  await amb.app.mcp!.integracoes.definirFerramentas(integracaoId, []);
  assert.equal(dados(await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna })).ferramentas.length, 0, "deny-by-default: integração sem ferramentas não entrega nada");
  await amb.app.mcp!.integracoes.definirFerramentas(integracaoId, ["consultar_filtros_vagas"]);
});

test("ferramenta fora do registro não pode ser liberada (nome desconhecido é recusado)", async () => {
  await assert.rejects(() => amb.app.mcp!.integracoes.definirFerramentas(integracaoId, ["apagar_tudo"]), /inexistente/);
});

test("usuário desativado: bloqueado em conexões já abertas (token continua 'válido', acesso não)", async () => {
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = false WHERE id = $1", [ana.id]);
  const r = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna });
  assert.equal(r.statusCode, 403);
  assert.equal(erro(r), "USUARIO_INATIVO");
  const exec = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
  assert.equal(exec.statusCode, 403);
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = true WHERE id = $1", [ana.id]);
  assert.equal((await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna })).statusCode, 200);
});

test("desvincular o usuário da integração bloqueia e revoga; integração desativada bloqueia todos", async () => {
  const tokenDora = await (async () => {
    await amb.app.mcp!.integracoes.vincularUsuario(integracaoId, dora.id);
    return (await obterTokens(amb, dora, recurso)).access_token;
  })();
  assert.equal((await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenDora })).statusCode, 200);
  await amb.app.mcp!.integracoes.desvincularUsuario(integracaoId, dora.id);
  assert.equal((await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenDora })).statusCode, 401, "grant revogado junto com o vínculo");

  await amb.app.mcp!.integracoes.definirAtiva(integracaoId, false);
  const r = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna });
  assert.ok(r.statusCode === 401 || r.statusCode === 403, `status ${r.statusCode}`);
  await amb.app.mcp!.integracoes.definirAtiva(integracaoId, true);
  tokenAna = (await obterTokens(amb, ana, recurso)).access_token;
});

test("usuário não vinculado nem consegue autorizar (sem token, sem acesso)", async () => {
  const { rows } = await amb.db.query("SELECT 1 FROM dna_work.mcp_integracao_usuario WHERE id_usuario = $1", [dora.id]);
  assert.equal(rows.length, 0);
  await assert.rejects(() => obterTokens(amb, dora, recurso));
});

// ------------------------------------------------------------------ execução da ferramenta

test("executar: devolve projeção explícita, sem campos sensíveis da empresa", async () => {
  const r = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: { limite: 10 } } });
  assert.equal(r.statusCode, 200, r.body);
  const d = dados(r);
  assert.equal(d.isError, false);
  assert.deepEqual(Object.keys(d.structuredContent).sort(), ["cargos", "empresas", "grupos", "prioridades", "regimes", "situacoes", "total", "truncado"]);
  assert.deepEqual(d.structuredContent.empresas[0], { id: "E1", nome: "Loja Alfa" });
  assert.equal(d.structuredContent.grupos[0].nome, "Grupo Varejo");
  const bruto = JSON.stringify(d);
  for (const proibido of ["12345678000199", "Razão Secreta", "financeiro@alfa.test", "11999990000", "Rua Sigilosa"]) {
    assert.ok(!bruto.includes(proibido), `vazou: ${proibido}`);
  }
  assert.match(d.content[0].text, /não confiável/);
});

test("validação dos parâmetros (Zod): extras, tipos e limites são recusados com mensagem útil", async () => {
  for (const argumentos of [{ limite: 0 }, { limite: 201 }, { limite: "10" }, { busca: "" }, { campoExtra: 1 }]) {
    const r = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos } });
    assert.equal(r.statusCode, 200);
    assert.equal(dados(r).isError, true, JSON.stringify(argumentos));
    assert.match(dados(r).content[0].text, /Argumentos inválidos/);
  }
  const semNome = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { argumentos: {} } });
  assert.equal(semNome.statusCode, 422);
});

test("paginação e limites: respeita o limite pedido e avisa quando truncou; busca filtra", async () => {
  await amb.db.query("INSERT INTO dna_work.empresa (id_empresa, nome_fantasia) SELECT 'X' || g, 'Empresa ' || g FROM generate_series(1, 5) g");
  await amb.db.query("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, status) SELECT 'XV' || g, 'X' || g, 'Cargo ' || g, 2, 0 FROM generate_series(1, 5) g");
  const r = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: { limite: 2 } } });
  const d = dados(r).structuredContent;
  assert.equal(d.empresas.length, 2);
  assert.equal(d.truncado, true);
  assert.ok(d.total.empresas >= 6);
  const f = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: { busca: "alfa" } } });
  assert.deepEqual(dados(f).structuredContent.empresas.map((e: any) => e.nome), ["Loja Alfa"]);
});

test("ferramenta inexistente e ferramenta sem permissão têm a mesma resposta (nada se revela)", async () => {
  const a = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "nao_existe", argumentos: {} } });
  await amb.app.mcp!.integracoes.vincularUsuario(integracaoId, ana.id, { ferramentas: [] });
  const b = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
  await amb.app.mcp!.integracoes.vincularUsuario(integracaoId, ana.id, { ferramentas: null });
  assert.equal(a.statusCode, 404);
  assert.equal(b.statusCode, 404);
  assert.equal(a.body, b.body);
});

test("ferramentas de leitura não alteram dados operacionais", async () => {
  const tabelas = ["dna_work.empresa", "dna_work.vaga", "dna_work.candidato", "dna_work.app_usuario", "dna_work.app_usuario_pagina", "dna_work.conratacaovaga"];
  const foto = async () => Promise.all(tabelas.map((t) => contar(`SELECT count(*)::int AS n FROM ${t}`)));
  const hashes = async () => (await amb.db.query("SELECT md5(string_agg(t::text, '' ORDER BY t::text)) AS h FROM dna_work.vaga t")).rows[0].h;
  const antes = [await foto(), await hashes()];
  for (let i = 0; i < 3; i += 1) await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
  assert.deepEqual([await foto(), await hashes()], antes);
});

// ------------------------------------------------------------------ rate limit e auditoria

test("rate limit por usuário e integração: excedido devolve 429 e fica auditado", async () => {
  const { app } = amb;
  const config = (app as any).mcp.interno; // mesma instância; reduz o teto só para este teste
  void config;
  const chave = `u:${ana.id}:i:${integracaoId}`;
  // Reaproveita o contador real: preenche a janela atual até o teto configurado.
  const teto = amb.config.MCP_RATE_USUARIO_POR_MIN;
  const janela = Math.floor(Math.floor(Date.now() / 1000) / 60);
  await amb.db.query("INSERT INTO dna_work.mcp_limite (chave, janela, n) VALUES ($1, $2, $3) ON CONFLICT (chave, janela) DO UPDATE SET n = $3", [chave, janela, teto]);
  const r = await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna });
  assert.equal(r.statusCode, 429);
  assert.equal(erro(r), "LIMITE_EXCEDIDO");
  assert.ok((r.json() as any).error.details.reiniciaEmSegundos <= 60);
  assert.ok(await contar("SELECT count(*)::int AS n FROM dna_work.mcp_auditoria WHERE resultado = 'limite' AND id_usuario = $1", [ana.id]) >= 1);
  await amb.db.query("DELETE FROM dna_work.mcp_limite WHERE chave = $1", [chave]);
  // Outro usuário não é afetado pelo limite da Ana.
  const tokenCaio = (await obterTokens(amb, caio, recurso)).access_token;
  assert.equal((await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenCaio })).statusCode, 200);
});

test("auditoria: quem, integração, ferramenta, resultado, tempo e request id; negativas e tentativas também; sem tokens nem argumentos", async () => {
  await amb.db.query("DELETE FROM dna_work.mcp_auditoria");
  const requestId = "req-auditoria-0001";
  await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, requestId, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: { busca: "termo-sigiloso-xyz" } } });
  await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: { limite: 0 } } });
  await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "nao_existe", argumentos: {} } });
  await chamar({ slug: "recrutamento", operacao: "ferramentas", token: "a".repeat(43) });
  await chamar({ slug: "recrutamento", operacao: "ferramentas", token: tokenAna, segredo: "x".repeat(48) });

  const { rows } = await amb.db.query("SELECT * FROM dna_work.mcp_auditoria ORDER BY id");
  const ok = rows.find((l) => l.request_id === requestId);
  assert.ok(ok, "sem a linha da execução");
  assert.equal(ok.id_usuario, ana.id);
  assert.equal(ok.id_integracao, integracaoId);
  assert.equal(ok.slug, "recrutamento");
  assert.equal(ok.ferramenta, "consultar_filtros_vagas");
  assert.equal(ok.operacao, "executar");
  assert.equal(ok.resultado, "ok");
  assert.ok(ok.duracao_ms >= 0);
  assert.ok(ok.ocorrido_em instanceof Date);
  assert.ok(ok.cliente);
  assert.ok(rows.some((l) => l.resultado === "invalido"));
  assert.ok(rows.some((l) => l.resultado === "negado" && l.codigo === "ferramenta_inexistente"));
  assert.ok(rows.some((l) => l.resultado === "negado" && l.codigo === "token_invalido"), "tentativa com token inválido não foi auditada");
  assert.ok(rows.some((l) => l.operacao === "assinatura" && l.resultado === "negado"), "assinatura inválida não foi auditada");

  const texto = JSON.stringify(rows);
  assert.ok(!texto.includes(tokenAna), "token na auditoria");
  assert.ok(!texto.includes("termo-sigiloso-xyz"), "argumentos na auditoria");
  assert.ok(!texto.includes(SEGREDO_ATUAL));
});

test("auditoria é obrigatória: sem conseguir gravar, nenhum dado é devolvido (falha fechada)", async () => {
  await amb.db.query("ALTER TABLE dna_work.mcp_auditoria RENAME TO mcp_auditoria_off");
  try {
    const r = await chamar({ slug: "recrutamento", operacao: "executar", token: tokenAna, corpo: { ferramenta: "consultar_filtros_vagas", argumentos: {} } });
    assert.equal(r.statusCode, 500);
    assert.ok(!r.body.includes("Loja Alfa"), "devolveu dados sem auditar");
  } finally {
    await amb.db.query("ALTER TABLE dna_work.mcp_auditoria_off RENAME TO mcp_auditoria");
  }
});

test("autenticar devolve só o necessário e as instruções da integração", async () => {
  const d = dados(await chamar({ slug: "recrutamento", operacao: "autenticar", token: tokenAna }));
  assert.deepEqual(Object.keys(d).sort(), ["escopos", "integracao", "usuario"]);
  assert.deepEqual(d.usuario, { id: ana.id });
  assert.equal(d.integracao.instrucoes, "Use só dados do sistema.");
  assert.deepEqual(d.escopos, ["mcp:read"]);
  const pub = dados(await chamar({ slug: "recrutamento", operacao: "integracao" }));
  assert.equal(pub.recurso, recurso);
  assert.equal((await chamar({ slug: "inexistente", operacao: "integracao" })).statusCode, 404);
});

test("endereços usam as variáveis de ambiente (nenhuma URL fixa no código)", async () => {
  assert.equal(amb.app.mcp!.config.appUrl, APP_URL);
  assert.equal(amb.app.mcp!.config.publicUrl, MCP_URL);
});
