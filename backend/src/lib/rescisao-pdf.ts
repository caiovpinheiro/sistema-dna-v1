import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type RescisaoPdfDados = {
  titulo: string;
  candidato: string;
  cpf: string;
  emailCandidato: string;
  celular: string;
  empresa: string;
  cnpj: string;
  responsavelEmpresa: string;
  instituicao: string;
  diretor: string;
  cargo: string;
  modalidade: string;
  cargaHoraria: string;
  salario: string;
  inicio: string;
  fimPrevisto: string;
  demissao: string;
  motivo: string;
  avaliacao: string;
  atividades: string;
  cidade: string;
};

const NAVY = rgb(0.06, 0.11, 0.24);
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.35, 0.39, 0.45);
const LINE = rgb(0.75, 0.78, 0.82);
const PAPER = rgb(1, 1, 1);

export async function buildRescisaoPdf(dados: RescisaoPdfDados): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 842;

  const margem = 40;
  const largura = 595.28 - margem * 2;

  function novaPagina() {
    page = doc.addPage([595.28, 841.89]);
    y = 800;
  }

  function garantir(altura: number) {
    if (y - altura < 48) novaPagina();
  }

  function texto(font: PDFFont, value: string, x: number, size: number, color = INK) {
    page.drawText(value, { x, y, size, font, color });
  }

  function linhas(font: PDFFont, value: string, size: number, width: number) {
    const saida: string[] = [];
    for (const paragrafo of value.split("\n")) {
      const palavras = paragrafo.split(/\s+/).filter(Boolean);
      if (!palavras.length) {
        saida.push("");
        continue;
      }
      let atual = "";
      for (const palavra of palavras) {
        const proxima = atual ? `${atual} ${palavra}` : palavra;
        if (font.widthOfTextAtSize(proxima, size) > width && atual) {
          saida.push(atual);
          atual = palavra;
        } else {
          atual = proxima;
        }
      }
      saida.push(atual);
    }
    return saida;
  }

  function paragrafo(value: string, size = 10, font = regular, gap = 14) {
    for (const linha of linhas(font, value, size, largura)) {
      garantir(gap);
      y -= gap;
      if (linha) texto(font, linha, margem, size);
    }
  }

  function faixa(titulo: string) {
    garantir(28);
    y -= 22;
    page.drawRectangle({ x: margem, y: y - 4, width: largura, height: 18, color: rgb(0.93, 0.95, 0.97) });
    texto(bold, titulo, margem + 8, 9, NAVY);
    y -= 8;
  }

  function grade(itens: Array<[string, string]>, colunas: number) {
    const coluna = largura / colunas;
    for (let i = 0; i < itens.length; i += colunas) {
      const fatia = itens.slice(i, i + colunas);
      const alturas = fatia.map(([, valor]) => linhas(regular, valor || "—", 10, coluna - 16).length);
      const linhasMax = Math.max(...alturas, 1);
      const altura = 18 + linhasMax * 13;
      garantir(altura);
      const topo = y;
      fatia.forEach(([rotulo, valor], indice) => {
        const x = margem + indice * coluna;
        let cursor = topo;
        page.drawText(rotulo.toUpperCase(), { x, y: cursor - 10, size: 7, font: bold, color: MUTED });
        const miolo = linhas(regular, valor || "—", 10, coluna - 16);
        miolo.forEach((linha, linhaIndice) => {
          page.drawText(linha || "—", { x, y: cursor - 24 - linhaIndice * 13, size: 10, font: regular, color: INK });
        });
      });
      y = topo - altura;
    }
  }

  page.drawRectangle({ x: 0, y: 786, width: 595.28, height: 56, color: NAVY });
  page.drawText("DNA WORK", { x: margem, y: 812, size: 16, font: bold, color: PAPER });
  page.drawText("Agente de integração", { x: margem, y: 796, size: 9, font: regular, color: rgb(0.78, 0.86, 0.95) });
  y = 760;
  const titulo = dados.titulo.toUpperCase();
  const tituloLargura = bold.widthOfTextAtSize(titulo, 13);
  page.drawText(titulo, { x: (595.28 - tituloLargura) / 2, y, size: 13, font: bold, color: NAVY });
  y -= 8;
  page.drawLine({ start: { x: margem, y }, end: { x: 595.28 - margem, y }, thickness: 0.6, color: LINE });

  y -= 6;
  const intro = dados.modalidade.toLowerCase().includes("clt")
    ? "Pelo presente instrumento, as partes abaixo identificadas resolvem rescindir o contrato de trabalho a partir da data de demissão, permanecendo o registro das atividades exercidas."
    : "Pelo presente instrumento, as partes abaixo identificadas resolvem rescindir o contrato de estágio, na forma da Lei nº 11.788/2008, a partir da data de demissão.";
  paragrafo(intro, 10, regular, 13);

  faixa("Partes");
  grade([
    ["Candidato", dados.candidato],
    ["CPF", dados.cpf],
    ["E-mail", dados.emailCandidato],
    ["Celular", dados.celular],
    ["Empresa", dados.empresa],
    ["CNPJ", dados.cnpj],
    ["Responsável da empresa", dados.responsavelEmpresa],
    ["Instituição de ensino", dados.instituicao],
    ["Diretor da instituição", dados.diretor],
    ["Cargo", dados.cargo],
    ["Modalidade", dados.modalidade],
    ["Carga horária", dados.cargaHoraria],
  ], 2);

  faixa("Vínculo e rescisão");
  grade([
    ["Início", dados.inicio],
    ["Previsão de término", dados.fimPrevisto],
    ["Data de demissão", dados.demissao],
    ["Bolsa ou salário", dados.salario],
    ["Motivo da demissão", dados.motivo],
    ["Avaliação de desempenho", dados.avaliacao],
  ], 2);

  faixa("Resumo das atividades");
  paragrafo(dados.atividades || "—", 10, regular, 13);

  garantir(150);
  y -= 28;
  paragrafo(`${dados.cidade || "São Paulo"}, ${dados.demissao}.`, 10, regular, 14);
  y -= 18;

  const caixas: Array<[string, string]> = [
    ["Candidato", dados.candidato],
    ["Empresa", dados.responsavelEmpresa || dados.empresa],
    ["Instituição de ensino", dados.diretor || dados.instituicao],
    ["Agente de integração", "DNA Work"],
  ];
  const caixaLargura = (largura - 16) / 2;
  for (let i = 0; i < caixas.length; i += 2) {
    garantir(78);
    y -= 70;
    [0, 1].forEach((coluna) => {
      const item = caixas[i + coluna];
      if (!item) return;
      const x = margem + coluna * (caixaLargura + 16);
      page.drawLine({ start: { x, y: y + 36 }, end: { x: x + caixaLargura, y: y + 36 }, thickness: 0.7, color: NAVY });
      page.drawText(item[0], { x, y: y + 22, size: 8, font: bold, color: NAVY });
      const nome = linhas(regular, item[1] || "—", 8, caixaLargura)[0] ?? "—";
      page.drawText(nome, { x, y: y + 10, size: 8, font: regular, color: INK });
    });
  }

  const paginas = doc.getPages();
  paginas.forEach((folha: PDFPage, indice) => {
    folha.drawText(`DNA Work · ${dados.titulo} · página ${indice + 1} de ${paginas.length}`, {
      x: margem,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return Buffer.from(await doc.save());
}
