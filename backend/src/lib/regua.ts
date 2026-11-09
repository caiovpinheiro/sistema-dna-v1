import { estaBloqueado, type BloqueioRegua } from "./regua-bloqueio.js";

const FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25"];

export type EtapaRegua = {
  etapa: string;
  ordem: number;
  dia: number | null;
  primeiroUtil?: boolean;
  marco?: boolean;
  label: string;
  pendentes: boolean;
};

export const ETAPAS: EtapaRegua[] = [
  { etapa: "relatorio", ordem: 1, dia: null, primeiroUtil: true, label: "Relatório dos candidatos ativos", pendentes: false },
  { etapa: "aviso", ordem: 2, dia: 5, label: "Aviso de faturamento", pendentes: false },
  { etapa: "lembrete", ordem: 3, dia: 9, label: "Lembrete de vencimento", pendentes: false },
  { etapa: "vencimento", ordem: 4, dia: 10, marco: true, label: "Vencimento", pendentes: false },
  { etapa: "cobranca_1", ordem: 5, dia: 11, label: "1ª cobrança", pendentes: true },
  { etapa: "cobranca_2", ordem: 6, dia: 15, label: "2ª cobrança", pendentes: true },
  { etapa: "cobranca_3", ordem: 7, dia: 20, label: "3ª cobrança", pendentes: true },
  { etapa: "cobranca_4", ordem: 8, dia: 25, label: "4ª cobrança", pendentes: true },
  { etapa: "encaminhar", ordem: 9, dia: 26, label: "Encaminhar à tratativa", pendentes: true },
];

export const LINK_CENTRAL = "https://sistema.dnawork.ai/Empresa/index.php";

export function competenciaDe(valor: string): { ano: number; mes: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!match) throw new Error("COMPETENCIA");
  const ano = Number(match[1]);
  const mes = Number(match[2]);
  if (mes < 1 || mes > 12) throw new Error("COMPETENCIA");
  return { ano, mes };
}

export function dataIso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function pascoa(ano: number): { mes: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

export function feriadoNacional(ano: number, mes: number, dia: number): boolean {
  const chave = `${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (FIXOS.includes(chave)) return true;
  const pas = pascoa(ano);
  const sexta = new Date(ano, pas.mes - 1, pas.dia);
  sexta.setDate(sexta.getDate() - 2);
  return sexta.getFullYear() === ano && sexta.getMonth() + 1 === mes && sexta.getDate() === dia;
}

export function proximoDiaUtil(ano: number, mes: number, dia: number): string {
  const data = new Date(ano, mes - 1, dia);
  while (data.getDay() === 0 || data.getDay() === 6 || feriadoNacional(data.getFullYear(), data.getMonth() + 1, data.getDate())) {
    data.setDate(data.getDate() + 1);
  }
  return dataIso(data.getFullYear(), data.getMonth() + 1, data.getDate());
}

export function datasDaRegua(ano: number, mes: number): Array<EtapaRegua & { data: string }> {
  return ETAPAS.map((etapa) => {
    if (etapa.primeiroUtil) return { ...etapa, data: proximoDiaUtil(ano, mes, 1) };
    const dia = etapa.dia ?? 1;
    const data = etapa.marco ? dataIso(ano, mes, dia) : proximoDiaUtil(ano, mes, dia);
    return { ...etapa, data };
  });
}

export type EtapaDatada = EtapaRegua & { data: string };

export function etapasNoVencimento(vencimento: string): EtapaDatada[] {
  const [ano, mes, dia] = vencimento.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) throw new Error("VENCIMENTO");
  return datasDaRegua(ano, mes).map((etapa) => etapa.etapa === "vencimento" ? { ...etapa, data: dataIso(ano, mes, dia) } : etapa);
}

export type DecisaoEtapa = "aguardar" | "pular" | "enviar" | "marco" | "encaminhar";

function diaSeguinte(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  const data = new Date(ano, mes - 1, dia + 1);
  return dataIso(data.getFullYear(), data.getMonth() + 1, data.getDate());
}

export function dataEfetiva(etapa: EtapaDatada, vencimento: string) {
  if (etapa.pendentes && etapa.data <= vencimento) return diaSeguinte(vencimento);
  return etapa.data;
}

export const INICIO_REGUA = "2026-11-10";

export function decidirEtapa(input: { etapa: EtapaDatada; hoje: string; statusPagamento: string; vencimento: string; inicio?: string }): DecisaoEtapa {
  if (input.statusPagamento === "pago" || input.statusPagamento === "suspenso" || input.statusPagamento === "encaminhado" || input.statusPagamento === "cancelada") return "pular";
  const efetiva = dataEfetiva(input.etapa, input.vencimento);
  if (input.inicio && efetiva < input.inicio) return "pular";
  if (input.hoje < efetiva) return "aguardar";
  if (input.hoje > efetiva) return "pular";
  if (input.etapa.marco) return "marco";
  if (input.etapa.etapa === "encaminhar") return "encaminhar";
  return "enviar";
}

export type EnvioRegua = {
  id: string;
  etapa: string;
  ordem: number;
  label: string;
  data_prevista: string;
  status: string;
  enviado_em: string | null;
  responsavel: string | null;
  pendentes: boolean;
  marco: boolean;
};

export type FaturaAgrupada = {
  id: string;
  id_cobranca: string;
  asaas_payment_id: string | null;
  id_empresa: string;
  empresa: string;
  cnpj: string | null;
  email_cobranca: string | null;
  contato: string | null;
  competencia: string;
  vencimento: string;
  valor: number;
  link_cobranca: string | null;
  link_central: string;
  status_pagamento: string;
  comprovante: boolean;
  data_baixa: string | null;
  proximo_passo: string | null;
  persistida: boolean;
  envios: EnvioRegua[];
  matriz_id: string;
  matriz_nome: string;
  matriz_cnpj: string | null;
  email_destino: string | null;
};

export type UnidadeRegua = {
  id_empresa: string;
  empresa: string;
  cnpj: string | null;
  faturas: FaturaAgrupada[];
};

export type GrupoRegua = {
  id: string;
  empresa: string;
  cnpj: string | null;
  total_devido: number;
  pendencias: number;
  status: string;
  proxima_acao: string | null;
  unidades: UnidadeRegua[];
};

function chaveCobranca(fatura: FaturaAgrupada) {
  return fatura.asaas_payment_id || fatura.id_cobranca;
}

export function agruparRegua(faturas: FaturaAgrupada[]): GrupoRegua[] {
  const grupos = new Map<string, GrupoRegua>();
  for (const fatura of faturas) {
    const atual = grupos.get(fatura.matriz_id) ?? {
      id: fatura.matriz_id,
      empresa: fatura.matriz_nome,
      cnpj: fatura.matriz_cnpj,
      total_devido: 0,
      pendencias: 0,
      status: "pago",
      proxima_acao: null,
      unidades: [],
    };
    let unidade = atual.unidades.find((item) => item.id_empresa === fatura.id_empresa);
    if (!unidade) {
      unidade = { id_empresa: fatura.id_empresa, empresa: fatura.empresa, cnpj: fatura.cnpj, faturas: [] };
      atual.unidades.push(unidade);
    }
    unidade.faturas.push(fatura);
    grupos.set(fatura.matriz_id, atual);
  }
  for (const grupo of grupos.values()) {
    const vistas = new Set<string>();
    let aberto = false;
    let suspenso = false;
    let encaminhado = false;
    for (const unidade of grupo.unidades) {
      for (const fatura of unidade.faturas) {
        const chave = chaveCobranca(fatura);
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        if (fatura.status_pagamento === "em_aberto") {
          aberto = true;
          grupo.total_devido = round2(grupo.total_devido + fatura.valor);
          grupo.pendencias += 1;
          grupo.proxima_acao ??= fatura.proximo_passo;
        } else if (fatura.status_pagamento === "suspenso") suspenso = true;
        else if (fatura.status_pagamento === "encaminhado") encaminhado = true;
      }
    }
    grupo.status = aberto ? "em_aberto" : suspenso ? "suspenso" : encaminhado ? "encaminhado" : "pago";
    if (grupo.status === "suspenso") grupo.proxima_acao = "Validar comprovante";
    if (grupo.status === "pago") grupo.proxima_acao = null;
  }
  return [...grupos.values()].sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR"));
}

function round2(valor: number) {
  return Math.round(valor * 100) / 100;
}

export type FaturaEnvio = {
  chave: string;
  id_cobranca: string;
  empresa: string;
  valor: number;
  vencimento: string;
  link: string | null;
};

export type AcaoPlanejada = {
  chave: string;
  id_cobranca: string;
  id_empresa: string;
  empresa: string;
  email: string | null;
  etapa: string;
  label: string;
  tipo: "enviar" | "marco" | "encaminhar";
  vencimento: string;
  valor: number;
  matriz_id: string;
  matriz_nome: string;
  consolida: boolean;
  faturas: FaturaEnvio[];
};

export type ItemPlanejado = {
  id_cobranca: string;
  asaas_payment_id: string | null;
  id_empresa: string;
  empresa: string;
  email: string | null;
  valor: number;
  vencimento: string;
  status_pagamento: string;
  matriz_id: string;
  matriz_nome?: string;
  link?: string | null;
  consolida: boolean;
  envios: Array<{ id: string; etapa: string; status: string; data_prevista: string }>;
};

const ABERTOS = new Set(["a_enviar", "falha", "prevista"]);

export function planejarRegua(hoje: string, itens: ItemPlanejado[], opcoes?: { inicio?: string; bloqueios?: BloqueioRegua[] }): AcaoPlanejada[] {
  const acoes: AcaoPlanejada[] = [];
  const vistas = new Set<string>();
  const inicio = opcoes?.inicio;
  for (const item of itens) {
    if (estaBloqueado(item.matriz_id || item.id_empresa, opcoes?.bloqueios)) continue;
    const etapas = new Map(etapasNoVencimento(item.vencimento).map((etapa) => [etapa.etapa, etapa]));
    for (const envio of item.envios) {
      if (!ABERTOS.has(envio.status)) continue;
      const etapa = etapas.get(envio.etapa);
      if (!etapa) continue;
      const decisao = decidirEtapa({ etapa: { ...etapa, data: envio.data_prevista || etapa.data }, hoje, statusPagamento: item.status_pagamento, vencimento: item.vencimento, inicio });
      if (decisao !== "enviar" && decisao !== "marco" && decisao !== "encaminhar") continue;
      const chave = `${item.asaas_payment_id || item.id_cobranca}:${envio.etapa}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const fatura = { chave, id_cobranca: item.id_cobranca, empresa: item.empresa, valor: item.valor, vencimento: item.vencimento, link: item.link ?? null };
      acoes.push({
        chave,
        id_cobranca: item.id_cobranca,
        id_empresa: item.id_empresa,
        empresa: item.matriz_nome || item.empresa,
        email: item.email,
        etapa: envio.etapa,
        label: etapa.label,
        tipo: decisao,
        vencimento: item.vencimento,
        valor: item.valor,
        matriz_id: item.matriz_id || item.id_empresa,
        matriz_nome: item.matriz_nome || item.empresa,
        consolida: Boolean(item.consolida),
        faturas: [fatura],
      });
    }
  }
  return acoes;
}

export function consolidarEnvios(acoes: AcaoPlanejada[]): AcaoPlanejada[] {
  const saida: AcaoPlanejada[] = [];
  const grupos = new Map<string, AcaoPlanejada>();
  for (const acao of acoes) {
    if (acao.tipo !== "enviar" || !acao.consolida || !acao.email?.includes("@")) {
      saida.push(acao);
      continue;
    }
    const key = `${acao.matriz_id}|${acao.email.trim().toLowerCase()}|${acao.etapa}`;
    const atual = grupos.get(key);
    if (!atual) {
      const criado = { ...acao, chave: key, empresa: acao.matriz_nome, faturas: [...acao.faturas] };
      grupos.set(key, criado);
      saida.push(criado);
      continue;
    }
    atual.faturas.push(...acao.faturas);
    atual.valor = round2(atual.valor + acao.valor);
  }
  return saida;
}

function escaparHtml(valor: string) {
  return valor.replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[caractere] ?? caractere);
}

export function htmlDaEtapa(acao: AcaoPlanejada) {
  const matriz = acao.matriz_nome || acao.empresa;
  const linhas = acao.faturas.map((fatura) => {
    const valor = fatura.valor.toFixed(2).replace(".", ",");
    const vencimento = fatura.vencimento.slice(0, 10).split("-").reverse().join("/");
    const link = fatura.link ? ` — <a href="${escaparHtml(fatura.link)}">Pagar</a>` : "";
    return `<li>${escaparHtml(fatura.empresa)} — R$ ${valor} — venc. ${escaparHtml(vencimento)}${link}</li>`;
  }).join("");
  const total = acao.faturas.reduce((soma, fatura) => soma + fatura.valor, 0).toFixed(2).replace(".", ",");
  return {
    nome: matriz,
    subject: `${acao.label} — ${matriz}`,
    html: `<p>Olá, ${escaparHtml(matriz)}.</p><p>${escaparHtml(acao.label)}. Total R$ ${total}.</p><ul>${linhas}</ul>`,
  };
}

export function encerrarEnvios<T extends { status: string }>(envios: T[]): T[] {
  return envios.map((envio) => ABERTOS.has(envio.status) || envio.status === "enviando" || envio.status === "suspenso" ? { ...envio, status: "resolvido" } : envio);
}

export function suspenderEnvios<T extends { status: string }>(envios: T[]): T[] {
  return envios.map((envio) => ABERTOS.has(envio.status) || envio.status === "enviando" ? { ...envio, status: "suspenso" } : envio);
}
