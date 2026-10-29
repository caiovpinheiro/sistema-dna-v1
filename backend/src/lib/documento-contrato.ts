import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { AppError } from "./errors.js";
import { parseMoney } from "./money.js";
import type { DocumentoGerado } from "../schemas/documento-contrato.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const MODELOS = {
  contrato: fileURLToPath(new URL("../../templates/modelo-1-contrato.docx", import.meta.url)),
  adesao: fileURLToPath(new URL("../../templates/modelo-2-aderente.docx", import.meta.url)),
};

function xml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function trocar(origem: string, de: string, para: string, nome: string) {
  if (!origem.includes(de)) throw new AppError(500, "MODELO_DIVERGENTE", `O modelo não contém o trecho ${nome}.`);
  return origem.replace(de, para);
}

function dataPorExtenso(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  if (!ano || !mes || !dia || mes < 1 || mes > 12) throw new AppError(422, "DATA_INVALIDA", "Informe uma data válida.");
  return `${dia} de ${MESES[mes - 1]} de ${ano}`;
}

function cnpj(value: string) {
  const digitos = value.replace(/\D/g, "");
  if (digitos.length !== 14) throw new AppError(422, "CNPJ_INVALIDO", "Informe o CNPJ com 14 dígitos.");
  return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function telefone(value: string): string {
  const digitos = value.replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  if (digitos.length === 13 && digitos.startsWith("55")) return `+55 ${telefone(digitos.slice(2))}`;
  return value.trim();
}

function dinheiro(value: string | undefined, aplica: boolean) {
  if (!aplica) return "—";
  try {
    const numero = parseMoney(value ?? "");
    return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    throw new AppError(422, "VALOR_INVALIDO", "Informe um valor em reais válido.");
  }
}

function percentual(value: string | undefined, aplica: boolean) {
  if (!aplica) return "—";
  try {
    const numero = parseMoney(value ?? "");
    return Number.isInteger(numero) ? String(numero) : numero.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  } catch {
    throw new AppError(422, "PERCENTUAL_INVALIDO", "Informe um percentual válido.");
  }
}

function marca(ativo: boolean) {
  return ativo ? "( X )" : "(   )";
}

function nomeArquivo(prefixo: string, razao: string) {
  const limpo = razao.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.\- ]+/g, "").trim().replace(/\.+$/, "").slice(0, 80);
  return `${prefixo} - ${limpo || "documento"}.docx`;
}

function exigir(condicao: boolean, mensagem: string) {
  if (!condicao) throw new AppError(422, "VALIDACAO", mensagem);
}

async function abrir(caminho: string) {
  const zip = await JSZip.loadAsync(await readFile(caminho));
  const arquivo = zip.file("word/document.xml");
  if (!arquivo) throw new AppError(500, "MODELO_DIVERGENTE", "O modelo não tem o texto do documento.");
  return { zip, xml: await arquivo.async("string") };
}

async function fechar(zip: JSZip, xml: string) {
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function substituirSequencia(origem: string, alvo: string, valores: string[]) {
  let texto = origem;
  const trecho = `<w:t>${alvo}</w:t>`;
  for (const valor of valores) {
    const indice = texto.indexOf(trecho);
    if (indice < 0) throw new AppError(500, "MODELO_DIVERGENTE", "O modelo do contrato não tem todos os campos em branco.");
    texto = `${texto.slice(0, indice)}<w:t>${xml(valor)}</w:t>${texto.slice(indice + trecho.length)}`;
  }
  return texto;
}

function preencherContrato(documento: string, dados: Extract<DocumentoGerado, { modelo: "contrato" }>) {
  const corte = documento.indexOf("ANEXO II");
  if (corte < 0) throw new AppError(500, "MODELO_DIVERGENTE", "O modelo do contrato não tem o Anexo II.");
  let cabeca = documento.slice(0, corte);
  const cauda = documento.slice(corte);
  const direta = dados.modalidade === "direta" || dados.modalidade === "ambas";
  const estagio = dados.modalidade === "estagio" || dados.modalidade === "ambas";
  const data = dataPorExtenso(dados.data);
  const outros = dados.regimes.outros ? (dados.regimes.outros_texto?.trim() || "__________") : "__________";
  const regimes = direta
    ? `2.1. Regimes abrangidos (assinalar os aplicáveis): ${marca(dados.regimes.clt_indeterminado)} CLT por prazo indeterminado   ${marca(dados.regimes.clt_determinado)} CLT por prazo determinado ou contrato de experiência   ${marca(dados.regimes.clt_intermitente)} CLT intermitente   ${marca(dados.regimes.autonomo)} profissional autônomo   ${marca(dados.regimes.pj)} pessoa jurídica prestadora de serviços   ${marca(dados.regimes.outros)} outros: ${xml(outros)}.`
    : "2.1. Regimes abrangidos (assinalar os aplicáveis): (   ) CLT por prazo indeterminado   (   ) CLT por prazo determinado ou contrato de experiência   (   ) CLT intermitente   (   ) profissional autônomo   (   ) pessoa jurídica prestadora de serviços   (   ) outros: __________.";
  const garantiaSim = direta && dados.garantia === "sim";
  const diasGarantia = dados.garantia_dias?.replace(/\D/g, "") || "45";
  const garantia = `2.5. Garantia de reposição (Cláusula 14.5): ${marca(garantiaSim)} Sim, prazo de ${xml(diasGarantia)} dias    ${marca(!garantiaSim)} Não se aplica.`;
  const conversaoIsento = !estagio || dados.conversao_12 !== "percentual";
  const conversaoNumero = conversaoIsento ? "_____" : xml(percentual(dados.conversao_percentual, true));
  const conversao = `4.3. Conversão após 12 (doze) meses: ${marca(conversaoIsento)} isento     ${marca(!conversaoIsento)} ${conversaoNumero}%.`;

  cabeca = trocar(
    cabeca,
    "(   ) Modalidade Contratação Direta          (   ) Modalidade Estágio          ( </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>X</w:t></w:r><w:r><w:t xml:space=\"preserve\"> ) Ambas",
    `${marca(dados.modalidade === "direta")} Modalidade Contratação Direta          ${marca(dados.modalidade === "estagio")} Modalidade Estágio          ${marca(dados.modalidade === "ambas")} Ambas`,
    "modalidades do Anexo I",
  );
  cabeca = trocar(
    cabeca,
    "2.1. Regimes abrangidos (assinalar os aplicáveis): ( </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>X</w:t></w:r><w:r><w:t xml:space=\"preserve\"> ) CLT por prazo indeterminado   (   ) CLT por prazo determinado ou contrato de experiência   (   ) CLT intermitente   (   ) profissional autônomo   (   ) pessoa jurídica prestadora de serviços   (   ) outros: __________.</w:t>",
    `${regimes}</w:t>`,
    "regimes",
  );
  cabeca = trocar(
    cabeca,
    "2.4. Vencimento: </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>5</w:t></w:r><w:r><w:t xml:space=\"preserve\"> dias contados da Data de Colocação.</w:t>",
    `2.4. Vencimento: ${xml(dados.vencimento_dias.replace(/\D/g, "") || "5")} dias contados da Data de Colocação.</w:t>`,
    "vencimento da contratação direta",
  );
  cabeca = trocar(
    cabeca,
    "2.5. Garantia de reposição (Cláusula 14.5): ( </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>X</w:t></w:r><w:r><w:t xml:space=\"preserve\"> ) Sim, prazo de </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>45</w:t></w:r><w:r><w:t xml:space=\"preserve\"> dias    (   ) Não se aplica.</w:t>",
    `${garantia}</w:t>`,
    "garantia de reposição",
  );
  cabeca = trocar(
    cabeca,
    "Conversão após 12 (doze) meses: ( </w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>X</w:t></w:r><w:r><w:t xml:space=\"preserve\"> ) isento     (   ) _____%.</w:t>",
    `${conversao}</w:t>`,
    "conversão após 12 meses",
  );
  cabeca = cabeca.replaceAll("<w:r w:rsidR=\"004F23D4\" w:rsidRPr=\"004F23D4\"><w:rPr><w:highlight w:val=\"yellow\"/></w:rPr><w:t>[</w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:rPr><w:highlight w:val=\"yellow\"/></w:rPr><w:t>Confirmar</w:t></w:r><w:r w:rsidR=\"004F23D4\" w:rsidRPr=\"004F23D4\"><w:rPr><w:highlight w:val=\"yellow\"/></w:rPr><w:t>]</w:t></w:r>", "");
  cabeca = substituirSequencia(cabeca, "[=]", [
    dados.razao_social.trim(),
    cnpj(dados.cnpj),
    dados.email.trim(),
    percentual(dados.taxa_recrutamento_percentual, direta),
    dinheiro(dados.taxa_administrativa, estagio),
    dinheiro(dados.taxa_recrutamento_estagio, estagio),
  ]);
  cabeca = trocar(cabeca, "<w:t>[endereço completo]</w:t>", `<w:t>${xml(dados.endereco.trim())}</w:t>`, "endereço da contratante");
  cabeca = substituirSequencia(cabeca, "[data]", [data, data]);
  const registro = dados.registro?.trim();
  if (registro) {
    cabeca = trocar(
      cabeca,
      "Registro:_</w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t xml:space=\"preserve\"> </w:t></w:r><w:r><w:t>_______________________</w:t></w:r><w:r w:rsidR=\"004F23D4\"><w:t>______________________________________________________</w:t>",
      `Registro: ${xml(registro)}</w:t>`,
      "registro de condições",
    );
  }
  const observacoes = dados.observacoes?.trim();
  if (observacoes) {
    cabeca = trocar(
      cabeca,
      "<w:t>_____________________________________________________________</w:t>",
      `<w:t>${xml(observacoes)}</w:t>`,
      "observações",
    );
  }
  const diversa = dados.vencimento_diverso?.trim();
  if (diversa) {
    cabeca = trocar(cabeca, "salvo indicação diversa: __________.", `salvo indicação diversa: ${xml(diversa)}.`, "vencimento diverso");
  }
  cabeca = cabeca.replaceAll("<w:highlight w:val=\"yellow\"/>", "");
  return cabeca + cauda;
}

function run(texto: string, estilo?: { negrito?: boolean; sublinhado?: boolean }) {
  const marcas = [
    estilo?.negrito ? "<w:b/><w:bCs/>" : "",
    estilo?.sublinhado ? "<w:u w:val=\"single\"/>" : "",
  ].join("");
  const espaco = texto.startsWith(" ") || texto.endsWith(" ") ? " xml:space=\"preserve\"" : "";
  return `<w:r>${marcas ? `<w:rPr>${marcas}</w:rPr>` : ""}<w:t${espaco}>${xml(texto)}</w:t></w:r>`;
}

function substituirParagrafo(origem: string, agulha: string, conteudo: string) {
  const indice = origem.indexOf(agulha);
  if (indice < 0) throw new AppError(500, "MODELO_DIVERGENTE", "O modelo do termo de adesão não tem o exemplo preenchido.");
  const inicio = origem.lastIndexOf("<w:p ", indice);
  const fim = origem.indexOf("</w:p>", indice);
  if (inicio < 0 || fim < 0) throw new AppError(500, "MODELO_DIVERGENTE", "O parágrafo do termo de adesão está incompleto.");
  const paragrafo = origem.slice(inicio, fim);
  const propriedades = paragrafo.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const abertura = paragrafo.slice(0, paragrafo.indexOf(">") + 1);
  const novo = `${abertura}${propriedades}${conteudo}</w:p>`;
  return origem.slice(0, inicio) + novo + origem.slice(fim + "</w:p>".length);
}

function recortarAdesao(documento: string) {
  const marcaTexto = "TERMO DE ADESÃO AO CONTRATO";
  const primeira = documento.indexOf(marcaTexto);
  const segunda = documento.indexOf(marcaTexto, primeira + marcaTexto.length);
  if (segunda < 0) throw new AppError(500, "MODELO_DIVERGENTE", "O modelo do aderente não tem o termo preenchido.");
  const inicio = documento.lastIndexOf("<w:p", segunda);
  const corpo = documento.indexOf("<w:body");
  const abre = documento.indexOf(">", corpo) + 1;
  return documento.slice(0, abre) + documento.slice(inicio);
}

function preencherAdesao(documento: string, dados: Extract<DocumentoGerado, { modelo: "adesao" }>) {
  let xmlDocumento = recortarAdesao(documento);
  const dataContrato = dataPorExtenso(dados.contrato_data);
  const dataAdesao = dataPorExtenso(dados.data);
  xmlDocumento = substituirParagrafo(
    xmlDocumento,
    "HABA COMERCIAL E APOIO ADMINISTRATIVO LTDA.",
    run(`ADERENTE: ${dados.razao_social.trim()}`, { negrito: true })
      + run(`, inscrita no CNPJ/ME sob o nº ${cnpj(dados.cnpj)}, com sede em ${dados.endereco.trim()}, e-mail de contato: ${dados.email.trim()}, neste ato representada na forma de seus atos constitutivos ("`)
      + run("Aderente", { sublinhado: true })
      + run("\")."),
  );
  xmlDocumento = substituirParagrafo(
    xmlDocumento,
    "Comercial Lumi Cosmeticos Ltda.",
    run(`CONSIDERANDO que, em ${dataContrato}, a DNA e `)
      + run(dados.contratante_razao.trim(), { negrito: true })
      + run(`, inscrita no CNPJ/ME sob o nº ${cnpj(dados.contratante_cnpj)} ("`)
      + run("Contratante", { sublinhado: true })
      + run("\"), celebraram o Contrato de Prestação de Serviços de Recrutamento e Seleção e de Cooperação para Concessão de Estágio (\"")
      + run("Contrato", { sublinhado: true })
      + run("\");"),
  );
  xmlDocumento = trocar(
    xmlDocumento,
    "2. Modalidades a que adere: (  ) Modalidade Contratação Direta     (   ) Modalidade Estágio          (X) Ambas.",
    `2. Modalidades a que adere: ${marca(dados.modalidade === "direta")} Modalidade Contratação Direta          ${marca(dados.modalidade === "estagio")} Modalidade Estágio          ${marca(dados.modalidade === "ambas")} Ambas.`,
    "modalidades da adesão",
  );
  xmlDocumento = trocar(
    xmlDocumento,
    "3. Condições comerciais aplicáveis: (X) as constantes do Anexo I do Contrato ( ) as constantes do Anexo I específico ora firmado pela Aderente.",
    `3. Condições comerciais aplicáveis: ${marca(dados.condicoes === "anexo_contrato")} as constantes do Anexo I do Contrato   ${marca(dados.condicoes === "anexo_especifico")} as constantes do Anexo I específico ora firmado pela Aderente.`,
    "condições comerciais",
  );
  xmlDocumento = substituirParagrafo(
    xmlDocumento,
    "MARCIA KAZUE MORITA GUSHIKEN",
    run("4. Dados da Aderente para faturamento e comunicações: responsável: ")
      + run(dados.responsavel.trim())
      + run(`; cargo: ${dados.cargo.trim()}; e-mail: ${dados.email_faturamento.trim()}; telefone: ${telefone(dados.telefone)}; endereço de faturamento ${dados.endereco_faturamento.trim()}.`),
  );
  xmlDocumento = trocar(xmlDocumento, "São Paulo, 22 de outubro de 2026", `${dados.local.trim()}, ${dataAdesao}`, "data da adesão");
  return xmlDocumento;
}

function validar(dados: DocumentoGerado) {
  if (dados.modelo === "adesao") return;
  const direta = dados.modalidade === "direta" || dados.modalidade === "ambas";
  const estagio = dados.modalidade === "estagio" || dados.modalidade === "ambas";
  const algumRegime = Object.entries(dados.regimes).some(([chave, valor]) => chave !== "outros_texto" && valor === true);
  exigir(!direta || Boolean(dados.taxa_recrutamento_percentual?.trim()), "Informe a taxa de recrutamento da contratação direta.");
  exigir(!direta || algumRegime, "Assinale ao menos um regime da contratação direta.");
  exigir(!direta || !dados.regimes.outros || Boolean(dados.regimes.outros_texto?.trim()), "Descreva o outro regime.");
  exigir(!direta || dados.garantia !== "sim" || Boolean(dados.garantia_dias?.replace(/\D/g, "")), "Informe o prazo da garantia de reposição.");
  exigir(!estagio || Boolean(dados.taxa_administrativa?.trim()), "Informe a taxa administrativa do estágio.");
  exigir(!estagio || Boolean(dados.taxa_recrutamento_estagio?.trim()), "Informe a taxa de recrutamento do estágio.");
  exigir(!estagio || dados.conversao_12 !== "percentual" || Boolean(dados.conversao_percentual?.trim()), "Informe o percentual da conversão após 12 meses.");
}

export async function gerarDocumento(dados: DocumentoGerado) {
  validar(dados);
  if (dados.modelo === "contrato") {
    const aberto = await abrir(MODELOS.contrato);
    const xmlDocumento = preencherContrato(aberto.xml, dados);
    return {
      buffer: await fechar(aberto.zip, xmlDocumento),
      filename: nomeArquivo("Contrato", dados.razao_social),
    };
  }
  const aberto = await abrir(MODELOS.adesao);
  const xmlDocumento = preencherAdesao(aberto.xml, dados);
  return {
    buffer: await fechar(aberto.zip, xmlDocumento),
    filename: nomeArquivo("Termo de adesao", dados.razao_social),
  };
}
