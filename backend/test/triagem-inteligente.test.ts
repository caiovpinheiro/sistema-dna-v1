import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import sharp from "sharp";
import type { Pool } from "pg";
import { cepDoCurriculo } from "../src/lib/curriculo/cep.js";
import { detectarTipo, prepararCurriculo, TAMANHO_MAXIMO_CURRICULO } from "../src/lib/curriculo/arquivo.js";
import { ateTresFrases, escolaridadeSugerida, mesesSemSobreposicao, normalizarCurriculo, perfilParaEdicao, perfilSuficiente, textoDoCurriculo } from "../src/lib/curriculo/perfil.js";
import { CurriculoService, type FetchLike } from "../src/services/curriculo.service.js";
import { corpoSystemOne, criarTransporteJev, ErroJev, escalaDa, interpretarRespostaJev, montarEstadoJev, PERGUNTA_COMPATIBILIDADE, type RequisicaoJev } from "../src/lib/jev/jev.js";
import { explicarCompatibilidade, ORIGEM_EXPLICACAO } from "../src/lib/jev/explicacao.js";
import { mapComLimite, TriagemMatchingService } from "../src/services/triagem-matching.service.js";
import { TriagemService } from "../src/services/triagem.service.js";
import type { AppConfig } from "../src/config.js";

// ---------- apoio ----------

const b64 = (buffer: Buffer | string) => Buffer.from(buffer).toString("base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function docx(texto: string) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p><w:p><w:r><w:t>Segunda linha &amp; mais</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function codigoDoErro(promessa: Promise<unknown>) {
  try {
    await promessa;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return "SEM_ERRO";
}

function respostaJson(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

function respostaLuna(dados: unknown) {
  return respostaJson(200, { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(dados) }] }] });
}

const LUNA_OK = {
  nome: "Maria Silva",
  localizacao: "São Paulo/SP",
  escolaridade: "Ensino médio completo",
  formacoes: [{ curso: "Ensino médio", instituicao: "EE Centro", situacao: "Completo", periodo: null }],
  ultimo_cargo: "Atendente",
  experiencias: [
    { cargo: "Atendente", empresa: "Loja A", inicio: "2022-01", fim: null, atual: true, duracao_informada: null, atividades: "Atendimento ao cliente e vendas" },
    { cargo: "Operadora de caixa", empresa: "Mercado B", inicio: "2021-06", fim: "2022-06", atual: false, duracao_informada: null, atividades: null },
  ],
  habilidades: ["Atendimento", "atendimento", "WhatsApp", "Não informado"],
  cursos: ["Excel básico"],
  objetivo: null,
  resumo: "Atendente com experiência em varejo. Trabalha com vendas. Usa WhatsApp. Gosta de equipe.",
};

const configLuna = { OPENAI_API_KEY: "sk-teste", OPENAI_API_URL: "https://api.openai.com/v1", LUNA_MODEL: "gpt-6-luna", LUNA_TIMEOUT_MS: 5_000 };
const REFERENCIA = new Date("2026-11-12T12:00:00Z");

// ---------- validação de arquivo ----------

test("arquivo: detecta o tipo pelos bytes, não pela extensão", () => {
  assert.equal(detectarTipo(PDF), "pdf");
  assert.equal(detectarTipo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])), "doc");
  assert.equal(detectarTipo(Buffer.from("texto qualquer")), "desconhecido");
});

test("arquivo: PDF válido passa e vai como arquivo; PDF truncado é recusado", async () => {
  const pronto = await prepararCurriculo({ nome: "cv.pdf", base64: b64(PDF) });
  assert.equal(pronto.tipo, "pdf");
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.pdf", base64: b64("%PDF-1.4 sem fim") })), "ARQUIVO_INVALIDO");
});

test("arquivo: recusa DOC antigo, tipo desconhecido, extensão divergente, base64 inválido e arquivo grande", async () => {
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.doc", base64: b64(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2])) })), "TIPO_NAO_SUPORTADO");
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.exe", base64: b64("MZ executável") })), "TIPO_NAO_SUPORTADO");
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "foto.png", base64: b64(PDF) })), "TIPO_DIVERGENTE");
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.pdf", base64: "não é base64!" })), "ARQUIVO_INVALIDO");
  const grande = Buffer.concat([PDF, Buffer.alloc(TAMANHO_MAXIMO_CURRICULO)]);
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.pdf", base64: b64(grande) })), "ARQUIVO_GRANDE");
});

test("arquivo: DOCX vira texto no servidor; DOCX sem texto ou ZIP qualquer são recusados", async () => {
  const pronto = await prepararCurriculo({ nome: "cv.docx", base64: b64(await docx("Atendente de loja com experiência em vendas")) });
  assert.deepEqual(pronto, { tipo: "texto", texto: "Atendente de loja com experiência em vendas\nSegunda linha & mais" });
  const zip = new JSZip();
  zip.file("outro.txt", "nada");
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.docx", base64: b64(await zip.generateAsync({ type: "nodebuffer" })) })), "ARQUIVO_INVALIDO");
});

test("arquivo: imagem é validada pelo conteúdo", async () => {
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).png().toBuffer();
  const pronto = await prepararCurriculo({ nome: "cv.png", base64: b64(png) });
  assert.equal(pronto.tipo, "imagem");
  const corrompido = Buffer.concat([png.subarray(0, 16), Buffer.from("lixo")]);
  assert.equal(await codigoDoErro(prepararCurriculo({ nome: "cv.png", base64: b64(corrompido) })), "ARQUIVO_INVALIDO");
});

// ---------- normalização do currículo ----------

test("currículo: normaliza, remove repetidos e 'Não informado', limita o resumo a 3 frases", () => {
  const extraido = normalizarCurriculo(LUNA_OK, REFERENCIA);
  assert.deepEqual(extraido.habilidades, ["Atendimento", "WhatsApp"]);
  assert.equal(extraido.objetivo, null);
  assert.equal(extraido.resumo, "Atendente com experiência em varejo. Trabalha com vendas. Usa WhatsApp.");
  assert.equal(ateTresFrases(null), null);
});

test("currículo: tempo total não conta duas vezes períodos simultâneos", () => {
  // 2021-06..2022-06 e 2022-01..2026-11 se sobrepõem: total = 2021-06..2026-11 = 66 meses.
  const extraido = normalizarCurriculo(LUNA_OK, REFERENCIA);
  assert.equal(extraido.tempoTotal.meses, 66);
  assert.equal(extraido.tempoTotal.texto, "5 anos e 6 meses");
  assert.equal(extraido.experiencias[1].meses, 13);
  assert.equal(mesesSemSobreposicao([{ inicio: 0, fim: 11 }, { inicio: 12, fim: 23 }, { inicio: 5, fim: 8 }]), 24);
});

test("currículo: sem datas não inventa duração; datas só com ano ficam aproximadas", () => {
  const semDatas = normalizarCurriculo({ ...LUNA_OK, experiencias: [{ cargo: "Vendedor", empresa: "X", inicio: null, fim: null, atual: false, duracao_informada: null, atividades: null }] }, REFERENCIA);
  assert.equal(semDatas.tempoTotal.meses, null);
  assert.equal(semDatas.tempoTotal.texto, "Não foi possível calcular com segurança");
  assert.equal(semDatas.experiencias[0].duracao, null);

  const soAno = normalizarCurriculo({ ...LUNA_OK, experiencias: [
    { cargo: "Vendedor", empresa: "X", inicio: "2020", fim: "2021", atual: false, duracao_informada: null, atividades: null },
    { cargo: "Estoquista", empresa: "Y", inicio: null, fim: null, atual: false, duracao_informada: "6 meses", atividades: null },
  ] }, REFERENCIA);
  assert.equal(soAno.tempoTotal.aproximado, true);
  assert.equal(soAno.tempoTotal.semDatas, 1);
  assert.match(soAno.tempoTotal.texto, /^aproximadamente 2 anos \(1 experiência sem datas ficou fora da soma\)$/);
  assert.equal(soAno.experiencias[1].duracao, "6 meses");
});

test("currículo: resposta fora do formato é recusada", () => {
  assert.throws(() => normalizarCurriculo({ experiencias: "muitas" }, REFERENCIA));
  assert.throws(() => normalizarCurriculo(null, REFERENCIA));
});

test("currículo: perfil da tela vem preenchido e o texto para o JEV só leva dados profissionais", () => {
  const perfil = perfilParaEdicao(normalizarCurriculo({ ...LUNA_OK, idade: 30, sexo: "F" }, REFERENCIA));
  assert.equal(perfil.escolaridade, "medio_completo");
  assert.equal(perfil.tempoExperiencia, "5 anos e 6 meses");
  assert.equal(perfil.habilidades, "Atendimento, WhatsApp");
  assert.equal(perfil.turno, "");
  const texto = textoDoCurriculo({ ...perfil, turno: "noite", turnoEstudo: "manha" });
  assert.doesNotMatch(texto, /Maria|São Paulo|\bidade\b|\bsexo\b|noite|manhã|manha/i);
  assert.match(texto, /^Escolaridade: Ensino médio completo\nTempo total de experiência: 5 anos e 6 meses\nHabilidades e conhecimentos: Atendimento, WhatsApp\n\nCurrículo analisado:\n/);
  assert.match(texto, /- Atendente — Loja A — 4 anos e 11 meses: Atendimento ao cliente e vendas/);
  assert.equal(perfilSuficiente(perfil), true);
  assert.equal(perfilSuficiente({ escolaridade: "medio_completo", tempoExperiencia: "2 anos" }), false);
  assert.equal(perfilSuficiente({ habilidades: "Excel, caixa" }), true);
});

test("currículo: escolaridade sugerida só quando o texto é claro", () => {
  assert.equal(escolaridadeSugerida("Ensino médio completo"), "medio_completo");
  assert.equal(escolaridadeSugerida("Ensino Médio incompleto"), "medio_incompleto");
  assert.equal(escolaridadeSugerida("Cursando o 2º ano do ensino médio"), "cursando_medio");
  assert.equal(escolaridadeSugerida("Superior em Administração (cursando, 3º semestre)"), "cursando_superior");
  assert.equal(escolaridadeSugerida("Graduação em Pedagogia — concluído"), "superior_completo");
  assert.equal(escolaridadeSugerida("Superior incompleto"), "");
  assert.equal(escolaridadeSugerida("Curso técnico"), "");
  assert.equal(escolaridadeSugerida(null), "");
});

// ---------- Luna ----------

test("Luna: sem chave responde 503 e não chama a OpenAI", async () => {
  let chamadas = 0;
  const service = new CurriculoService({ ...configLuna, OPENAI_API_KEY: "" }, async () => { chamadas += 1; return respostaJson(200, {}); });
  assert.equal(await codigoDoErro(service.analisar({ tipo: "texto", texto: "currículo" })), "LUNA_NAO_CONFIGURADA");
  assert.equal(chamadas, 0);
  assert.deepEqual(await service.verificarModelo(), { disponivel: null, motivo: "OPENAI_API_KEY não definida." });
});

test("Luna: envia PDF inline para gpt-6-luna sem guardar e devolve perfil editável", async () => {
  let enviado: Record<string, unknown> = {};
  const fetcher: FetchLike = async (_url, init) => {
    enviado = JSON.parse(String(init?.body));
    return respostaLuna(LUNA_OK);
  };
  const service = new CurriculoService(configLuna, fetcher, () => REFERENCIA);
  const analise = await service.analisar({ tipo: "pdf", nome: "cv.pdf", base64: b64(PDF) });
  assert.equal(enviado.model, "gpt-6-luna");
  assert.equal(enviado.store, false);
  assert.match(JSON.stringify(enviado.input), /data:application\/pdf;base64,/);
  assert.equal((enviado.text as { format: { type: string } }).format.type, "json_schema");
  assert.equal(analise.perfil.escolaridade, "medio_completo");
  assert.match(analise.perfil.curriculo, /Experiência profissional:/);
  assert.equal(analise.extraido.tempoTotal.meses, 66);
});

test("Luna: sem suporte a structured output repete com o schema no texto", async () => {
  const corpos: Array<Record<string, unknown>> = [];
  const fetcher: FetchLike = async (_url, init) => {
    corpos.push(JSON.parse(String(init?.body)));
    return corpos.length === 1 ? respostaJson(400, { error: { message: "text.format não suportado" } }) : respostaLuna(LUNA_OK);
  };
  const analise = await new CurriculoService(configLuna, fetcher, () => REFERENCIA).analisar({ tipo: "texto", texto: "Atendente na Loja A desde 2022" });
  assert.equal(corpos.length, 2);
  assert.equal(corpos[1].text, undefined);
  assert.match(analise.perfil.curriculo, /Atendente/);
});

test("Luna: falhas viram erros claros sem conteúdo do currículo", async () => {
  const com = (fetcher: FetchLike) => new CurriculoService(configLuna, fetcher).analisar({ tipo: "texto", texto: "CPF 123 segredo" });
  assert.equal(await codigoDoErro(com(async () => respostaJson(401, {}))), "LUNA_CREDENCIAL");
  assert.equal(await codigoDoErro(com(async () => respostaJson(404, {}))), "LUNA_MODELO_INDISPONIVEL");
  assert.equal(await codigoDoErro(com(async () => respostaJson(429, {}))), "LUNA_LIMITE");
  assert.equal(await codigoDoErro(com(async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); })), "LUNA_TIMEOUT");
  assert.equal(await codigoDoErro(com(async () => { throw new Error("rede"); })), "LUNA_FALHOU");
  assert.equal(await codigoDoErro(com(async () => respostaJson(200, { output: [{ type: "message", content: [{ type: "output_text", text: "não é json" }] }] }))), "LUNA_FORMATO");
  assert.equal(await codigoDoErro(com(async () => respostaJson(200, { output: [{ type: "message", content: [{ type: "refusal", refusal: "não" }] }] }))), "LUNA_RECUSOU");
  assert.equal(await codigoDoErro(com(async () => respostaJson(200, { status: "incomplete", output: [] }))), "LUNA_SEM_RESPOSTA");
  try {
    await com(async () => respostaJson(500, { error: "CPF 123 segredo" }));
  } catch (error) {
    assert.doesNotMatch((error as Error).message, /segredo|123/);
  }
});

test("Luna: confere a disponibilidade do modelo", async () => {
  const service = new CurriculoService(configLuna, async (url) => respostaJson(String(url).endsWith("/models/gpt-6-luna") ? 404 : 200, {}));
  assert.equal((await service.verificarModelo()).disponivel, false);
  assert.equal((await new CurriculoService(configLuna, async () => respostaJson(200, {})).verificarModelo()).disponivel, true);
});

// ---------- JEV ----------

/** Formato da resposta do POST /v1/systemone segundo a OpenAPI oficial (answers por nome da pergunta). */
const LEGENDA = Object.fromEntries(PERGUNTA_COMPATIBILIDADE.scoreLevels.map((nivel, indice) => [String(indice), nivel]));
function respostaApi(score: number, probabilidades: number[], extra: Record<string, unknown> = {}) {
  return {
    model: "jev-1.14.0",
    answers: {
      compatibilidade_profissional: {
        type: "score", score, confidence: 0.7, legend: LEGENDA,
        probabilities: Object.fromEntries(probabilidades.map((p, indice) => [String(indice), p])), ...extra,
      },
    },
    usage: { input_tokens: 900, output_tokens: 12 },
  };
}
const RESPOSTA_JEV = respostaApi(2.32, [0.02, 0.12, 0.43, 0.33, 0.1]);

test("JEV: escala real 0–4 e leitura da resposta oficial", () => {
  assert.deepEqual(escalaDa(PERGUNTA_COMPATIBILIDADE), { min: 0, max: 4 });
  const avaliacao = interpretarRespostaJev(RESPOSTA_JEV);
  assert.equal(avaliacao.score, 2.32);
  assert.equal(avaliacao.confianca, 0.7);
  assert.equal(avaliacao.nivel, "Moderada");
  assert.equal(avaliacao.probabilidadeNivel, 0.43);
  assert.equal(avaliacao.descricaoNivel, "possui algumas experiências ou habilidades transferíveis relevantes.");
  assert.equal(avaliacao.modelo, "jev-1.14.0");
  assert.equal(avaliacao.legenda["4"], PERGUNTA_COMPATIBILIDADE.scoreLevels[4]);
  assert.equal(interpretarRespostaJev(respostaApi(1, [0, 1, 0, 0, 0], { legend: undefined })).legenda["1"], PERGUNTA_COMPATIBILIDADE.scoreLevels[1]);
  // A API não devolve motivo: nada é atribuído ao JEV.
  assert.equal(avaliacao.justificativa, null);
  assert.deepEqual(avaliacao.evidencias, []);
});

test("JEV: respostas inválidas são descartadas, não corrigidas", () => {
  assert.throws(() => interpretarRespostaJev(null));
  assert.throws(() => interpretarRespostaJev([]));
  assert.throws(() => interpretarRespostaJev({ answers: {} }), /não respondeu/);
  assert.throws(() => interpretarRespostaJev({ answers: { compatibilidade_profissional: { type: "choice", choice: "x" } } }), /outro tipo/);
  assert.throws(() => interpretarRespostaJev(respostaApi(Number.NaN, [1, 0, 0, 0, 0])), /score numérico/);
  assert.throws(() => interpretarRespostaJev(respostaApi(87, [1, 0, 0, 0, 0])), /fora da escala/);
  assert.throws(() => interpretarRespostaJev(respostaApi(-1, [1, 0, 0, 0, 0])));
  assert.throws(() => interpretarRespostaJev(respostaApi(2, [0, 0, 1, 0, 0], { confidence: 1.4 })));
  // Probabilidades malformadas não derrubam o score, mas o nível fica sem valor em vez de inventado.
  const semNivel = interpretarRespostaJev(respostaApi(3, [0.5, 0.5, 0.5, 0, 0]));
  assert.equal(semNivel.score, 3);
  assert.equal(semNivel.nivel, null);
});

test("JEV: corpo do POST segue a OpenAPI (questions por nome, criteria em ordem)", () => {
  const corpo = corpoSystemOne({ modelo: "jev-latest", estado: "CURRÍCULO…", perguntas: [PERGUNTA_COMPATIBILIDADE] });
  assert.deepEqual(Object.keys(corpo), ["model", "state", "questions"]);
  assert.equal(corpo.questions.compatibilidade_profissional.type, "score");
  assert.deepEqual(corpo.questions.compatibilidade_profissional.criteria, PERGUNTA_COMPATIBILIDADE.scoreLevels);
});

test("JEV: sem credenciais não fica pronto", () => {
  assert.deepEqual(criarTransporteJev({ JEV_API_URL: "", JEV_API_KEY: "" }), { pronto: false, motivo: "JEV não configurado: defina JEV_API_URL e JEV_API_KEY." });
  assert.equal(criarTransporteJev({ JEV_API_URL: "https://api.typesafe.ai", JEV_API_KEY: "" }).pronto, false);
});

function transporteCom(fetcher: (url: string, init?: RequestInit) => Promise<Response>, url = "https://api.typesafe.ai") {
  const estado = criarTransporteJev({ JEV_API_URL: url, JEV_API_KEY: "chave-teste" }, fetcher, [1, 1]);
  assert.equal(estado.pronto, true);
  return (estado as { transporte: (r: RequisicaoJev, s: AbortSignal) => Promise<unknown> }).transporte;
}
const REQ: RequisicaoJev = { modelo: "jev-latest", estado: "estado", perguntas: [PERGUNTA_COMPATIBILIDADE] };

test("JEV: chama POST /v1/systemone com Bearer e devolve a resposta", async () => {
  const chamadas: Array<{ url: string; init?: RequestInit }> = [];
  const transporte = transporteCom(async (url, init) => { chamadas.push({ url, init }); return respostaJson(200, RESPOSTA_JEV); }, "https://api.typesafe.ai/v1/");
  const bruto = await transporte(REQ, new AbortController().signal);
  assert.equal(interpretarRespostaJev(bruto).score, 2.32);
  assert.equal(chamadas[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(chamadas[0].init?.method, "POST");
  assert.equal((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer chave-teste");
  assert.equal(JSON.parse(String(chamadas[0].init?.body)).model, "jev-latest");
});

test("JEV: repete em 429/529 e para em erro definitivo, sem expor a chave", async () => {
  let n = 0;
  const comRetry = transporteCom(async () => (++n < 3 ? respostaJson(n === 1 ? 429 : 529, {}) : respostaJson(200, RESPOSTA_JEV)));
  assert.equal(interpretarRespostaJev(await comRetry(REQ, new AbortController().signal)).score, 2.32);
  assert.equal(n, 3);

  let m = 0;
  const sempre429 = transporteCom(async () => { m += 1; return respostaJson(429, {}); });
  await assert.rejects(sempre429(REQ, new AbortController().signal), (error: unknown) => error instanceof ErroJev && error.status === 429);
  assert.equal(m, 3);

  for (const [status, trecho] of [[401, /recusou a chave/], [422, /recusou a requisição/], [500, /erro \(500\)/]] as const) {
    let chamadas = 0;
    const transporte = transporteCom(async () => { chamadas += 1; return respostaJson(status, { detail: "x" }); });
    await assert.rejects(transporte(REQ, new AbortController().signal), (error: unknown) => error instanceof ErroJev && trecho.test(error.message) && !error.message.includes("chave-teste"));
    assert.equal(chamadas, 1);
  }
  const rede = transporteCom(async () => { throw new Error("ECONNRESET"); });
  await assert.rejects(rede(REQ, new AbortController().signal), /Não foi possível falar com o JEV/);
});

const VAGA_JEV = {
  cargo: "Suporte Comercial",
  atividades: "- Atendimento e suporte comercial via WhatsApp.\n- Ativação das filas de leads.",
  descricao: "Presencial de segunda a sexta-feira.",
  requisitos: "- Boa comunicação verbal e escrita.\n- Experiência com vendas ou atendimento será um diferencial.",
  escolaridade: null,
  cargaHoraria: "44",
  horario: "Segunda a sexta, 09:00 às 18:00",
  tipo: "CLT",
};

test("JEV: estado no layout do workflow com descrição e requisitos", () => {
  const estado = montarEstadoJev("Resumo profissional: Atendente", VAGA_JEV);
  assert.match(estado, /^CURRÍCULO DO CANDIDATO:\nResumo profissional: Atendente\n\nVAGA:\nCargo: Suporte Comercial\nAtividades: /);
  assert.match(estado, /Requisitos: - Boa comunicação/);
  assert.match(estado, /Carga horária: 44\nHorário: Segunda a sexta/);
  assert.match(montarEstadoJev("", VAGA_JEV), /Currículo não informado/);
});

test("explicação: identifica a origem e separa trechos com e sem termos no currículo", () => {
  const explicacao = explicarCompatibilidade("Atendente de loja, vendas e atendimento pelo WhatsApp", VAGA_JEV);
  assert.equal(explicacao.origem, ORIGEM_EXPLICACAO);
  assert.match(explicacao.aviso, /Não é o motivo do score do JEV/);
  assert.ok(explicacao.favoraveis.some((item) => item.trecho.startsWith("Atendimento e suporte comercial") && item.termos.includes("whatsapp")));
  assert.ok(explicacao.naoComprovados.includes("Ativação das filas de leads"));
});

// ---------- matching ----------

type Linha = Record<string, unknown>;

function poolFalso(vagas: Linha[], opcoes: { semColunasNovas?: boolean } = {}) {
  const consultas: string[] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      consultas.push(sql);
      if (sql.includes("dna_work.flex")) return { rows: [{ id: "31", valor: "Ensino médio" }] };
      if (sql.includes("public.cargo") && opcoes.semColunasNovas) throw Object.assign(new Error("coluna"), { code: "42703" });
      const ids = (params[0] as string[]) ?? [];
      return { rows: vagas.filter((vaga) => ids.includes(String(vaga.id))) };
    },
  };
  return { pool: pool as unknown as Pool, consultas };
}

function vaga(id: string, extra: Linha = {}): Linha {
  return {
    id, cargo: "Suporte Comercial", atividades: VAGA_JEV.atividades, descricao: VAGA_JEV.descricao, requisitos: VAGA_JEV.requisitos,
    escolaridade: null, carga_horaria: "44", horario: null, tipo_vaga: 2, cargo_descricao: null, cargo_requisitos: null, ...extra,
  };
}

const PERFIL = { escolaridade: "medio_completo" as const, habilidades: "WhatsApp, vendas", curriculo: "Experiência profissional:\n- Atendente — Loja A — 2 anos: atendimento e vendas pelo WhatsApp em loja de varejo." };
const configMatching = { JEV_MODEL: "jev-latest", JEV_TIMEOUT_MS: 200, JEV_CONCORRENCIA: 2 } as Pick<AppConfig, "JEV_MODEL" | "JEV_TIMEOUT_MS" | "JEV_CONCORRENCIA">;

test("matching: sem JEV configurado nenhuma vaga é descartada e nenhum score é inventado", async () => {
  const { pool } = poolFalso([vaga("a"), vaga("b")]);
  const service = new TriagemMatchingService(pool, configMatching, criarTransporteJev({ JEV_API_URL: "", JEV_API_KEY: "" }));
  const resultado = await service.avaliar({ perfil: PERFIL, vagaIds: ["a", "b"] });
  assert.deepEqual(resultado.avaliacoes.map((item) => [item.id, item.status, item.jev]), [["a", "indisponivel", null], ["b", "indisponivel", null]]);
  assert.ok(resultado.avaliacoes.every((item) => item.explicacao?.origem === ORIGEM_EXPLICACAO));
  assert.equal(resultado.jev.pronto, false);
  assert.deepEqual(resultado.jev.escala, { min: 0, max: 4 });
});

test("matching: respostas válidas, inválidas, falhas, timeout, vaga sumida e duplicadas", async () => {
  const { pool } = poolFalso(["ok", "invalida", "erro", "lenta"].map((id) => vaga(id, { cargo: `Cargo ${id}` })).concat(vaga("vazia", { atividades: null, descricao: null, requisitos: null })));
  const pedidos: RequisicaoJev[] = [];
  let simultaneas = 0;
  let pico = 0;
  const service = new TriagemMatchingService(pool, configMatching, {
    pronto: true,
    // Dublê de teste: devolve o formato confirmado. Não existe nada parecido fora dos testes.
    transporte: async (requisicao) => {
      pedidos.push(requisicao);
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      try {
        await new Promise((resolver) => setTimeout(resolver, 10));
        if (requisicao.estado.includes("Cargo: Cargo ok")) return RESPOSTA_JEV;
        if (requisicao.estado.includes("Cargo: Cargo invalida")) return respostaApi(99, [1, 0, 0, 0, 0]);
        if (requisicao.estado.includes("Cargo: Cargo erro")) throw new ErroJev("Limite de uso do JEV atingido. Tente em instantes.", 429, true);
        await new Promise((resolver) => setTimeout(resolver, 1_000));
        return RESPOSTA_JEV;
      } finally {
        simultaneas -= 1;
      }
    },
  });
  const resultado = await service.avaliar({ perfil: PERFIL, vagaIds: ["ok", "invalida", "ok", "erro", "lenta", "sumiu", "vazia"] });
  assert.deepEqual(resultado.avaliacoes.map((item) => [item.id, item.status]), [
    ["ok", "avaliada"], ["invalida", "resposta_invalida"], ["erro", "falhou"], ["lenta", "falhou"], ["sumiu", "nao_encontrada"], ["vazia", "dados_insuficientes"],
  ]);
  assert.equal(resultado.avaliacoes[0].jev?.score, 2.32);
  assert.equal(resultado.avaliacoes[2].motivo, "Limite de uso do JEV atingido. Tente em instantes.");
  assert.equal(resultado.avaliacoes[3].motivo, "O JEV não respondeu a tempo.");
  assert.equal(pedidos.length, 4, "duplicada, sumida e vaga sem dados não chamam o JEV");
  assert.ok(pico <= 2, `concorrência passou do limite: ${pico}`);
  assert.equal(pedidos[0].modelo, "jev-latest");
  assert.equal(pedidos[0].perguntas[0].id, "compatibilidade_profissional");
});

test("matching: currículo insuficiente não chama o JEV; idade e sexo nunca entram no estado", async () => {
  const { pool } = poolFalso([vaga("a", { escolaridade: "31" })]);
  const pedidos: RequisicaoJev[] = [];
  const service = new TriagemMatchingService(pool, configMatching, { pronto: true, transporte: async (requisicao) => { pedidos.push(requisicao); return RESPOSTA_JEV; } });
  const pouco = await service.avaliar({ perfil: { escolaridade: "medio_completo", tempoExperiencia: "1 ano" }, vagaIds: ["a"] });
  assert.equal(pouco.avaliacoes[0].status, "dados_insuficientes");
  assert.equal(pedidos.length, 0);
  const perfilComExtras = { ...PERFIL, idade: "30", sexo: "F", nome: "Maria" } as unknown as typeof PERFIL;
  await service.avaliar({ perfil: perfilComExtras, vagaIds: ["a"] });
  assert.doesNotMatch(pedidos[0].estado, /Maria|\bidade\b|\bsexo\b|\b30\b/i);
  assert.match(pedidos[0].estado, /Escolaridade exigida: Ensino médio/);
});

test("matching: banco sem descricao/requisitos usa a consulta básica", async () => {
  const { pool, consultas } = poolFalso([vaga("a")], { semColunasNovas: true });
  const service = new TriagemMatchingService(pool, configMatching, criarTransporteJev({ JEV_API_URL: "", JEV_API_KEY: "" }));
  const resultado = await service.avaliar({ perfil: PERFIL, vagaIds: ["a"] });
  assert.equal(resultado.avaliacoes[0].status, "indisponivel");
  assert.equal(consultas.filter((sql) => sql.includes("public.vaga")).length, 2);
});

test("mapComLimite preserva a ordem e respeita o limite", async () => {
  let ativas = 0;
  let pico = 0;
  const saida = await mapComLimite([5, 1, 3, 2], 2, async (valor) => {
    ativas += 1;
    pico = Math.max(pico, ativas);
    await new Promise((resolver) => setTimeout(resolver, valor));
    ativas -= 1;
    return valor * 10;
  });
  assert.deepEqual(saida, [50, 10, 30, 20]);
  assert.equal(pico, 2);
  assert.deepEqual(await mapComLimite([], 3, async (valor) => valor), []);
});

// ---------- busca rápida: sem regressão ----------

test("busca rápida: mesmo contrato, filtros, agrupamento por vaga_id e sem limite de quatro vagas", async (t) => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("sem rede no teste"); }) as typeof fetch;
  t.after(() => { globalThis.fetch = fetchOriginal; });
  const origem = { lat: -23.55, lng: -46.63 };
  const base = { tipo_vaga: 2, cargo: "Atendente", salario: "2000", beneficios: "VR", sexo: "I", idade: null, idade_ate: null, horario: null, tipo_trabalho: null, nome_fantasia: "Loja", local: "Centro - São Paulo / SP" };
  const linhas = [
    ...Array.from({ length: 6 }, (_, indice) => ({ ...base, id: `v${indice}`, vaga_id: `g${indice}`, latitude: origem.lat + indice * 0.005, longitude: origem.lng })),
    { ...base, id: "dup", vaga_id: "g0", latitude: origem.lat + 0.02, longitude: origem.lng },
    { ...base, id: "longe", vaga_id: "gl", latitude: origem.lat + 1, longitude: origem.lng },
    { ...base, id: "so-mulher", vaga_id: "gm", sexo: "F", latitude: origem.lat, longitude: origem.lng },
    { ...base, id: "idade", vaga_id: "gi", idade: 30, latitude: origem.lat, longitude: origem.lng },
  ];
  const pool = { query: async () => ({ rows: linhas }) } as unknown as Pool;
  const service = new TriagemService(pool, null, { GOOGLE_MAPS_API_KEY: "" } as AppConfig);
  const resultado = await service.buscar({ cep: "01001000", raioKm: 10, tipos: ["CLT"], sexo: "M", idade: 20, ...origem });
  assert.equal(resultado.originLabel, "CEP 01001-000");
  assert.deepEqual(resultado.jobs.map((job) => job.id), ["v0", "v1", "v2", "v3", "v4", "v5"]);
  assert.deepEqual(Object.keys(resultado.jobs[0]).sort(), ["company", "contractType", "distanceKm", "hasBenefits", "homeOffice", "id", "location", "prioridade", "salaryLabel", "schedule", "schedules", "title"]);
  assert.equal(resultado.jobs[0].prioridade, "media");
  assert.equal(resultado.jobs[0].location, "Centro, São Paulo SP");
});

// ---------- CEP a partir do currículo ----------


const ENDERECO = { cep: null, logradouro: "Rua Augusta, 1500 - apto 3", bairro: "Consolação", cidade: "São Paulo", uf: "SP" };

test("CEP: usa o CEP escrito no currículo sem consultar nada", async () => {
  let consultas = 0;
  const resultado = await cepDoCurriculo({ ...ENDERECO, cep: "01304001" }, async () => { consultas += 1; return respostaJson(200, []); });
  assert.deepEqual(resultado, { cep: "01304001", origem: "curriculo", endereco: "Rua Augusta, 1500 - apto 3, Consolação, São Paulo/SP", motivo: null });
  assert.equal(consultas, 0);
});

test("CEP: pelo endereço só preenche quando sobra um CEP", async () => {
  let url = "";
  const unico = await cepDoCurriculo(ENDERECO, async (u) => {
    url = u;
    return respostaJson(200, [{ cep: "01305-100", bairro: "Consolação" }, { cep: "01412-000", bairro: "Cerqueira César" }]);
  });
  assert.equal(url, "https://viacep.com.br/ws/SP/S%C3%A3o%20Paulo/Rua%20Augusta/json/");
  assert.equal(unico.cep, "01305100");
  assert.equal(unico.origem, "endereco");

  const varios = await cepDoCurriculo({ ...ENDERECO, bairro: null }, async () => respostaJson(200, [{ cep: "01305-100" }, { cep: "01412-000" }]));
  assert.equal(varios.cep, null);
  assert.match(varios.motivo ?? "", /2 CEPs possíveis/);

  const nenhum = await cepDoCurriculo(ENDERECO, async () => respostaJson(200, []));
  assert.equal(nenhum.cep, null);
  const falha = await cepDoCurriculo(ENDERECO, async () => { throw new Error("rede"); });
  assert.match(falha.motivo ?? "", /Não foi possível consultar/);
  const incompleto = await cepDoCurriculo({ cep: null, logradouro: null, bairro: "Centro", cidade: "Osasco", uf: "SP" }, async () => respostaJson(200, []));
  assert.equal(incompleto.cep, null);
  assert.equal(await cepDoCurriculo(null).then((item) => item.cep), null);
});

test("CEP: endereço é normalizado e nunca entra no texto do JEV", async () => {
  const extraido = normalizarCurriculo({ ...LUNA_OK, endereco: { cep: "01304-001", logradouro: "Rua Augusta", bairro: null, cidade: "São Paulo", uf: "sp" } }, REFERENCIA);
  assert.deepEqual(extraido.endereco, { cep: "01304001", logradouro: "Rua Augusta", bairro: null, cidade: "São Paulo", uf: "SP" });
  assert.equal(normalizarCurriculo({ ...LUNA_OK, endereco: { cep: "123", logradouro: null, bairro: null, cidade: null, uf: null } }, REFERENCIA).endereco, null);
  const texto = textoDoCurriculo(perfilParaEdicao(extraido));
  assert.doesNotMatch(texto, /Augusta|01304/);
  const service = new CurriculoService(configLuna, async () => respostaLuna({ ...LUNA_OK, endereco: { cep: "01304-001", logradouro: null, bairro: null, cidade: null, uf: null } }), () => REFERENCIA);
  assert.equal((await service.analisar({ tipo: "texto", texto: "currículo" })).localizacao.cep, "01304001");
});
