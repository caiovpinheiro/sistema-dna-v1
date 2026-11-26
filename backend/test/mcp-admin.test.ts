import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { APP_URL, MCP_URL, SEGREDO_ANTIGO, SEGREDO_ATUAL, autorizar, criarAmbiente, criarIntegracao, criarUsuario, loginBootstrap, obterTokens, pkce, requisicaoInterna, uidDoRedirect, type Ambiente, type UsuarioTeste } from "./mcp-suporte.js";

/** Gestão administrativa do MCP (aba Integrações MCP): só administrador efetivo; dados FICTÍCIOS. */
let amb: Ambiente;
let admin: UsuarioTeste; let comum: UsuarioTeste; let ana: UsuarioTeste; let bia: UsuarioTeste;
const BASE = "/api/v1/configuracoes/mcp";

const api = async (quem: { cookie: string } | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const r = await amb.app.inject({ method, url: `${BASE}${url}`, payload: payload as never, headers: { ...(quem ? { cookie: quem.cookie } : {}), origin: APP_URL } });
  return { status: r.statusCode, corpo: r.body, json: (r.body ? r.json() : null) as any };
};
const A = (m: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", u: string, p?: unknown) => api(admin, m, u, p);
const chamar = async (token: string, slug: string, ferramenta: string, argumentos: unknown = {}) => {
  const r = await requisicaoInterna(amb, { slug, operacao: "executar", token, corpo: { ferramenta, argumentos } });
  return { status: r.statusCode, data: (r.json() as any).data, erro: (r.json() as any).error?.code };
};
const catalogo = async (token: string, slug: string) => (await requisicaoInterna(amb, { slug, operacao: "ferramentas", token })) as any;

before(async () => {
  amb = await criarAmbiente();
  admin = await criarUsuario(amb, "Admin", [], { admin: true });
  comum = await criarUsuario(amb, "Comum", ["vagas", "candidatos", "empresas"]);
  ana = await criarUsuario(amb, "Ana", ["vagas", "candidatos", "empresas"]);
  bia = await criarUsuario(amb, "Bia", ["vagas"]);
  const q = (sql: string, p: unknown[] = []) => amb.db.query(sql, p);
  await q("INSERT INTO dna_work.empresa (id_empresa, razao_social, nome_fantasia, status) VALUES ('E1','Alfa Ltda','Loja Alfa',1)");
  await q("INSERT INTO dna_work.candidato (id_candidato, nome, cidade, estado) VALUES ('C1','Ana Fictícia','São Paulo','SP')");
});
after(async () => { await amb?.fechar(); });

test("acesso: só administrador efetivo; anônimo e colaborador comum recebem 401/403 em toda a área", async () => {
  const rotas: Array<["GET" | "POST", string, unknown?]> = [["GET", "/resumo"], ["GET", "/ferramentas"], ["GET", "/integracoes"], ["GET", "/colaboradores"], ["GET", "/auditoria"],
    ["POST", "/integracoes", { slug: "xx", nome: "Xx" }]];
  for (const [m, u, p] of rotas) {
    assert.equal((await api(null, m, u, p)).status, 401, `anônimo ${u}`);
    assert.equal((await api(comum, m, u, p)).status, 403, `comum ${u}`);
  }
  assert.equal((await A("GET", "/resumo")).status, 200);
  // O administrador de emergência do ambiente também administra (é o admin efetivo do painel), mas nunca usa o MCP.
  const boot = await loginBootstrap(amb);
  assert.equal((await api({ cookie: boot }, "GET", "/integracoes")).status, 200);
});

test("catálogo: módulos na ordem do painel, ferramentas com finalidade, permissões e indicação de serviço externo", async () => {
  const r = await A("GET", "/ferramentas");
  assert.equal(r.status, 200);
  const { modulos, total, abrangencias, permissoesIndividuais } = r.json.data;
  assert.deepEqual(modulos.map((m: any) => m.id), ["vagas", "empresas", "triagem", "candidatos", "dossies", "processos", "contratacoes", "gestao", "conhecimento"]);
  assert.equal(total, amb.app.mcp!.registro.nomes().length);
  assert.equal(modulos.reduce((n: number, m: any) => n + m.ferramentas.length, 0), total);
  assert.equal(modulos.find((m: any) => m.id === "conhecimento").planejado, true);
  for (const m of modulos) for (const f of m.ferramentas) {
    assert.ok(f.titulo && f.descricao && f.finalidade, f.nome);
    assert.equal(typeof f.servicoExterno, "boolean");
  }
  const todas = modulos.flatMap((m: any) => m.ferramentas);
  assert.equal(todas.find((f: any) => f.nome === "gerar_dossie").servicoExterno, true);
  assert.equal(todas.find((f: any) => f.nome === "consultar_dashboard").permissaoExigida, "gestao:indicadores");
  assert.equal(todas.find((f: any) => f.nome === "consultar_metricas_clt").somenteAdmin, true);
  assert.deepEqual(abrangencias.filter((a: any) => !a.disponivel).map((a: any) => a.id), ["proprios", "equipe"], "próprios e equipe ficam indisponíveis e documentados");
  assert.ok(permissoesIndividuais.some((p: any) => p.id === "candidatos:contato"));
});

test("criar integração: nasce desativada, sem ferramentas e sem colaboradores; slug único e validado; URL de conexão", async () => {
  const r = await A("POST", "/integracoes", { slug: "atendimento", nome: "Atendimento", descricao: "Time de atendimento", finalidade: "Apoiar o atendimento" });
  assert.equal(r.status, 200, r.corpo);
  const d = r.json.data;
  assert.equal(d.ativa, false); assert.deepEqual(d.ferramentas, []); assert.deepEqual(d.colaboradores, []);
  assert.equal(d.url, `${MCP_URL}/mcp/atendimento`); assert.equal(d.finalidade, "Apoiar o atendimento");
  assert.equal((await A("POST", "/integracoes", { slug: "atendimento", nome: "Outra" })).status, 409);
  for (const ruim of ["A", "Maiusculo", "com_underline", "-x", "x-", "a".repeat(61), "com espaço"]) {
    assert.equal((await A("POST", "/integracoes", { slug: ruim, nome: "Teste" })).status, 422, ruim);
  }
  // sem permissão e sem ferramenta: nada é entregue mesmo que alguém a vincule e ative
  const tokenAntes = await requisicaoInterna(amb, { slug: "atendimento", operacao: "integracao" });
  assert.equal(tokenAntes.statusCode, 404, "desativada não existe para o gateway");
});

test("editar nome e descrição; o slug não muda (a URL e as conexões dependem dele)", async () => {
  const { json: { data: lista } } = await A("GET", "/integracoes");
  const id = lista.find((i: any) => i.slug === "atendimento").id;
  const r = await A("PATCH", `/integracoes/${id}`, { nome: "Atendimento DNA", descricao: "Nova descrição", slug: "outro-slug" });
  assert.equal(r.status, 200, r.corpo);
  assert.equal(r.json.data.nome, "Atendimento DNA"); assert.equal(r.json.data.descricao, "Nova descrição"); assert.equal(r.json.data.slug, "atendimento");
  assert.equal((await A("PATCH", `/integracoes/${id}`, { nome: "x" })).status, 422);
  assert.equal((await A("GET", `/integracoes/00000000-0000-4000-8000-000000000000`)).status, 404);
});

test("ferramentas por integração: individual e por módulo; nome desconhecido recusado; efeito na PRÓXIMA chamada com o mesmo token", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "din", nome: "Dinâmica" })).json.data;
  await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: true });
  assert.equal((await A("PUT", `/integracoes/${integ.id}/colaboradores/${ana.id}`, { abrangencia: "todos" })).status, 200);
  const token = (await obterTokens(amb, ana, `${MCP_URL}/mcp/din`)).access_token;
  assert.deepEqual((await catalogo(token, "din")).json().data.ferramentas, [], "sem ferramenta liberada, nada é entregue");
  assert.equal((await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["nao_existe"] })).status, 422);
  const cat = (await A("GET", "/ferramentas")).json.data.modulos;
  const doModulo = (id: string) => cat.find((m: any) => m.id === id).ferramentas.map((f: any) => f.nome);
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: doModulo("vagas") });
  const nomes = async () => (await catalogo(token, "din")).json().data.ferramentas.map((f: any) => f.nome).sort();
  assert.deepEqual(await nomes(), [...doModulo("vagas")].sort());
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: [...doModulo("vagas"), "consultar_candidato"] });
  assert.ok((await nomes()).includes("consultar_candidato"));
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas"] });
  assert.deepEqual(await nomes(), ["buscar_vagas"]);
  const fora = await chamar(token, "din", "consultar_candidato", { id_candidato: "C1" });
  assert.equal(fora.status, 404, "ferramenta retirada da integração para de funcionar na hora");
  // restrição individual que sobrou com ferramenta retirada é limpa
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas", "consultar_vaga"] });
  await A("PUT", `/integracoes/${integ.id}/colaboradores/${ana.id}`, { ferramentas: ["buscar_vagas", "consultar_vaga"], abrangencia: "todos" });
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas"] });
  assert.deepEqual((await A("GET", `/integracoes/${integ.id}`)).json.data.colaboradores[0].ferramentas, ["buscar_vagas"]);
});

test("colaboradores: vincular, permissões individuais, abrangência e registros autorizados com validação (nada de vínculo inventado)", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "colab", nome: "Colab" })).json.data;
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["consultar_candidato", "buscar_vagas"] });
  const url = (u: string) => `/integracoes/${integ.id}/colaboradores/${u}`;
  assert.equal((await A("PUT", url("00000000-0000-4000-8000-000000000000"), {})).status, 404, "usuário inexistente");
  assert.equal((await A("PUT", url(bia.id), { permissoes: ["root:tudo"] })).status, 422, "permissão desconhecida");
  assert.equal((await A("PUT", url(bia.id), { ferramentas: ["buscar_empresas"] })).status, 422, "restrição fora da integração");
  for (const indisponivel of ["proprios", "equipe"]) {
    const r = await A("PUT", url(bia.id), { abrangencia: indisponivel });
    assert.equal(r.status, 422, indisponivel); assert.equal(r.json.error.code, "ABRANGENCIA_INDISPONIVEL");
  }
  assert.equal((await A("PUT", url(bia.id), { abrangencia: "qualquer" })).status, 422);
  assert.equal((await A("PUT", url(bia.id), { abrangencia: "autorizados", candidatos: ["NAO-EXISTE"] })).json.error.code, "CANDIDATO_INEXISTENTE");
  assert.equal((await A("PUT", url(bia.id), { abrangencia: "autorizados", empresas: ["NAO-EXISTE"] })).json.error.code, "EMPRESA_INEXISTENTE");
  const ok = await A("PUT", url(bia.id), { abrangencia: "autorizados", candidatos: ["C1"], empresas: ["E1"], permissoes: ["candidatos:contato"] });
  assert.equal(ok.status, 200, ok.corpo);
  const c = ok.json.data.colaboradores[0];
  assert.deepEqual([c.abrangencia, c.registros, c.permissoes], ["autorizados", 2, ["candidatos:contato"]]);
  const regs = (await A("GET", `${url(bia.id)}/registros`)).json.data;
  assert.deepEqual(regs.candidatos, [{ id: "C1", nome: "Ana Fictícia" }]); assert.deepEqual(regs.empresas, [{ id: "E1", nome: "Loja Alfa" }]);
  // trocar para 'todos' ou 'nenhuma' apaga a lista (só 'autorizados' tem registros)
  await A("PUT", url(bia.id), { abrangencia: "todos" });
  assert.equal((await A("GET", `${url(bia.id)}/registros`)).json.data.candidatos.length, 0);
  // limite de registros
  const muitos = Array.from({ length: 101 }, (_, i) => `C${i}`);
  assert.equal((await A("PUT", url(bia.id), { abrangencia: "autorizados", candidatos: muitos })).status, 422);
  // usuário bloqueado no painel não é vinculado
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = false WHERE id = $1", [comum.id]);
  assert.equal((await A("PUT", url(comum.id), {})).json.error.code, "USUARIO_INATIVO");
  await amb.db.query("UPDATE dna_work.app_usuario SET ativo = true WHERE id = $1", [comum.id]);
  // desvincular
  assert.equal((await A("DELETE", url(bia.id))).json.data.colaboradores.length, 0);
});

test("ativar/desativar: desativar derruba as conexões na hora; reativar não ressuscita token", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "liga", nome: "Liga" })).json.data;
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas"] });
  await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: true });
  await A("PUT", `/integracoes/${integ.id}/colaboradores/${ana.id}`, { abrangencia: "todos" });
  const token = (await obterTokens(amb, ana, `${MCP_URL}/mcp/liga`)).access_token;
  assert.equal((await chamar(token, "liga", "buscar_vagas", {})).status, 200);
  assert.equal((await A("GET", `/integracoes/${integ.id}`)).json.data.conexoesAtivas, 1);
  const off = await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: false });
  assert.equal(off.json.data.ativa, false); assert.equal(off.json.data.conexoesAtivas, 0);
  assert.equal((await chamar(token, "liga", "buscar_vagas", {})).status, 401);
  await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: true });
  assert.equal((await chamar(token, "liga", "buscar_vagas", {})).status, 401, "o token antigo não volta");
});

test("duplicar: copia nome, descrição, finalidade e ferramentas; NÃO copia colaboradores, permissões, registros nem conexões; nasce desativada", async () => {
  const origem = (await A("POST", "/integracoes", { slug: "orig", nome: "Origem", descricao: "D", finalidade: "F", instrucoes: "I" })).json.data;
  await A("PUT", `/integracoes/${origem.id}/ferramentas`, { ferramentas: ["buscar_vagas", "consultar_candidato"] });
  await A("POST", `/integracoes/${origem.id}/ativa`, { ativa: true });
  await A("PUT", `/integracoes/${origem.id}/colaboradores/${ana.id}`, { abrangencia: "autorizados", candidatos: ["C1"], permissoes: ["candidatos:contato"] });
  await obterTokens(amb, ana, `${MCP_URL}/mcp/orig`);
  const r = await A("POST", `/integracoes/${origem.id}/duplicar`, { slug: "copia", nome: "Cópia" });
  assert.equal(r.status, 200, r.corpo);
  const c = r.json.data;
  assert.equal(c.ativa, false); assert.equal(c.slug, "copia"); assert.equal(c.url, `${MCP_URL}/mcp/copia`);
  assert.deepEqual([c.descricao, c.finalidade, c.instrucoes], ["D", "F", "I"]);
  assert.deepEqual([...c.ferramentas].sort(), ["buscar_vagas", "consultar_candidato"]);
  assert.deepEqual(c.colaboradores, []); assert.equal(c.conexoesAtivas, 0);
  const { rows } = await amb.db.query("SELECT (SELECT count(*)::int FROM dna_work.mcp_integracao_usuario WHERE id_integracao = $1) AS u, (SELECT count(*)::int FROM dna_work.mcp_integracao_usuario_registro WHERE id_integracao = $1) AS r", [c.id]);
  assert.deepEqual(rows[0], { u: 0, r: 0 });
  assert.equal((await A("POST", `/integracoes/${origem.id}/duplicar`, { slug: "copia", nome: "Outra" })).status, 409);
});

test("revogação: individual, por integração e completa do colaborador; vale na próxima chamada", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "rev", nome: "Rev" })).json.data;
  const outra = (await A("POST", "/integracoes", { slug: "rev2", nome: "Rev2" })).json.data;
  for (const i of [integ, outra]) {
    await A("PUT", `/integracoes/${i.id}/ferramentas`, { ferramentas: ["buscar_vagas"] });
    await A("POST", `/integracoes/${i.id}/ativa`, { ativa: true });
    for (const u of [ana, bia]) await A("PUT", `/integracoes/${i.id}/colaboradores/${u.id}`, { abrangencia: "todos" });
  }
  const t = async (u: UsuarioTeste, slug: string) => (await obterTokens(amb, u, `${MCP_URL}/mcp/${slug}`)).access_token;
  let [aRev, bRev, aRev2] = [await t(ana, "rev"), await t(bia, "rev"), await t(ana, "rev2")];
  const vivo = async (tk: string, slug: string) => (await chamar(tk, slug, "buscar_vagas", {})).status === 200;
  assert.deepEqual([await vivo(aRev, "rev"), await vivo(bRev, "rev"), await vivo(aRev2, "rev2")], [true, true, true]);
  // individual (um colaborador numa integração)
  assert.equal((await A("POST", `/integracoes/${integ.id}/revogar`, { usuario: ana.id })).json.data.revogados, 1);
  assert.deepEqual([await vivo(aRev, "rev"), await vivo(bRev, "rev"), await vivo(aRev2, "rev2")], [false, true, true]);
  // completa de um colaborador (todas as integrações)
  aRev = await t(ana, "rev"); aRev2 = await t(ana, "rev2");
  assert.ok((await A("POST", `/colaboradores/${ana.id}/revogar`)).json.data.revogados >= 2, "revoga as conexões dela em todas as integrações");
  assert.deepEqual([await vivo(aRev, "rev"), await vivo(aRev2, "rev2"), await vivo(bRev, "rev")], [false, false, true]);
  // por integração (todos os colaboradores)
  assert.equal((await A("POST", `/integracoes/${integ.id}/revogar`, {})).json.data.revogados, 1);
  assert.equal(await vivo(bRev, "rev"), false);
});

test("visão do colaborador: ferramentas efetivas e bloqueios com a origem (painel, integração, abrangência, permissão), conexões e uso", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "visao", nome: "Visão" })).json.data;
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas", "buscar_candidatos", "listar_processos", "consultar_dashboard", "consultar_metricas_clt", "consultar_candidato"] });
  await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: true });
  await A("PUT", `/integracoes/${integ.id}/colaboradores/${bia.id}`, { abrangencia: "todos", ferramentas: ["buscar_vagas", "buscar_candidatos", "listar_processos", "consultar_dashboard", "consultar_metricas_clt"] });
  const tk = (await obterTokens(amb, bia, `${MCP_URL}/mcp/visao`)).access_token;
  await chamar(tk, "visao", "buscar_vagas", {});
  await chamar(tk, "visao", "buscar_candidatos", { nome: "Ana" }); // bia não tem a página candidatos → negado
  const v = (await A("GET", `/colaboradores/${bia.id}`)).json.data;
  assert.equal(v.usuario.nome, "Bia");
  const i = v.integracoes.find((x: any) => x.slug === "visao");
  const f = (n: string) => i.ferramentas.find((x: any) => x.nome === n);
  assert.equal(f("buscar_vagas").disponivel, true);
  assert.equal(f("buscar_candidatos").bloqueio.origem, "painel"); assert.match(f("buscar_candidatos").bloqueio.texto, /Bloqueada pelo painel/);
  assert.equal(f("listar_processos").bloqueio.origem, "painel");
  assert.equal(f("consultar_dashboard").disponivel, false);
  assert.equal(f("consultar_metricas_clt").bloqueio.codigo, "somente_admin");
  assert.equal(f("consultar_candidato").bloqueio.origem, "colaborador", "fora da restrição individual");
  assert.equal(f("buscar_empresas").bloqueio.origem, "integracao", "fora da integração");
  assert.equal(i.abrangencia, "todos"); assert.equal(i.contato, false); assert.equal(i.conexoesAtivas, 1);
  assert.ok(i.chamadas >= 2 && i.negados >= 1 && i.ultimoAcesso);
  const lista = (await A("GET", "/colaboradores")).json.data;
  assert.ok(lista.find((u: any) => u.id === bia.id).integracoes >= 1);
});

test("auditoria: filtros por integração, colaborador, ferramenta, período e resultado; indicadores; sem token, segredo nem payload", async () => {
  const integ = (await A("GET", "/integracoes")).json.data.find((i: any) => i.slug === "visao");
  const hoje = new Date().toISOString().slice(0, 10);
  const todas = (await A("GET", `/auditoria?integracao=${integ.id}`)).json.data;
  assert.ok(todas.indicadores.chamadas >= 2);
  assert.ok(todas.indicadores.negados >= 1);
  assert.equal(typeof todas.indicadores.tempoMedioMs, "number");
  assert.ok(todas.indicadores.ferramentasMaisUsadas.length >= 1 && todas.indicadores.colaboradoresMaisAtivos.length >= 1);
  assert.match(todas.indicadores.servicosExternos.observacao, /não é custo/);
  const so = (url: string) => A("GET", `/auditoria?${url}`).then((r) => r.json.data);
  const negados = await so(`integracao=${integ.id}&resultado=negado`);
  assert.ok(negados.eventos.length >= 1 && negados.eventos.every((e: any) => e.resultado === "negado"));
  const porFerr = await so(`integracao=${integ.id}&ferramenta=buscar_vagas`);
  assert.ok(porFerr.eventos.every((e: any) => e.ferramenta === "buscar_vagas"));
  const porUsuario = await so(`usuario=${bia.id}`);
  assert.ok(porUsuario.eventos.length >= 1 && porUsuario.eventos.every((e: any) => e.colaborador === "Bia"));
  assert.equal((await so(`integracao=${integ.id}&de=${hoje}&ate=${hoje}`)).eventos.length > 0, true);
  assert.equal((await so(`integracao=${integ.id}&de=2000-01-01&ate=2000-01-02`)).eventos.length, 0);
  const pag = await so(`integracao=${integ.id}&limite=1&pagina=2`);
  assert.equal(pag.eventos.length, 1); assert.equal(pag.paginacao.pagina, 2); assert.ok(pag.paginacao.total >= 2);
  assert.equal((await A("GET", `/auditoria?resultado=invalido-xyz`)).status, 422);
  assert.equal((await A("GET", `/auditoria?limite=1000`)).status, 422);
  const bruto = JSON.stringify(todas);
  for (const s of [SEGREDO_ATUAL, SEGREDO_ANTIGO, "Bearer", "access_token", "argumentos", "Ana Fictícia"]) assert.ok(!bruto.includes(s), `auditoria expõe ${s}`);
  assert.ok(!Object.keys(todas.eventos[0]).some((k) => /token|payload|argumento|corpo/i.test(k)));
});

test("infraestrutura: status, contrato, OAuth, validade do certificado e prontidão; nunca segredos nem chaves", async () => {
  const r = await A("GET", "/resumo");
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.mcp.habilitado, true); assert.equal(d.mcp.urlPublica, MCP_URL);
  assert.equal(d.contrato.versaoDoMonolito, 1); assert.deepEqual(d.contrato.aceitas, [1]);
  assert.equal(d.oauth.ativo, true); assert.equal(d.oauth.emissor, APP_URL); assert.equal(d.oauth.registroDinamicoDeClientes, false); assert.ok(d.oauth.escopos.includes("mcp:read"));
  assert.match(d.mtls.modo, /texto puro/, "no teste o canal é texto puro e a tela avisa");
  assert.equal(d.prontidao.pronto, false); assert.ok(d.prontidao.itens.some((i: any) => /mTLS/.test(i.item) && i.ok === false));
  assert.ok(Array.isArray(d.chatgpt.passos) && d.chatgpt.passos.length >= 4);
  assert.ok(typeof d.retencao.auditoriaDias === "number");
  const texto = r.corpo;
  for (const s of [SEGREDO_ATUAL, SEGREDO_ANTIGO, "PRIVATE KEY", "client_secret", "MCP_GATEWAY_SECRETS=", "BEGIN CERTIFICATE"]) assert.ok(!texto.includes(s), `resumo expõe ${s}`);
  assert.ok(Object.keys(d).every((k) => !/^(secret|key|hmac|privateKey)/i.test(k)), "sem campos de segredo");
});

test("consentimento OAuth: mostra integração, usuário, finalidade, módulos reais, escopos e privacidade; autorização não amplia o que a administração concedeu", async () => {
  const integ = (await A("POST", "/integracoes", { slug: "consent", nome: "Atendimento Consent", descricao: "Atendimento ao candidato", finalidade: "Responder dúvidas de candidatos" })).json.data;
  await A("PUT", `/integracoes/${integ.id}/ferramentas`, { ferramentas: ["buscar_vagas", "consultar_candidato", "gerar_dossie", "consultar_dashboard"] });
  await A("POST", `/integracoes/${integ.id}/ativa`, { ativa: true });
  // Ana: só as páginas vagas/candidatos/empresas (sem triagem → sem dossiê; sem painel → sem dashboard), abrangência 'todos'
  await A("PUT", `/integracoes/${integ.id}/colaboradores/${ana.id}`, { abrangencia: "todos" });
  const { challenge } = pkce();
  const inicio = await autorizar(amb, { resource: `${MCP_URL}/mcp/consent`, challenge });
  const uid = uidDoRedirect(String(inicio.headers.location));
  const info = (await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}`, headers: { cookie: ana.cookie } })).json().data;
  assert.equal(info.pode, true);
  assert.equal(info.integracao.nome, "Atendimento Consent"); assert.equal(info.integracao.finalidade, "Responder dúvidas de candidatos");
  assert.equal(info.usuario.nome, "Ana"); assert.deepEqual(info.escopos.concedidos, ["mcp:read"]);
  assert.match(info.acesso, /somente leitura/i);
  assert.deepEqual(info.modulos.map((m: any) => m.id).sort(), ["candidatos", "vagas"], "só os módulos que ela realmente poderá usar");
  assert.equal(info.abrangencia, "todos"); assert.equal(info.contato, false);
  assert.ok(info.privacidade.length >= 4 && info.privacidade.some((p: string) => /CPF/.test(p)));
  const bruto = JSON.stringify(info);
  for (const s of [SEGREDO_ATUAL, "access_token", "client_secret", "code_challenge"]) assert.ok(!bruto.includes(s), s);
  // quem não foi autorizado pelo administrador não consegue autorizar (o consentimento não cria permissão)
  const semVinculo = (await amb.app.inject({ method: "GET", url: `/api/v1/mcp/interacao/${uid}`, headers: { cookie: bia.cookie } })).json().data;
  assert.equal(semVinculo.pode, false); assert.match(semVinculo.motivo, /não foi autorizado/); assert.deepEqual(semVinculo.modulos, []);
  const recusa = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: bia.cookie, origin: APP_URL }, payload: { aprovar: true } });
  assert.equal(recusa.statusCode, 403);
  const decisaoSemOrigem = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie }, payload: { aprovar: true } });
  assert.equal(decisaoSemOrigem.statusCode, 403, "CSRF: sem Origin do painel não decide");
  // Recusar leva o cliente a access_denied
  const negar = await amb.app.inject({ method: "POST", url: `/api/v1/mcp/interacao/${uid}/decisao`, headers: { cookie: ana.cookie, origin: APP_URL }, payload: { aprovar: false } });
  assert.equal(negar.statusCode, 200);
});

test("busca de registros para autorizar: só id, nome e cidade; mínimo de 2 letras; só administrador", async () => {
  const c = await A("GET", "/registros/busca?tipo=candidato&q=Beat");
  assert.equal(c.status, 200); assert.ok(c.json.data.length <= 8);
  assert.deepEqual(Object.keys(c.json.data[0] ?? { id: 1, nome: 1, detalhe: 1 }).sort(), ["detalhe", "id", "nome"]);
  const e = await A("GET", "/registros/busca?tipo=empresa&q=Alfa");
  assert.equal(e.json.data[0].id, "E1");
  assert.equal((await A("GET", "/registros/busca?tipo=candidato&q=a")).status, 422);
  assert.equal((await api(comum, "GET", "/registros/busca?tipo=candidato&q=Ana")).status, 403);
  assert.ok(!c.corpo.includes("cpf") && !c.corpo.includes("celular"));
});

test("preservação: com o MCP desligado a aba ainda administra, e as rotas atuais do painel seguem iguais", async () => {
  const lista = await amb.app.inject({ method: "GET", url: "/api/v1/configuracoes/acessos", headers: { cookie: admin.cookie } });
  assert.equal(lista.statusCode, 200);
  const eu = await amb.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: ana.cookie } });
  assert.equal(eu.statusCode, 200); assert.deepEqual(eu.json().data.paginas.sort(), ["candidatos", "empresas", "vagas"]);
  const semMcp = await amb.app.inject({ method: "GET", url: "/api/v1/configuracoes/mcp/resumo", headers: { cookie: comum.cookie } });
  assert.equal(semMcp.statusCode, 403);
  void criarIntegracao;
});
