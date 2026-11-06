import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { z } from "zod";
import type { documentoRescisaoMedioSchema } from "../schemas/documento-contrato.js";

export type RescisaoMedioDados = z.infer<typeof documentoRescisaoMedioSchema>;

const NAVY = rgb(0.06, 0.11, 0.24);
const INK = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.35, 0.39, 0.45);
const LINE = rgb(0.75, 0.78, 0.82);
const PAPER = rgb(1, 1, 1);

const AGENTE = "DNA WORK TREINAMENTO E DESENVOLVIMENTO PROFISSIONAL LTDA., sociedade com sede na Rua do Carmo, 1621, Loja 02, na cidade de São Paulo, no estado de São Paulo, CEP 01136-001, inscrita no CNPJ sob nº 40.380.163/0001-61, com e-mail de contato documentos@dnawork.ai, neste ato representada na forma de seu documento constitutivo, por seu representante legal abaixo assinado (\"DNA Work\");";

export function dataBr(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function marca(ativo: boolean) {
  return ativo ? "( X )" : "(   )";
}

export function textoRescisaoMedio(dados: RescisaoMedioDados): string[] {
  const inicio = dataBr(dados.data_tce);
  const fim = dataBr(dados.data_rescisao);
  const obrigatorio = dados.tipo_estagio === "obrigatorio";
  const concedente = [
    `${dados.concedente_razao.trim()}, sociedade com sede na ${dados.concedente_endereco.trim() || "endereço não informado"}`,
    dados.concedente_cnpj.trim() ? `inscrita no CNPJ sob nº ${dados.concedente_cnpj.trim()}` : "",
    dados.concedente_email.trim() ? `com e-mail de contato ${dados.concedente_email.trim()}` : "",
    "neste ato representada por seu representante legal abaixo assinado (\"Concedente\");",
  ].filter(Boolean).join(", ");
  const localEscola = [
    dados.escola_endereco.trim(),
    dados.escola_cidade.trim() ? `na cidade de ${dados.escola_cidade.trim()}` : "",
    dados.escola_estado.trim() ? `no estado de ${dados.escola_estado.trim()}` : "",
    dados.escola_cep.trim() ? `CEP ${dados.escola_cep.trim()}` : "",
  ].filter(Boolean).join(", ");
  const escola = [
    `${dados.escola_nome.trim() || "Instituição de ensino"}, instituição de ensino com endereço na ${localEscola || "endereço não informado"}`,
    dados.escola_cnpj.trim() ? `inscrita no CNPJ/INEP sob nº ${dados.escola_cnpj.trim()}` : "",
    dados.escola_email.trim() ? `com e-mail de contato ${dados.escola_email.trim()}` : "",
    "neste ato representada por seu representante/assistente abaixo assinado (\"Instituição de Ensino\");",
  ].filter(Boolean).join(", ");

  return [
    concedente,
    `Tipo de Estágio: ${marca(obrigatorio)} Obrigatório ${marca(!obrigatorio)} Não Obrigatório`,
    escola,
    AGENTE,
    "(Concedente, Estagiário, Instituição de Ensino e DNA Work, quando referidos em conjunto, \"Partes\" e, individualmente e indistintamente, \"Parte\").",
    "CONSIDERANDO QUE:",
    `(i) As Partes celebraram o Termo de Compromisso de Estágio para estabelecer as condições para a realização do estágio, nos termos da Lei nº 11.788/08, conforme alterada ("TCE" e "Lei do Estágio", respectivamente) em ${inicio};`,
    "(ii) A Concedente e/ou o Estagiário desejam encerrar o Estágio;",
    "(iii) As Partes de comum acordo desejam rescindir o TCE.",
    "RESOLVEM as Partes celebrar entre si o presente \"Termo de rescisão e realização de estágio\" (\"Termo de Rescisão\"), com a interveniência anuente da DNA Work, o qual será regido conforme as cláusulas e condições abaixo:",
    "1. As Partes decidem de comum acordo e sem quaisquer restrições rescindir o TCE na presente data.",
    "2. As Partes outorgam, uma à outra, a mais ampla, rasa, geral, irrevogável e irrestrita quitação, para nada mais reclamarem no presente ou no futuro, em relação aos direitos e/ou obrigações oriundas do desempenho das atividades previstas no TCE desempenhadas até a Data de Rescisão.",
    "3. A Concedente reitera que a Lei do Estágio e o TCE foram cumpridos durante o Estágio e que a rescisão e a realização do Estágio se deu pelos seguintes motivos e termos, nos termos do Art. 9, V da Lei do Estágio:",
    `(i) Resumo das atividades desenvolvidas: ${dados.atividades.trim()}`,
    `(ii) Período de Estágio: ${inicio} até ${fim};`,
    `(iii) Motivo de rescisão: ${dados.motivo.trim()}`,
    `(iv) Avaliação de desempenho: ${dados.avaliacao.trim()}`,
    "4. O presente Termo de Rescisão é firmado em caráter irrevogável e irretratável, obrigando as Partes e a seus sucessores a qualquer título.",
    "5. Fica eleito o foro da cidade de São Paulo para dirimir toda e qualquer questão ou controvérsia oriunda do presente termo, com exclusão de qualquer outro, por mais privilegiado que possa ser.",
    "E, por estarem de inteiro e comum acordo, as partes assinam o presente instrumento.",
    `São Paulo, ${fim}`,
  ];
}

export async function buildRescisaoMedioPdf(dados: RescisaoMedioDados): Promise<Buffer> {
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
        } else atual = proxima;
      }
      saida.push(atual);
    }
    return saida;
  }

  function paragrafo(value: string, size = 10, font = regular, gap = 13) {
    for (const linha of linhas(font, value, size, largura)) {
      garantir(gap);
      y -= gap;
      if (linha) page.drawText(linha, { x: margem, y, size, font, color: INK });
    }
  }

  function faixa(titulo: string) {
    garantir(26);
    y -= 20;
    page.drawRectangle({ x: margem, y: y - 4, width: largura, height: 16, color: rgb(0.93, 0.95, 0.97) });
    page.drawText(titulo, { x: margem + 6, y: y, size: 9, font: bold, color: NAVY });
    y -= 8;
  }

  function grade(itens: Array<[string, string]>) {
    const coluna = largura / 2;
    for (let i = 0; i < itens.length; i += 2) {
      const fatia = itens.slice(i, i + 2);
      const alturas = fatia.map(([, valor]) => linhas(regular, valor || "—", 9, coluna - 12).length);
      const altura = 16 + Math.max(...alturas, 1) * 12;
      garantir(altura);
      const topo = y;
      fatia.forEach(([rotulo, valor], indice) => {
        const x = margem + indice * coluna;
        page.drawText(rotulo.toUpperCase(), { x, y: topo - 10, size: 7, font: bold, color: MUTED });
        linhas(regular, valor || "—", 9, coluna - 12).forEach((linha, linhaIndice) => {
          page.drawText(linha, { x, y: topo - 22 - linhaIndice * 12, size: 9, font: regular, color: INK });
        });
      });
      y = topo - altura;
    }
  }

  page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 52, color: NAVY });
  page.drawText("DNA WORK", { x: margem, y: 814, size: 15, font: bold, color: PAPER });
  page.drawText("Termo de rescisão e realização de estágio", { x: margem, y: 798, size: 9, font: regular, color: rgb(0.78, 0.86, 0.95) });
  y = 768;
  const titulo = "TERMO DE RESCISÃO E REALIZAÇÃO DE ESTÁGIO";
  page.drawText(titulo, { x: (595.28 - bold.widthOfTextAtSize(titulo, 12)) / 2, y, size: 12, font: bold, color: NAVY });
  y -= 6;
  page.drawLine({ start: { x: margem, y }, end: { x: 595.28 - margem, y }, thickness: 0.6, color: LINE });

  faixa("Concedente");
  paragrafo(textoRescisaoMedio(dados)[0]);

  faixa("Estagiário");
  grade([
    ["Estagiário", dados.estagiario_nome],
    ["Responsável legal", dados.responsavel_nome || "—"],
    ["Nascimento", dataBr(dados.estagiario_nascimento)],
    ["Nascimento", dataBr(dados.responsavel_nascimento)],
    ["CPF", dados.estagiario_cpf || "—"],
    ["CPF", dados.responsavel_cpf || "—"],
    ["RG", dados.estagiario_rg || "—"],
    ["RG", dados.responsavel_rg || "—"],
    ["Endereço", dados.estagiario_endereco || "—"],
    ["Endereço", dados.responsavel_endereco || "—"],
    ["CEP", dados.estagiario_cep || "—"],
    ["CEP", dados.responsavel_cep || "—"],
    ["Cidade", dados.estagiario_cidade || "—"],
    ["Cidade", dados.responsavel_cidade || "—"],
    ["Estado", dados.estagiario_estado || "—"],
    ["Estado", dados.responsavel_estado || "—"],
    ["Curso", dados.estagiario_curso || "—"],
    ["Contato", dados.responsavel_contato || "—"],
    ["Período/Ano", dados.estagiario_periodo || "—"],
    ["Turno", dados.estagiario_turno || "—"],
    ["Contato", dados.estagiario_contato || "—"],
  ]);
  y -= 6;
  paragrafo(textoRescisaoMedio(dados)[1], 10, bold);

  faixa("Instituição de ensino");
  paragrafo(textoRescisaoMedio(dados)[2]);
  if (dados.escola_representante.trim()) paragrafo(`Representante: ${dados.escola_representante.trim()}`, 10, regular, 13);

  faixa("Agente de integração (interveniente anuente)");
  const partes = textoRescisaoMedio(dados);
  paragrafo(partes[3]);
  y -= 4;
  paragrafo(partes[4]);

  faixa("Considerando que");
  for (const linha of partes.slice(6, 9)) paragrafo(linha);
  y -= 6;
  paragrafo(partes[9]);
  for (const linha of partes.slice(10, 20)) paragrafo(linha);

  y -= 8;
  paragrafo(partes[20], 10, bold, 14);

  const caixas: Array<[string, string]> = [
    ["Concedente", dados.concedente_representante || dados.concedente_razao],
    ["Estagiário", dados.estagiario_nome],
    ["Instituição de ensino", dados.escola_representante || dados.escola_nome],
    ["Responsável legal (se aplicável)", dados.responsavel_nome || "—"],
  ];
  const caixaLargura = (largura - 16) / 2;
  for (let i = 0; i < caixas.length; i += 2) {
    garantir(72);
    y -= 64;
    [0, 1].forEach((coluna) => {
      const item = caixas[i + coluna];
      if (!item) return;
      const x = margem + coluna * (caixaLargura + 16);
      page.drawLine({ start: { x, y: y + 34 }, end: { x: x + caixaLargura, y: y + 34 }, thickness: 0.7, color: NAVY });
      page.drawText(item[0].toUpperCase(), { x, y: y + 20, size: 8, font: bold, color: NAVY });
      const nome = linhas(regular, item[1] || "—", 8, caixaLargura)[0] ?? "—";
      page.drawText(nome, { x, y: y + 8, size: 8, font: regular, color: INK });
    });
  }
  garantir(36);
  y -= 28;
  const dna = "DNA WORK TREINAMENTO E DESENVOLVIMENTO PROFISSIONAL LTDA.";
  page.drawText(dna, { x: (595.28 - bold.widthOfTextAtSize(dna, 8)) / 2, y, size: 8, font: bold, color: NAVY });

  const paginas = doc.getPages();
  paginas.forEach((folha: PDFPage, indice) => {
    folha.drawText(`DNA Work · Rescisão de estágio do ensino médio · página ${indice + 1} de ${paginas.length}`, {
      x: margem, y: 28, size: 8, font: regular, color: MUTED,
    });
  });

  return Buffer.from(await doc.save());
}
