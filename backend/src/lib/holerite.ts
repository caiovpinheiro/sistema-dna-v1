import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Lançamentos que o operador faz na folha de cada estagiário. */
export type LancamentoHolerite = {
  faltas: number;
  auxilio_transporte: number;
  acrescimos: number;
  descricao_acrescimos: string;
  descontos: number;
  descricao_descontos: string;
};

export type CalculoHolerite = {
  dias_mes: number;
  dias_trabalhados: number;
  bolsa_base: number;
  bolsa_proporcional: number;
  valor_faltas: number;
  proventos: number;
  total_descontos: number;
  liquido: number;
};

const centavos = (valor: number) => Math.round(valor * 100) / 100;

/** "2026-11" → { ano: 2026, mes: 11 }. */
export function lerCompetencia(competencia: string) {
  const partes = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  return mes >= 1 && mes <= 12 ? { ano, mes } : null;
}

export function diasNoMes(ano: number, mes: number) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/**
 * Dias em que o estagiário esteve contratado no mês: do início (ou dia 1) até a demissão (ou o último dia),
 * contando os dois. Datas em AAAA-MM-DD. Fora do mês → 0.
 */
export function diasTrabalhados(competencia: string, inicio: string | null, demissao: string | null) {
  const comp = lerCompetencia(competencia);
  if (!comp) return 0;
  const total = diasNoMes(comp.ano, comp.mes);
  const primeiro = `${competencia}-01`;
  const ultimo = `${competencia}-${String(total).padStart(2, "0")}`;
  const de = inicio && inicio > primeiro ? inicio : primeiro;
  const ate = demissao && demissao < ultimo ? demissao : ultimo;
  if (de > ultimo || ate < primeiro || ate < de) return 0;
  const dias = (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000 + 1;
  return Math.max(0, Math.min(total, Math.round(dias)));
}

/**
 * Holerite de estágio, na regra do sistema antigo: bolsa da vaga dividida pelos dias corridos do mês e
 * multiplicada pelos dias trabalhados; cada falta desconta um dia de bolsa. Estágio não tem INSS, IRRF nem FGTS.
 */
export function calcularHolerite(entrada: { competencia: string; bolsa_base: number; inicio: string | null; demissao: string | null; lancamento: LancamentoHolerite }): CalculoHolerite {
  const comp = lerCompetencia(entrada.competencia);
  const diasMes = comp ? diasNoMes(comp.ano, comp.mes) : 30;
  const dias = diasTrabalhados(entrada.competencia, entrada.inicio, entrada.demissao);
  const base = Math.max(0, Number(entrada.bolsa_base) || 0);
  const diaria = base / diasMes;
  const bolsa = centavos(dias >= diasMes ? base : diaria * dias);
  const faltas = Math.max(0, Math.min(dias, Math.floor(Number(entrada.lancamento.faltas) || 0)));
  const valorFaltas = centavos(diaria * faltas);
  const proventos = centavos(bolsa + Math.max(0, entrada.lancamento.auxilio_transporte || 0) + Math.max(0, entrada.lancamento.acrescimos || 0));
  const descontos = centavos(valorFaltas + Math.max(0, entrada.lancamento.descontos || 0));
  return {
    dias_mes: diasMes,
    dias_trabalhados: dias,
    bolsa_base: centavos(base),
    bolsa_proporcional: bolsa,
    valor_faltas: valorFaltas,
    proventos,
    total_descontos: descontos,
    liquido: centavos(proventos - descontos),
  };
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function competenciaPorExtenso(competencia: string) {
  const comp = lerCompetencia(competencia);
  return comp ? `${MESES[comp.mes - 1]} de ${comp.ano}` : competencia;
}

const real = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

export type HoleritePdf = {
  competencia: string;
  empresa: { razao_social: string; cnpj: string };
  estagiario: { nome: string; cpf: string; cargo: string; inicio: string | null };
  lancamento: LancamentoHolerite;
  calculo: CalculoHolerite;
};

/** Linhas da tabela do holerite: descrição, referência, provento, desconto. Só as que têm valor (a bolsa sempre). */
export function linhasDoHolerite(dados: HoleritePdf): Array<[string, string, number | null, number | null]> {
  const { calculo: c, lancamento: l } = dados;
  const linhas: Array<[string, string, number | null, number | null]> = [
    ["Bolsa-auxílio", `${c.dias_trabalhados}/${c.dias_mes} dias`, c.bolsa_proporcional, null],
  ];
  if (l.auxilio_transporte > 0) linhas.push(["Auxílio-transporte", "", centavos(l.auxilio_transporte), null]);
  if (l.acrescimos > 0) linhas.push([l.descricao_acrescimos.trim() || "Outros acréscimos", "", centavos(l.acrescimos), null]);
  if (c.valor_faltas > 0) linhas.push(["Faltas", `${l.faltas} ${l.faltas === 1 ? "dia" : "dias"}`, null, c.valor_faltas]);
  if (l.descontos > 0) linhas.push([l.descricao_descontos.trim() || "Outros descontos", "", null, centavos(l.descontos)]);
  return linhas;
}

const NAVY = rgb(0.06, 0.11, 0.24);
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.38, 0.42, 0.48);
const LINE = rgb(0.78, 0.81, 0.85);
const SHADE = rgb(0.95, 0.96, 0.97);

function texto(page: PDFPage, valor: string, x: number, y: number, font: PDFFont, size = 9, color = INK) {
  page.drawText(valor, { x, y, size, font, color });
}

function direita(page: PDFPage, valor: string, xFim: number, y: number, font: PDFFont, size = 9, color = INK) {
  page.drawText(valor, { x: xFim - font.widthOfTextAtSize(valor, size), y, size, font, color });
}

/** Corta o texto para caber na largura, com reticências. */
function caber(valor: string, largura: number, font: PDFFont, size: number) {
  if (font.widthOfTextAtSize(valor, size) <= largura) return valor;
  let atual = valor;
  while (atual.length > 1 && font.widthOfTextAtSize(`${atual}…`, size) > largura) atual = atual.slice(0, -1);
  return `${atual}…`;
}

function dataBr(iso: string | null) {
  const partes = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : "—";
}

/** Um holerite (recibo de bolsa-auxílio) por página, A4 retrato, com via do estagiário. */
export async function gerarHoleritesPdf(lista: HoleritePdf[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(lista.length === 1 ? `Holerite ${lista[0].estagiario.nome}` : "Holerites");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const dados of lista) {
    const page = pdf.addPage([595.28, 841.89]);
    const m = 48;
    const largura = 595.28 - m * 2;
    let y = 790;
    texto(page, "DNA WORK", m, y, negrito, 16, NAVY);
    direita(page, "Recibo de pagamento de bolsa-auxílio", m + largura, y + 2, negrito, 11, NAVY);
    y -= 16;
    direita(page, `Competência: ${competenciaPorExtenso(dados.competencia)}`, m + largura, y, regular, 9, MUTED);
    y -= 14;
    page.drawLine({ start: { x: m, y }, end: { x: m + largura, y }, thickness: 1.2, color: NAVY });

    y -= 22;
    texto(page, "Concedente", m, y, negrito, 8, MUTED);
    texto(page, "CNPJ", m + 330, y, negrito, 8, MUTED);
    y -= 13;
    texto(page, caber(dados.empresa.razao_social || "—", 320, regular, 10), m, y, regular, 10);
    texto(page, dados.empresa.cnpj || "—", m + 330, y, regular, 10);
    y -= 22;
    texto(page, "Estagiário", m, y, negrito, 8, MUTED);
    texto(page, "CPF", m + 330, y, negrito, 8, MUTED);
    y -= 13;
    texto(page, caber(dados.estagiario.nome || "—", 320, regular, 10), m, y, regular, 10);
    texto(page, dados.estagiario.cpf || "—", m + 330, y, regular, 10);
    y -= 22;
    texto(page, "Atividade", m, y, negrito, 8, MUTED);
    texto(page, "Início do estágio", m + 330, y, negrito, 8, MUTED);
    y -= 13;
    texto(page, caber(dados.estagiario.cargo || "—", 320, regular, 10), m, y, regular, 10);
    texto(page, dataBr(dados.estagiario.inicio), m + 330, y, regular, 10);

    y -= 28;
    const col = { ref: m + 250, prov: m + largura - 110, desc: m + largura };
    page.drawRectangle({ x: m, y: y - 6, width: largura, height: 20, color: SHADE });
    texto(page, "Descrição", m + 8, y, negrito, 9);
    texto(page, "Referência", col.ref, y, negrito, 9);
    direita(page, "Proventos", col.prov, y, negrito, 9);
    direita(page, "Descontos", col.desc - 8, y, negrito, 9);
    y -= 12;
    for (const [descricao, referencia, provento, desconto] of linhasDoHolerite(dados)) {
      y -= 18;
      texto(page, caber(descricao, 230, regular, 9.5), m + 8, y, regular, 9.5);
      texto(page, referencia, col.ref, y, regular, 9.5, MUTED);
      if (provento != null) direita(page, real(provento), col.prov, y, regular, 9.5);
      if (desconto != null) direita(page, real(desconto), col.desc - 8, y, regular, 9.5);
      page.drawLine({ start: { x: m, y: y - 6 }, end: { x: m + largura, y: y - 6 }, thickness: 0.5, color: LINE });
    }
    y -= 24;
    texto(page, "Totais", m + 8, y, negrito, 9.5);
    direita(page, real(dados.calculo.proventos), col.prov, y, negrito, 9.5);
    direita(page, real(dados.calculo.total_descontos), col.desc - 8, y, negrito, 9.5);
    y -= 26;
    page.drawRectangle({ x: m, y: y - 9, width: largura, height: 28, color: SHADE, borderColor: NAVY, borderWidth: 0.8 });
    texto(page, "Valor líquido a receber", m + 8, y, negrito, 11, NAVY);
    direita(page, real(dados.calculo.liquido), col.desc - 8, y, negrito, 12, NAVY);

    y -= 40;
    texto(page, "Estágio regido pela Lei nº 11.788/2008: a bolsa-auxílio não gera vínculo empregatício nem incidência de INSS, IRRF ou FGTS.", m, y, regular, 8, MUTED);
    y -= 44;
    texto(page, `Declaro ter recebido a importância líquida de ${real(dados.calculo.liquido)} referente a ${competenciaPorExtenso(dados.competencia)}.`, m, y, regular, 9);
    y -= 56;
    page.drawLine({ start: { x: m, y }, end: { x: m + 230, y }, thickness: 0.7, color: INK });
    page.drawLine({ start: { x: m + largura - 150, y }, end: { x: m + largura, y }, thickness: 0.7, color: INK });
    y -= 12;
    texto(page, caber(dados.estagiario.nome || "Estagiário", 230, regular, 8.5), m, y, regular, 8.5, MUTED);
    texto(page, "Data", m + largura - 150, y, regular, 8.5, MUTED);
  }
  return pdf.save();
}
