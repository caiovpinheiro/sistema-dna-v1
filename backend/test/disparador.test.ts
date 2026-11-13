import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { lerCsv, lerPlanilha } from "../src/lib/planilha.js";
import { DisparadorService, separarTelefones, type CrmFn } from "../src/services/disparador.service.js";

test("telefones colados: separadores variados, sem repetir o mesmo número", () => {
  assert.deepEqual(separarTelefones("(11) 97035-0419\n11970350419; 5541984941906,\t41 98494-1906\n\n"), ["(11) 97035-0419", "5541984941906"]);
});

test("CSV com ; e aspas, e xlsx com textos compartilhados e telefone numérico", async () => {
  const csv = lerCsv("Nome;Telefone;Cargo\n\"Ana; Souza\";11970350419;Atendente\nBruno;41984941906;\n");
  assert.deepEqual(csv.colunas, ["Nome", "Telefone", "Cargo"]);
  assert.deepEqual(csv.linhas, [["Ana; Souza", "11970350419", "Atendente"], ["Bruno", "41984941906", ""]]);

  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook><sheets><sheet name="Plan1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/sharedStrings.xml", "<sst><si><t>Nome</t></si><si><t>Telefone</t></si><si><r><t>Ana </t></r><r><t>&amp; Cia</t></r></si></sst>");
  zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>5.511970350419E12</v></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>41 98494-1906</t></is></c></row></sheetData></worksheet>');
  const xlsx = await lerPlanilha("lista.xlsx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(xlsx.colunas, ["Nome", "Telefone"]);
  assert.deepEqual(xlsx.linhas, [["Ana & Cia", "5511970350419"], ["", "41 98494-1906"]]);
});

function crmFalso(respostas: (path: string, init?: RequestInit) => unknown) {
  const chamadas: Array<{ path: string; metodo: string; corpo: unknown }> = [];
  const crm = (async (path: string, init?: RequestInit) => {
    chamadas.push({ path, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return respostas(path, init);
  }) as CrmFn;
  return { crm, chamadas };
}

const PIPELINES = [{ id: "p1", name: "Candidaturas", isDefault: true, stages: [{ id: "s2", name: "Ativações", position: 1 }, { id: "s1", name: "Lead de Entrada", position: 0 }] }];

test("verificar: existe, não existe e telefone inválido", async () => {
  const { crm } = crmFalso((path) => {
    if (path.startsWith("/api/contacts?phone=5511970350419")) return { items: [{ id: "c1", name: "Mateus" }] };
    if (path.startsWith("/api/contacts")) return { items: [] };
    if (path.startsWith("/api/deals?contactPhone=5511970350419")) return { items: [{ id: "d1", title: "Negócio", status: "LOST", stage: { id: "s1", name: "Lead", pipeline: { id: "p1", name: "Candidaturas" } } }, { id: "d2", status: "OPEN", stage: { id: "s2", name: "Ativações", pipeline: { id: "p1", name: "Candidaturas" } } }] };
    return { items: [] };
  });
  const [mateus, novo, ruim] = await new DisparadorService(crm, {}).verificar(["(11) 97035-0419", "41984941906", "123"]);
  assert.equal(mateus.existe, true);
  assert.equal(mateus.contato?.nome, "Mateus");
  assert.deepEqual(mateus.deals.map((d) => d.id), ["d2", "d1"]);
  assert.equal(novo.existe, false);
  assert.equal(novo.normalizado, "5541984941906");
  assert.equal(ruim.valido, false);
});

test("criar: lead novo com campos, deal aberto movido para a fase, ou mantido sem duplicar", async () => {
  const { crm, chamadas } = crmFalso((path) => {
    if (path === "/api/pipelines") return PIPELINES;
    if (path.startsWith("/api/custom-fields")) return [];
    if (path.startsWith("/api/deals?contactPhone=5511970350419")) return { items: [{ id: "d9", stage: { id: "s1", name: "Lead de Entrada" } }] };
    if (path.startsWith("/api/deals?")) return { items: [] };
    if (path === "/api/leads") return { contact: { id: "c2" }, deal: { id: "d2" } };
    return {};
  });
  const servico = new DisparadorService(crm, {});
  const itens = [{ telefone: "41984941906", nome: "Talita", campos: [{ fieldId: "f1", value: "Atendente" }, { fieldId: "f2", value: " " }] }, { telefone: "11970350419" }, { telefone: "abc" }];
  const r = await servico.criar({ stageId: "s2", itens, moverExistentes: true, origem: "teste" });
  assert.deepEqual(r.map((x) => x.status), ["criado", "movido", "erro"]);
  const lead = chamadas.find((c) => c.path === "/api/leads");
  assert.deepEqual(lead?.corpo, { contact: { name: "Talita", phone: "+5541984941906", lifecycleStage: "LEAD", source: "teste" }, deal: { stageId: "s2", title: "Negócio Talita", customFields: [{ fieldId: "f1", value: "Atendente" }] } });
  assert.ok(chamadas.some((c) => c.path === "/api/deals/d9" && c.metodo === "PUT" && JSON.stringify(c.corpo) === '{"stageId":"s2"}'));
  assert.ok(chamadas.some((c) => c.path.includes("pipelineId=p1")));

  const semMover = await servico.criar({ stageId: "s2", itens: [{ telefone: "11970350419" }], moverExistentes: false, origem: "teste" });
  assert.equal(semMover[0].status, "ja_estava");
});

test("disparar: etiqueta nos contatos, campanha filtrada pela etiqueta e lançamento", async () => {
  const { crm, chamadas } = crmFalso((path) => {
    if (path === "/api/tags") return { id: "t1" };
    if (path === "/api/integrations/campaigns") return { campaign: { id: "camp1" } };
    return {};
  });
  const r = await new DisparadorService(crm, { BWIPO_CANAL_DISPARO_ID: "ch1" }).disparar({ contatoIds: ["c1", "c2", "c1"], template: "ativacao_vaga", idioma: "pt_BR", nome: "" });
  assert.equal(r.campanhaId, "camp1");
  assert.equal(r.contatos, 2);
  const campanha = chamadas.find((c) => c.path === "/api/integrations/campaigns")?.corpo as Record<string, unknown>;
  assert.equal(campanha.channelId, "ch1");
  assert.deepEqual(campanha.filters, { tagIds: ["t1"] });
  assert.equal(campanha.templateName, "ativacao_vaga");
  assert.deepEqual(chamadas.map((c) => c.path), ["/api/tags", "/api/contacts/c1/tags", "/api/contacts/c2/tags", "/api/integrations/campaigns", "/api/integrations/campaigns/camp1/launch"]);
});

test("sem canal configurado usa o canal da última conversa", async () => {
  const { crm, chamadas } = crmFalso((path) => (path === "/api/tags" ? { id: "t1" } : path === "/api/integrations/campaigns" ? { campaign: { id: "x" } } : {}));
  await new DisparadorService(crm, {}).disparar({ contatoIds: ["c1"], template: "t", idioma: "pt_BR", nome: "" });
  const campanha = chamadas.find((c) => c.path === "/api/integrations/campaigns")?.corpo as Record<string, unknown>;
  assert.equal(campanha.useLastConversationChannel, true);
  assert.equal("channelId" in campanha, false);
});
