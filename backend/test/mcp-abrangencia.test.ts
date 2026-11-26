import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { criarAmbiente, criarIntegracao, criarUsuario, obterTokens, requisicaoInterna, type Ambiente, type UsuarioTeste } from "./mcp-suporte.js";

/**
 * Abrangência dos registros (camada própria do MCP): nenhuma / autorizados / todos, por colaborador e integração.
 * Dados FICTÍCIOS. A interseção página do painel ∧ integração ∧ ferramenta do colaborador ∧ abrangência ∧ escopo OAuth ∧ permissão individual
 * é recalculada a cada chamada, e "próprios"/"equipe" não existem porque o banco não registra responsável nem equipe.
 */
let amb: Ambiente;
let todos: UsuarioTeste; let restrita: UsuarioTeste; let empresa2: UsuarioTeste; let nenhuma: UsuarioTeste; let adm: UsuarioTeste; let gerente: UsuarioTeste;
const tk: Record<string, string> = {};
let integracaoId: string;
const SLUG = "abr";
const P1 = "11111111-1111-4111-8111-111111111111"; // processo de C1 na empresa E1
const P2 = "22222222-2222-4222-8222-222222222222"; // processo de C2 na empresa E2

async function chamar(token: string, ferramenta: string, argumentos: unknown = {}) {
  const r = await requisicaoInterna(amb, { slug: SLUG, operacao: "executar", token, corpo: { ferramenta, argumentos } });
  const j = r.json() as any;
  return { status: r.statusCode, data: j.data, estruturado: j.data?.structuredContent, erro: j.error?.code, texto: j.data?.content?.[0]?.text as string | undefined, corpo: r.body };
}
const catalogo = async (token: string) => ((await requisicaoInterna(amb, { slug: SLUG, operacao: "ferramentas", token })).json() as any).data.ferramentas.map((f: any) => f.nome).sort() as string[];
const vincular = (u: UsuarioTeste, o: { ferramentas?: string[] | null; permissoes?: string[]; abrangencia?: "nenhuma" | "autorizados" | "todos" }) =>
  amb.app.mcp!.integracoes.vincularUsuario(integracaoId, u.id, o);
const registro = async (u: UsuarioTeste, tipo: "candidato" | "empresa", id: string) =>
  amb.db.query("INSERT INTO dna_work.mcp_integracao_usuario_registro (id_integracao, id_usuario, tipo, id_registro) VALUES ($1,$2,$3,$4)", [integracaoId, u.id, tipo, id]);

const LISTAS = ["buscar_candidatos", "listar_processos", "listar_contratacoes"];
const POR_ID = ["consultar_candidato", "consultar_perfil_profissional", "consultar_historico_candidato", "localizar_candidato_por_deal", "consultar_dados_dossie", "gerar_dossie", "consultar_processo", "consultar_contratacao"];
const AGREGADOS = ["consultar_dashboard", "consultar_indicadores_contratacoes", "consultar_origem_candidatos", "consultar_metricas_clt", "consultar_metricas_estagio"];

before(async () => {
  amb = await criarAmbiente();
  const paginas = ["vagas", "empresas", "candidatos", "processos", "contratacoes", "triagem", "painel"];
  todos = await criarUsuario(amb, "Todos", paginas);
  restrita = await criarUsuario(amb, "Restrita", paginas);
  empresa2 = await criarUsuario(amb, "Empresa2", paginas);
  nenhuma = await criarUsuario(amb, "Nenhuma", paginas);
  gerente = await criarUsuario(amb, "Gerente", paginas);
  adm = await criarUsuario(amb, "Admin", [], { admin: true });
  integracaoId = (await criarIntegracao(amb, SLUG, { ferramentas: amb.app.mcp!.registro.nomes(), usuarios: [
    { id: todos.id, abrangencia: "todos" }, { id: restrita.id, abrangencia: "autorizados" }, { id: empresa2.id, abrangencia: "autorizados" },
    { id: nenhuma.id, abrangencia: "nenhuma" }, { id: gerente.id, abrangencia: "todos" }, { id: adm.id, abrangencia: "nenhuma" },
  ] })).id;
  const q = (sql: string, p: unknown[] = []) => amb.db.query(sql, p);
  await q("INSERT INTO dna_work.empresa (id_empresa, razao_social, nome_fantasia, status) VALUES ('E1','Alfa Ltda','Loja Alfa',1), ('E2','Beta SA','Café Beta',1)");
  await q("INSERT INTO dna_work.vaga (id_vaga, id_empresa, cargo, tipo_vaga, status, dataabertura, quantidade_posicoes) VALUES ('V1','E1','Atendente',2,0,'2026-11-01',2), ('V2','E2','Caixa',2,0,'2026-11-01',2)");
  await q("INSERT INTO dna_work.candidato (id_candidato, nome, cidade, estado, celular, email, atendimento) VALUES ('C1','Ana Fictícia','São Paulo','SP','11900000001','ana@exemplo.test',$1::jsonb), ('C2','Bruno Fictício','Campinas','SP','11900000002','bruno@exemplo.test','{}'::jsonb)", [JSON.stringify({ deal_id: "D777" })]);
  await q("INSERT INTO dna_work.processo_seletivo (id, id_candidato, id_empresa, id_vaga, origem, data_recebimento, etapa, atendimento) VALUES ($1,'C1','E1','V1','dnawork','2026-02-01','recebido',$3::jsonb), ($2,'C2','E2','V2','dnawork','2026-02-02','recebido','{}'::jsonb)", [P1, P2, JSON.stringify({ deal_id: "D777" })]);
  await q("INSERT INTO dna_work.conratacaovaga (id_contratacao, id_vaga, id_candidato, data_contratacao, status, id_empresa, datainicio) VALUES (1,'V1','C1','2026-02-20',1,'E1','2026-03-01'), (2,'V2','C2','2026-02-21',1,'E2','2026-03-02')");
  await registro(restrita, "candidato", "C1");
  await registro(empresa2, "empresa", "E2");
  const recurso = `https://mcp.test.local/mcp/${SLUG}`;
  for (const [nome, u] of Object.entries({ todos, restrita, empresa2, nenhuma, gerente, adm })) tk[nome] = (await obterTokens(amb, u, recurso)).access_token;
});
after(async () => { await amb?.fechar(); });

test("sem abrangência (padrão): ferramentas com dados individuais e indicadores somem do catálogo e não executam", async () => {
  const c = await catalogo(tk.nenhuma);
  for (const nome of [...LISTAS, ...POR_ID, ...AGREGADOS]) assert.ok(!c.includes(nome), `${nome} não deveria aparecer sem abrangência`);
  assert.ok(c.includes("buscar_vagas") && c.includes("buscar_empresas") && c.includes("listar_registros_autorizados"), "catálogo de vagas/empresas segue pela página");
  await amb.db.query("DELETE FROM dna_work.mcp_auditoria");
  for (const nome of ["buscar_candidatos", "consultar_candidato", "listar_processos", "consultar_contratacao"]) {
    const r = await chamar(tk.nenhuma, nome, { id_candidato: "C1", nome: "Ana", id_processo: P1, id_contratacao: 1 });
    assert.equal(r.status, 404); assert.equal(r.erro, "FERRAMENTA_INDISPONIVEL");
  }
  const { rows } = await amb.db.query("SELECT DISTINCT codigo FROM dna_work.mcp_auditoria WHERE resultado = 'negado'");
  assert.deepEqual(rows.map((r) => r.codigo), ["abrangencia_nao_concedida"]);
  const lista = await chamar(tk.nenhuma, "listar_registros_autorizados");
  assert.equal(lista.estruturado.abrangencia, "autorizados"); assert.deepEqual([lista.estruturado.candidatos, lista.estruturado.empresas], [[], []]);
});

test("novo vínculo nasce sem abrangência e uma edição de ferramentas não a reseta nem a amplia", async () => {
  const dora = await criarUsuario(amb, "Dora", ["candidatos"]);
  await vincular(dora, {});
  const { rows } = await amb.db.query("SELECT abrangencia FROM dna_work.mcp_integracao_usuario WHERE id_usuario = $1", [dora.id]);
  assert.equal(rows[0].abrangencia, "nenhuma");
  await vincular(dora, { abrangencia: "autorizados" });
  await vincular(dora, { ferramentas: null });
  const depois = await amb.db.query("SELECT abrangencia FROM dna_work.mcp_integracao_usuario WHERE id_usuario = $1", [dora.id]);
  assert.equal(depois.rows[0].abrangencia, "autorizados");
  await amb.db.query("DELETE FROM dna_work.mcp_integracao_usuario WHERE id_usuario = $1", [dora.id]);
});

test("autorizados: só consultas por id, nunca busca/listagem/indicadores; o catálogo reflete isso", async () => {
  const c = await catalogo(tk.restrita);
  for (const nome of POR_ID) assert.ok(c.includes(nome), `${nome} deveria existir (consulta por id)`);
  for (const nome of [...LISTAS, ...AGREGADOS]) assert.ok(!c.includes(nome), `${nome} não pode existir com abrangência autorizados`);
});

test("autorizados: candidato autorizado abre; outro candidato ou id inexistente recebem a MESMA resposta (não revela existência)", async () => {
  const ok = await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C1" });
  assert.equal(ok.data.isError, false); assert.equal(ok.estruturado.candidato.nome, "Ana Fictícia");
  const fora = await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C2" });
  const naoExiste = await chamar(tk.restrita, "consultar_candidato", { id_candidato: "ZZZ" });
  assert.equal(fora.data.isError, true); assert.equal(fora.texto, naoExiste.texto);
  assert.match(fora.texto!, /fora da sua abrangência/);
  assert.ok(!fora.corpo.includes("Bruno"));
  for (const nome of ["consultar_perfil_profissional", "consultar_historico_candidato"]) {
    assert.equal((await chamar(tk.restrita, nome, { id_candidato: "C1" })).data.isError, false, nome);
    const negado = await chamar(tk.restrita, nome, { id_candidato: "C2" });
    assert.equal(negado.data.isError, true, nome); assert.ok(!negado.corpo.includes("Bruno"));
  }
  const h = await chamar(tk.restrita, "consultar_historico_candidato", { id_candidato: "C1" });
  assert.equal(h.estruturado.processos.length, 1); assert.equal(h.estruturado.contratacoes.length, 1);
});

test("autorizados: deal_id só localiza candidato autorizado; dossiê só do deal de candidato autorizado", async () => {
  const meu = await chamar(tk.restrita, "localizar_candidato_por_deal", { deal_id: "D777" });
  assert.equal(meu.estruturado.encontrado, true); assert.equal(meu.estruturado.candidato.id_candidato, "C1");
  const alheio = await chamar(tk.empresa2, "localizar_candidato_por_deal", { deal_id: "D777" });
  assert.equal(alheio.estruturado.encontrado, false); assert.equal(alheio.estruturado.candidato, null);
  assert.ok(!alheio.corpo.includes("Ana Fictícia"));
  // Dossiê: a empresa2 (sem candidato autorizado) é negada; sem vínculo verificável a negativa é a mesma.
  for (const [nome, args] of [["consultar_dados_dossie", { deal_id: "D777" }], ["gerar_dossie", { deal_id: "D777", id_vaga: "V1" }]] as const) {
    const r = await chamar(tk.empresa2, nome, args);
    assert.equal(r.data.isError, true, nome); assert.match(r.texto!, /fora da sua abrangência/);
  }
  const semVinculo = await chamar(tk.restrita, "consultar_dados_dossie", { deal_id: "DEAL-SEM-CANDIDATO" });
  assert.equal(semVinculo.data.isError, true, "deal que não leva a um candidato do painel não pode ser verificado");
});

test("autorizados: processo e contratação valem pelo candidato OU pela empresa autorizados (vínculos reais do banco)", async () => {
  // restrita = candidato C1; empresa2 = empresa E2
  assert.equal((await chamar(tk.restrita, "consultar_processo", { id_processo: P1 })).data.isError, false);
  assert.equal((await chamar(tk.restrita, "consultar_processo", { id_processo: P2 })).data.isError, true);
  assert.equal((await chamar(tk.empresa2, "consultar_processo", { id_processo: P2 })).data.isError, false);
  const alheio = await chamar(tk.empresa2, "consultar_processo", { id_processo: P1 });
  assert.equal(alheio.data.isError, true); assert.ok(!alheio.corpo.includes("Ana Fictícia"));
  assert.equal((await chamar(tk.restrita, "consultar_contratacao", { id_contratacao: 1 })).data.isError, false);
  assert.equal((await chamar(tk.restrita, "consultar_contratacao", { id_contratacao: 2 })).data.isError, true);
  assert.equal((await chamar(tk.empresa2, "consultar_contratacao", { id_contratacao: 2 })).data.isError, false);
  assert.equal((await chamar(tk.empresa2, "consultar_contratacao", { id_contratacao: 1 })).data.isError, true);
  // A empresa autorizada NÃO abre a ficha do candidato (só o que a empresa tem: processos e contratações dela).
  assert.equal((await chamar(tk.empresa2, "consultar_candidato", { id_candidato: "C2" })).data.isError, true);
});

test("filtros, paginação e ferramentas alternativas não contornam a abrangência", async () => {
  for (const [nome, args] of [["buscar_candidatos", { nome: "Bruno" }], ["buscar_candidatos", { id_empresa: "E2" }], ["listar_processos", { id_candidato: "C2" }], ["listar_processos", { id_empresa: "E2", pagina: 1, limite: 25 }], ["listar_contratacoes", { id_candidato: "C2" }]] as const) {
    for (const quem of ["restrita", "empresa2"]) {
      const r = await chamar(tk[quem], nome, args);
      assert.equal(r.status, 404, `${quem} ${nome}`); assert.equal(r.erro, "FERRAMENTA_INDISPONIVEL");
    }
  }
  // Id numérico/estranho e variações no mesmo id não passam.
  for (const id of ["c1", "C1%", "C10", "C1' OR '1'='1"]) { // (espaços nas pontas são aparados pelo schema: é o mesmo id)
    const r = await chamar(tk.restrita, "consultar_candidato", { id_candidato: id });
    assert.equal(r.data?.isError ?? true, true, id);
  }
  // A lista de registros autorizados mostra só o autorizado e nada de contato.
  const l = await chamar(tk.restrita, "listar_registros_autorizados");
  assert.deepEqual(l.estruturado.candidatos.map((c: any) => [c.id_candidato, c.nome]), [["C1", "Ana Fictícia"]]);
  assert.ok(!l.corpo.includes("ana@exemplo.test") && !l.corpo.includes("11900000001"));
  const e = await chamar(tk.empresa2, "listar_registros_autorizados");
  assert.deepEqual(e.estruturado.empresas.map((x: any) => x.id_empresa), ["E2"]); assert.deepEqual(e.estruturado.candidatos, []);
});

test("todos: busca, listagem e consulta por id funcionam dentro das permissões do painel", async () => {
  const c = await catalogo(tk.todos);
  for (const nome of [...LISTAS, ...POR_ID]) assert.ok(c.includes(nome), nome);
  assert.equal((await chamar(tk.todos, "consultar_candidato", { id_candidato: "C2" })).data.isError, false);
  assert.equal((await chamar(tk.todos, "buscar_candidatos", { nome: "Bruno" })).estruturado.candidatos.length, 1);
  assert.equal((await chamar(tk.todos, "listar_processos", {})).estruturado.processos.length, 2);
});

test("alteração da abrangência vale na PRÓXIMA chamada, com o mesmo token (sem rebuild, sem novo login)", async () => {
  assert.equal((await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C1" })).data.isError, false);
  await vincular(restrita, { abrangencia: "nenhuma" });
  assert.equal((await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C1" })).status, 404);
  await vincular(restrita, { abrangencia: "todos" });
  assert.equal((await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C2" })).data.isError, false);
  await vincular(restrita, { abrangencia: "autorizados" });
  assert.equal((await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C2" })).data.isError, true);
  // Tirar o registro da lista também vale já na próxima chamada.
  await amb.db.query("DELETE FROM dna_work.mcp_integracao_usuario_registro WHERE id_usuario = $1", [restrita.id]);
  assert.equal((await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C1" })).data.isError, true);
  await registro(restrita, "candidato", "C1");
});

test("indicadores gerenciais: só administração por padrão; colaborador precisa da permissão individual E da abrangência 'todos'", async () => {
  // gerente: todos + página painel, mas sem a permissão individual
  let c = await catalogo(tk.gerente);
  for (const nome of ["consultar_dashboard", "consultar_indicadores_contratacoes", "consultar_origem_candidatos"]) assert.ok(!c.includes(nome), `${nome} sem a permissão`);
  await vincular(gerente, { permissoes: ["gestao:indicadores"] });
  c = await catalogo(tk.gerente);
  for (const nome of ["consultar_dashboard", "consultar_indicadores_contratacoes", "consultar_origem_candidatos"]) assert.ok(c.includes(nome), `${nome} com a permissão`);
  assert.ok(!c.includes("consultar_metricas_clt"), "métricas continuam só de administrador");
  // permissão sem abrangência 'todos' não basta
  await vincular(gerente, { permissoes: ["gestao:indicadores"], abrangencia: "autorizados" });
  assert.ok(!(await catalogo(tk.gerente)).includes("consultar_dashboard"));
  await vincular(gerente, { permissoes: [], abrangencia: "todos" });
  // administrador efetivo dispensa a permissão individual, mas não a abrangência
  assert.ok(!(await catalogo(tk.adm)).includes("consultar_dashboard"), "admin com abrangência 'nenhuma' continua bloqueado");
  await vincular(adm, { abrangencia: "todos" });
  const ca = await catalogo(tk.adm);
  for (const nome of [...AGREGADOS, ...LISTAS, ...POR_ID]) assert.ok(ca.includes(nome), nome);
  await vincular(adm, { abrangencia: "nenhuma" });
});

test("contato do candidato continua desligado por padrão, mesmo com abrangência 'todos'", async () => {
  const r = await chamar(tk.todos, "consultar_candidato", { id_candidato: "C1" });
  assert.equal(r.estruturado.contato_liberado, false);
  assert.ok(!r.corpo.includes("ana@exemplo.test") && !r.corpo.includes("11900000001"));
  await vincular(todos, { permissoes: ["candidatos:contato"] });
  const liberado = await chamar(tk.todos, "consultar_candidato", { id_candidato: "C1" });
  assert.equal(liberado.estruturado.contato_liberado, true); assert.match(liberado.corpo, /ana@exemplo\.test/);
  // a abrangência 'autorizados' não libera contato de ninguém por si só
  const alheio = await chamar(tk.restrita, "consultar_candidato", { id_candidato: "C1" });
  assert.equal(alheio.estruturado.contato_liberado, false); assert.ok(!alheio.corpo.includes("ana@exemplo.test"));
  await vincular(todos, { permissoes: [] });
});

test("isolamento entre colaboradores: o que um tem autorizado não aparece para o outro", async () => {
  const a = await chamar(tk.restrita, "listar_registros_autorizados");
  const b = await chamar(tk.empresa2, "listar_registros_autorizados");
  assert.ok(!JSON.stringify(a.estruturado).includes("E2") && !JSON.stringify(b.estruturado).includes("C1"));
});
