import assert from "node:assert/strict";
import test from "node:test";
import { iniciarAgendaRegua, msAteProximaExecucao } from "../src/lib/regua-agenda.js";
import { dispararRegua } from "../src/lib/regua-execucao.js";
import {
  agruparRegua,
  consolidarEnvios,
  decidirEtapa,
  htmlDaEtapa,
  encerrarEnvios,
  etapasNoVencimento,
  planejarRegua,
  proximoDiaUtil,
  suspenderEnvios,
  type FaturaAgrupada,
} from "../src/lib/regua.js";

function fatura(parcial: Partial<FaturaAgrupada> & Pick<FaturaAgrupada, "id_cobranca" | "id_empresa" | "valor" | "status_pagamento">): FaturaAgrupada {
  return {
    id: parcial.id ?? parcial.id_cobranca,
    id_cobranca: parcial.id_cobranca,
    asaas_payment_id: parcial.asaas_payment_id ?? null,
    id_empresa: parcial.id_empresa,
    empresa: parcial.empresa ?? parcial.id_empresa,
    cnpj: parcial.cnpj ?? null,
    email_cobranca: parcial.email_cobranca ?? "financeiro@example.com",
    contato: null,
    competencia: "2026-11-01",
    vencimento: parcial.vencimento ?? "2026-11-12",
    valor: parcial.valor,
    link_cobranca: null,
    link_central: "https://sistema.dnawork.ai/Empresa/index.php",
    status_pagamento: parcial.status_pagamento,
    comprovante: false,
    data_baixa: null,
    proximo_passo: parcial.proximo_passo ?? "1ª cobrança",
    persistida: false,
    envios: parcial.envios ?? [],
    matriz_id: parcial.matriz_id ?? parcial.id_empresa,
    matriz_nome: parcial.matriz_nome ?? parcial.empresa ?? parcial.id_empresa,
    matriz_cnpj: parcial.matriz_cnpj ?? null,
    email_destino: parcial.email_destino ?? parcial.email_cobranca ?? "financeiro@example.com",
  };
}

test("agrupa filiais na matriz e não soma a mesma cobrança duas vezes", () => {
  const grupos = agruparRegua([
    fatura({ id_cobranca: "c1", asaas_payment_id: "pay_1", id_empresa: "filial-a", empresa: "Unidade A", matriz_id: "matriz", matriz_nome: "Grupo Real", valor: 100, status_pagamento: "em_aberto" }),
    fatura({ id_cobranca: "c2", asaas_payment_id: "pay_1", id_empresa: "filial-a", empresa: "Unidade A", matriz_id: "matriz", matriz_nome: "Grupo Real", valor: 100, status_pagamento: "em_aberto" }),
    fatura({ id_cobranca: "c3", asaas_payment_id: "pay_2", id_empresa: "filial-b", empresa: "Unidade B", matriz_id: "matriz", matriz_nome: "Grupo Real", valor: 50, status_pagamento: "em_aberto" }),
    fatura({ id_cobranca: "c4", asaas_payment_id: "pay_3", id_empresa: "outra", empresa: "Outra", matriz_id: "outra", matriz_nome: "Outra", valor: 80, status_pagamento: "pago" }),
  ]);
  assert.equal(grupos.length, 2);
  const grupo = grupos.find((item) => item.id === "matriz");
  assert.ok(grupo);
  assert.equal(grupo.unidades.length, 2);
  assert.equal(grupo.unidades[0].faturas.length + grupo.unidades[1].faturas.length, 3);
  assert.equal(grupo.total_devido, 150);
  assert.equal(grupo.pendencias, 2);
  assert.equal(grupo.status, "em_aberto");
});

test("o marco de vencimento usa a data real e o dia útil seguinte em feriado", () => {
  assert.equal(proximoDiaUtil(2026, 11, 1), "2026-11-03");
  const etapas = etapasNoVencimento("2026-11-12");
  assert.equal(etapas.find((etapa) => etapa.etapa === "vencimento")?.data, "2026-11-12");
  assert.equal(etapas.find((etapa) => etapa.etapa === "cobranca_2")?.data, "2026-11-16");
  const cobranca = etapas.find((etapa) => etapa.etapa === "cobranca_1");
  assert.ok(cobranca);
  assert.equal(decidirEtapa({ etapa: cobranca, hoje: "2026-11-11", statusPagamento: "em_aberto", vencimento: "2026-11-12" }), "aguardar");
  assert.equal(decidirEtapa({ etapa: cobranca, hoje: "2026-11-13", statusPagamento: "em_aberto", vencimento: "2026-11-12" }), "enviar");
  assert.equal(decidirEtapa({ etapa: cobranca, hoje: "2026-11-14", statusPagamento: "em_aberto", vencimento: "2026-11-12" }), "pular");
  const relatorio = etapas.find((etapa) => etapa.etapa === "relatorio");
  assert.ok(relatorio);
  assert.equal(decidirEtapa({ etapa: relatorio, hoje: "2026-11-09", statusPagamento: "em_aberto", vencimento: "2026-11-10" }), "pular");
  assert.equal(decidirEtapa({ etapa: cobranca, hoje: "2026-11-13", statusPagamento: "pago", vencimento: "2026-11-12" }), "pular");
  assert.equal(decidirEtapa({ etapa: cobranca, hoje: "2026-11-13", statusPagamento: "suspenso", vencimento: "2026-11-12" }), "pular");
});

test("pagamento encerra etapas e comprovante só suspende", () => {
  const envios = [{ status: "a_enviar" }, { status: "enviado" }, { status: "falha" }];
  assert.deepEqual(encerrarEnvios(envios).map((envio) => envio.status), ["resolvido", "enviado", "resolvido"]);
  assert.deepEqual(suspenderEnvios(envios).map((envio) => envio.status), ["suspenso", "enviado", "suspenso"]);
});

test("a simulação do dia não dispara e-mail e a segunda execução não repete", async () => {
  const item = {
    id_cobranca: "c1",
    asaas_payment_id: "pay_1",
    id_empresa: "filial-a",
    empresa: "Unidade A",
    email: "financeiro@example.com",
    valor: 100,
    vencimento: "2026-11-10",
    status_pagamento: "em_aberto",
    envios: etapasNoVencimento("2026-11-10").map((etapa) => ({
      id: etapa.etapa,
      etapa: etapa.etapa,
      status: "a_enviar",
      data_prevista: etapa.data,
    })),
  };
  const planejadas = planejarRegua("2026-11-11", [item]);
  assert.ok(planejadas.some((acao) => acao.etapa === "cobranca_1" && acao.tipo === "enviar"));
  assert.equal(planejadas.filter((acao) => acao.etapa === "cobranca_1").length, 1);

  const enviados: string[] = [];
  const estado = new Map(item.envios.map((envio) => [envio.etapa, envio.status]));
  const deps = {
    reservar: async (chave: string) => {
      const etapa = chave.split(":")[1];
      if (estado.get(etapa) !== "a_enviar" && estado.get(etapa) !== "falha") return false;
      estado.set(etapa, "enviando");
      return true;
    },
    enviar: async (acao: { etapa: string }) => { enviados.push(acao.etapa); },
    concluir: async (acao: { etapa: string }, status: string) => { estado.set(acao.etapa, status === "marco" ? "marco" : status); },
  };
  const primeira = await dispararRegua(planejadas, deps);
  const segunda = await dispararRegua(planejadas, deps);
  assert.equal(enviados.filter((etapa) => etapa === "cobranca_1").length, 1);
  assert.equal(primeira.duplicados, 0);
  assert.ok(segunda.duplicados >= 1);
  assert.equal(estado.get("cobranca_1"), "enviado");
});

test("falha fica disponível para nova tentativa e reserva concorrente só passa uma", async () => {
  const acao = {
    chave: "pay_1:aviso",
    id_cobranca: "c1",
    id_empresa: "e1",
    empresa: "Empresa",
    email: "financeiro@example.com",
    etapa: "aviso",
    label: "Aviso de faturamento",
    tipo: "enviar" as const,
    vencimento: "2026-11-10",
    valor: 10,
  };
  let livres = 1;
  const reservar = async () => {
    if (livres === 0) return false;
    livres -= 1;
    return true;
  };
  const [uma, outra] = await Promise.all([
    dispararRegua([acao], { reservar, enviar: async () => { throw new Error("Mailjet indisponível"); }, concluir: async () => {} }),
    dispararRegua([acao], { reservar, enviar: async () => {}, concluir: async () => {} }),
  ]);
  assert.equal(uma.falhas + outra.falhas, 1);
  assert.equal(uma.duplicados + outra.duplicados, 1);
  assert.equal(uma.enviados + outra.enviados, 0);
  const base = {
    id_cobranca: "c1",
    asaas_payment_id: "pay_1",
    id_empresa: "e1",
    empresa: "Empresa",
    email: "financeiro@example.com",
    valor: 10,
    vencimento: "2026-11-10",
    status_pagamento: "em_aberto",
    matriz_id: "e1",
    consolida: false,
    envios: [{ id: "1", etapa: "aviso", status: "falha", data_prevista: "2026-11-05" }],
  };
  const novaTentativa = planejarRegua("2026-11-05", [base]);
  assert.equal(novaTentativa.length, 1);
  assert.equal(novaTentativa[0].etapa, "aviso");
  assert.equal(planejarRegua("2026-11-06", [base]).length, 0);
});

test("matriz com o mesmo financeiro gera um e-mail por etapa e reserva cada fatura", async () => {
  const envio = etapasNoVencimento("2026-11-10").find((etapa) => etapa.etapa === "lembrete");
  assert.ok(envio);
  const itens = ["Unidade A", "Unidade B"].map((empresa, index) => ({
    id_cobranca: `c${index}`,
    asaas_payment_id: `pay_${index}`,
    id_empresa: empresa,
    empresa,
    email: "financeiro@grupo.example",
    valor: 100,
    vencimento: "2026-11-10",
    status_pagamento: "em_aberto",
    matriz_id: "matriz",
    matriz_nome: "Grupo Real",
    link: `https://www.asaas.com/i/${empresa}`,
    consolida: true,
    envios: [{ id: empresa, etapa: "lembrete", status: "a_enviar", data_prevista: envio.data }],
  }));
  const acoes = consolidarEnvios(planejarRegua("2026-11-09", itens));
  assert.equal(acoes.length, 1);
  assert.equal(acoes[0].faturas.length, 2);
  assert.equal(acoes[0].empresa, "Grupo Real");
  const mensagem = htmlDaEtapa(acoes[0]);
  assert.equal(mensagem.subject, "Lembrete de vencimento — Grupo Real");
  assert.match(mensagem.html, /Olá, Grupo Real/);
  assert.match(mensagem.html, /https:\/\/www\.asaas\.com\/i\/Unidade A/);
  assert.match(mensagem.html, /https:\/\/www\.asaas\.com\/i\/Unidade B/);
  assert.equal(mensagem.html.includes("Unidade A, Unidade B"), false);
  const reservadas: string[] = [];
  const enviados: number[] = [];
  const historico: string[] = [];
  await dispararRegua(acoes, {
    reservar: async (chave) => { reservadas.push(chave); return true; },
    enviar: async (acao) => { enviados.push(acao.faturas.length); },
    concluir: async (acao) => { historico.push(acao.id_cobranca); },
  });
  assert.deepEqual(enviados, [2]);
  assert.equal(reservadas.length, 2);
  assert.deepEqual(historico, ["c0", "c1"]);
  const outraMatriz = consolidarEnvios(planejarRegua("2026-11-09", [
    itens[0],
    { ...itens[1], id_cobranca: "c9", asaas_payment_id: "pay_9", matriz_id: "outra", matriz_nome: "Outra Matriz", empresa: "Unidade C" },
  ]));
  assert.equal(outraMatriz.length, 2);
  const primeira = planejarRegua("2026-11-09", itens);
  const segunda = planejarRegua("2026-11-09", itens);
  assert.equal(primeira.length, segunda.length);
  assert.equal(itens[0].envios[0].status, "a_enviar");
  const soLumi = [{ idEmpresa: "lumi", bloqueado: true, motivo: "teste" }];
  const comBloqueio = consolidarEnvios(planejarRegua("2026-11-09", [
    itens[0],
    { ...itens[1], matriz_id: "lumi", matriz_nome: "Lumi Cosmeticos", email: "rh03@perfumarialumi.com.br" },
    { ...itens[0], id_cobranca: "c8", asaas_payment_id: "pay_8", matriz_id: "haba", matriz_nome: "HABA COMERCIAL E APOIO ADMINISTRATIVO LTDA", email: "rh03@perfumarialumi.com.br", empresa: "HABA" },
  ], { bloqueios: soLumi }));
  assert.equal(comBloqueio.some((acao) => acao.matriz_nome === "Lumi Cosmeticos"), false);
  assert.equal(comBloqueio.some((acao) => acao.matriz_nome === "HABA COMERCIAL E APOIO ADMINISTRATIVO LTDA"), true);
  assert.equal(comBloqueio.some((acao) => acao.empresa === "Grupo Real"), true);
});

test("a data de início não dispara o lembrete de 9/11 e mantém a cobrança de 11/11", () => {
  const vencimento = "2026-11-10";
  const etapas = etapasNoVencimento(vencimento);
  const item = {
    id_cobranca: "c1",
    asaas_payment_id: "pay_1",
    id_empresa: "e1",
    empresa: "Unidade",
    email: "financeiro@grupo.example",
    valor: 10,
    vencimento,
    status_pagamento: "em_aberto",
    matriz_id: "matriz",
    matriz_nome: "Grupo Real",
    consolida: true,
    envios: etapas.map((etapa) => ({ id: etapa.etapa, etapa: etapa.etapa, status: etapa.marco ? "marco" : "a_enviar", data_prevista: etapa.data })),
  };
  const inicio = { inicio: "2026-11-10" };
  assert.equal(planejarRegua("2026-11-09", [item], inicio).some((acao) => acao.tipo === "enviar"), false);
  assert.equal(planejarRegua("2026-11-10", [item], inicio).every((acao) => acao.tipo !== "enviar"), true);
  assert.equal(planejarRegua("2026-11-11", [item], inicio).some((acao) => acao.etapa === "cobranca_1"), true);
  assert.equal(planejarRegua("2026-11-11", [{ ...item, status_pagamento: "pago" }], inicio).length, 0);
});

test("a agenda diária não arma o relógio sem as duas chaves", () => {
  const parado = iniciarAgendaRegua({ ativo: false, envioReal: false, executar: async () => {} });
  assert.equal(parado.ativo, false);
  const semEnvio = iniciarAgendaRegua({ ativo: true, envioReal: false, executar: async () => {} });
  assert.equal(semEnvio.ativo, false);
  const antes = new Date("2026-11-10T10:30:00.000Z");
  assert.ok(msAteProximaExecucao(antes) > 0);
  assert.ok(msAteProximaExecucao(antes) < 3 * 60 * 60 * 1000);
});
