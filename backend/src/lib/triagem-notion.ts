const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** Blocos da página Operacional: toggle das vagas CLT do dia e o de Estágio Atualizado. */
const BLOCOS_RAIZ = ["37c828b5-2830-805a-b964-c25ebffcd1f3", "39e828b5-2830-8062-b1fd-ca9bcc310e75"];
const TIPOS_COM_FILHOS = new Set(["table", "toggle", "synced_block", "child_page", "column_list", "column", "heading_1", "heading_2", "heading_3"]);

export type VagaNotion = {
  horarios: string[];
  local: string | null;
  /** Usados pelo sync: linhas 🕐 originais e o local separado. */
  linhasHorario: string[];
  localPartes: LocalPartes | null;
};

type RichText = { plain_text?: string };
type Bloco = { id: string; type: string; has_children?: boolean } & Record<string, unknown>;

const CODIGO = /\b[A-Z]{2,5}-\d{3,5}\b/gi;
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const DIA = String.raw`(seg(?:unda)?|ter(?:[cç]a)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|s[aá]b(?:ado)?|dom(?:ingo|igo)?)(?:[\s-]*feira)?`;
const HORA = String.raw`(\d{1,2})(?:[:h](\d{2}))?\s*h?`;
const FAIXA_HORA = new RegExp(String.raw`${HORA}\s*(?:às|as|ás|a|até|-)\s*${HORA}`, "i");
const TRECHO = new RegExp(String.raw`${DIA}\s*(?:(?:à|a|á|até)\s*${DIA})?[\s,:–-]*(?:das\s+)?${HORA}\s*(?:às|as|ás|a|até|-)\s*${HORA}`, "gi");

let cache: { em: number; vagas: Map<string, VagaNotion> } | null = null;
let emAndamento: Promise<Map<string, VagaNotion>> | null = null;

function texto(rich: unknown): string {
  return Array.isArray(rich) ? (rich as RichText[]).map((parte) => parte.plain_text ?? "").join("") : "";
}

function indiceDoDia(raw: string): number {
  const norm = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ["seg", "ter", "qua", "qui", "sex", "sab", "dom"].findIndex((prefixo) => norm.startsWith(prefixo));
}

function hora(h: string, m: string | undefined) {
  const valor = Number(h);
  return valor >= 0 && valor <= 24 ? `${String(valor).padStart(2, "0")}:${m ?? "00"}` : null;
}

function folgaDe(linha: string): string {
  const match = linha.match(/(?:com\s+)?((?:uma|duas|\d+)\s+)?folgas?\b[^.;\n]*/i);
  if (!match) return "";
  const trecho = match[0].replace(/^com\s+/i, "").replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "");
  return trecho.charAt(0).toUpperCase() + trecho.slice(1);
}

/** Converte a linha 🕐 da Mensagem em "Segunda a sexta, 08:00 às 17:00 • Folga…". Sem padrão reconhecido, devolve a linha limpa. */
export function fraseHorario(linha: string): string | null {
  const limpa = linha.replace(/🕐/g, "").replace(/\s+/g, " ").trim().replace(/^[:\-–\s]+/, "");
  if (!limpa) return null;
  const partes: string[] = [];
  for (const match of limpa.matchAll(TRECHO)) {
    const inicio = indiceDoDia(match[1]);
    const fim = match[2] ? indiceDoDia(match[2]) : -1;
    const entrada = hora(match[3], match[4]);
    const saida = hora(match[5], match[6]);
    if (inicio < 0 || !entrada || !saida) continue;
    const dias = fim >= 0 && fim !== inicio ? `${DIAS[inicio]} a ${DIAS[fim].toLowerCase()}` : DIAS[inicio];
    partes.push(`${partes.length ? dias.charAt(0).toLowerCase() + dias.slice(1) : dias}, ${entrada} às ${saida}`);
  }
  if (!partes.length) {
    // Sem dia reconhecido ("6x1 das 13h30 ás 21h20"): mantém o texto, mas normaliza a faixa de horas.
    const faixa = limpa.match(FAIXA_HORA);
    const entrada = faixa ? hora(faixa[1], faixa[2]) : null;
    const saida = faixa ? hora(faixa[3], faixa[4]) : null;
    const base = faixa && entrada && saida ? limpa.replace(faixa[0], `${entrada} às ${saida}`) : limpa;
    return base.length > 160 ? `${base.slice(0, 157).trim()}…` : base.replace(/[.\s]+$/, "");
  }
  const folga = folgaDe(limpa);
  return folga ? `${partes.join("; ")} • ${folga}` : partes.join("; ");
}

function cidadeUfDoEndereco(endereco: string): { cidade: string; uf: string } | null {
  const porCampo = endereco.match(/Cidade:\s*([^\n/]+?)\s*\/\s*([A-Z]{2})\b/i);
  if (porCampo) return { cidade: porCampo[1].trim(), uf: porCampo[2].toUpperCase() };
  const porLinha = endereco.match(/[-–]\s*([^\n\-–/]+?)\s*\/\s*([A-Z]{2})\b/);
  if (porLinha) return { cidade: porLinha[1].trim(), uf: porLinha[2].toUpperCase() };
  const soCidade = endereco.match(/Cidade:\s*([^\n/]+)/i);
  return soCidade ? { cidade: soCidade[1].trim(), uf: "" } : null;
}

export type LocalPartes = { bairro: string; cidade: string; uf: string };

/** Bairro, cidade e UF da linha 📍, completando cidade e UF pelo endereço da linha. */
export function partesDoLocal(linha: string, endereco = ""): LocalPartes | null {
  const limpa = linha.replace(/📍/g, "").replace(/^\s*Bairro\s*:\s*/i, "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  if (!limpa) return null;
  // Formatos vistos: "Bairro - Cidade / UF", "Bairro - Cidade", "Bairro / Cidade", "Bairro / UF" e só "Bairro".
  const [bairroBruto, ...depoisDoTraco] = limpa.split(/\s+[-–]\s+/);
  const resto = depoisDoTraco.join(" - ");
  const [antesDaBarra, depoisDaBarra = ""] = (resto || bairroBruto).split(/\s*\/\s*/);
  const ufNaBarra = /^[A-Z]{2}$/i.test(depoisDaBarra.trim());
  const bairro = resto ? bairroBruto : antesDaBarra;
  let cidade = resto ? antesDaBarra : ufNaBarra ? "" : depoisDaBarra;
  let uf = ufNaBarra ? depoisDaBarra.trim().toUpperCase() : "";

  const doEndereco = cidadeUfDoEndereco(endereco);
  if (!cidade && doEndereco) cidade = doEndereco.cidade;
  if (!uf && doEndereco?.uf) uf = doEndereco.uf;
  return { bairro: bairro.trim(), cidade: cidade.trim(), uf };
}

export function formatarLocal(partes: LocalPartes): string {
  const cidadeUf = [partes.cidade, partes.uf].filter(Boolean).join(" / ");
  return cidadeUf ? `${partes.bairro} - ${cidadeUf}` : partes.bairro;
}

/** Bairro da linha 📍 no formato "Bairro - Cidade / UF". */
export function localDe(linha: string, endereco = ""): string | null {
  const partes = partesDoLocal(linha, endereco);
  return partes ? formatarLocal(partes) : null;
}

/** Numeração do Lightsail: 1 domingo, 2 segunda … 7 sábado. */
function numeroLightsail(indice: number) {
  return indice === 6 ? 1 : indice + 2;
}

export type Grade = {
  semanasInicio: number;
  semanasFim: number;
  entrada: string;
  saida: string;
  texto: string;
  refeicao: string | null;
  /** Dias (1 a 7) que recebem entrada e saída; os outros ficam '0'. */
  dias: number[];
  /** "Segunda a domingo" e a folga do texto, para juntar turnos. */
  diasTexto: string;
  folga: string;
};

/** Grade do Lightsail a partir da linha 🕐. Exige dois dias e duas horas; fora disso devolve null e nada é gravado. */
export function gradeDe(linha: string): Grade | null {
  const limpa = linha.replace(/🕐/g, "").replace(/\s+/g, " ").trim();
  const match = [...limpa.matchAll(TRECHO)].find((item) => item[2]);
  if (!match) return null;
  const inicioIndice = indiceDoDia(match[1]);
  const fimIndice = indiceDoDia(match[2]);
  const entrada = hora(match[3], match[4]);
  const saida = hora(match[5], match[6]);
  if (inicioIndice < 0 || fimIndice < 0 || !entrada || !saida) return null;
  const inicio = numeroLightsail(inicioIndice);
  const fim = numeroLightsail(fimIndice);
  const dias = [1, 2, 3, 4, 5, 6, 7].filter((numero) => fim >= inicio ? numero >= inicio && numero <= fim : numero >= inicio || numero <= fim);
  const minutos = limpa.match(/intervalos?\s+de\s+(\d{1,3})\s*(?:\([^)]*\)\s*)?min/i) ?? limpa.match(/(\d{1,3})\s*min(?:utos)?\s+de\s+(?:intervalo|almo[cç]o|pausa|refei[cç][aã]o)/i);
  const refeicao = minutos
    ? `${String(Math.floor(Number(minutos[1]) / 60)).padStart(2, "0")}:${String(Number(minutos[1]) % 60).padStart(2, "0")}`
    : null;
  const texto = (fraseHorario(limpa) ?? "").replace(/;/g, ",");
  const diasTexto = inicioIndice === fimIndice ? DIAS[inicioIndice] : `${DIAS[inicioIndice]} a ${DIAS[fimIndice].toLowerCase()}`;
  return { semanasInicio: inicio, semanasFim: fim, entrada, saida, texto, refeicao, dias, diasTexto, folga: folgaDe(limpa) };
}

export type Turnos = {
  /** Primeiro turno do Notion: vai para horabase, hora_saida_base e semanas. */
  principal: Grade;
  turnos: Grade[];
  /** Todos os turnos num texto só, por exemplo "Segunda a domingo, 07:00 às 15:20 ou 13:00 às 21:20 • Folgas alternadas". */
  texto: string;
  refeicao: string | null;
};

/** Junta os turnos das linhas 🕐. O Notion manda: o Lightsail não escolhe turno. Sem linha válida, devolve null. */
export function turnosDe(linhasHorario: string[]): Turnos | null {
  const grades = linhasHorario.map(gradeDe).filter((item): item is Grade => item !== null);
  const turnos = [...new Map(grades.map((grade) => [`${grade.semanasInicio}-${grade.semanasFim}-${grade.entrada}-${grade.saida}`, grade])).values()];
  if (!turnos.length) return null;
  const refeicao = turnos.find((turno) => turno.refeicao)?.refeicao ?? null;
  if (turnos.length === 1) return { principal: turnos[0], turnos, texto: turnos[0].texto, refeicao };
  const grupos = new Map<string, string[]>();
  for (const turno of turnos) grupos.set(turno.diasTexto, [...(grupos.get(turno.diasTexto) ?? []), `${turno.entrada} às ${turno.saida}`]);
  const corpo = [...grupos].map(([dias, faixas]) => `${dias}, ${faixas.join(" ou ")}`).join(" ou ");
  const folga = turnos.find((turno) => turno.folga)?.folga ?? "";
  return { principal: turnos[0], turnos, texto: folga ? `${corpo} • ${folga}` : corpo, refeicao };
}

/** Uma linha da tabela Operacional: códigos, horários (🕐) e local (📍). */
export function vagaDaLinha(celulas: string[]): { codigos: string[]; vaga: VagaNotion } | null {
  const preenchidas = celulas.filter((celula) => celula.trim());
  if (!preenchidas.length) return null;
  const mensagem = preenchidas.find((celula) => /📍|🕐/.test(celula)) ?? preenchidas[preenchidas.length - 1];
  const outras = celulas.filter((celula) => celula !== mensagem);
  const codigos = [...new Set([...outras, mensagem].flatMap((celula) => celula.match(CODIGO) ?? []).map((codigo) => codigo.toUpperCase()))];
  if (!codigos.length) return null;
  const linhas = mensagem.split(/\n/);
  const linhasHorario = linhas.filter((linha) => linha.includes("🕐"));
  const horarios = [...new Set(linhasHorario.map(fraseHorario).filter((item): item is string => Boolean(item)))];
  const endereco = outras.find((celula) => /endere[cç]o|empresa:|hor[aá]rio|cidade:/i.test(celula)) ?? outras.join("\n");
  const linhaLocal = linhas.find((linha) => linha.includes("📍"));
  const localPartes = linhaLocal ? partesDoLocal(linhaLocal, endereco) : null;
  return { codigos, vaga: { horarios, local: localPartes ? formatarLocal(localPartes) : null, linhasHorario, localPartes } };
}

async function filhos(id: string, token: string): Promise<Bloco[]> {
  const blocos: Bloco[] = [];
  let cursor: string | undefined;
  do {
    const url = `${NOTION_API}/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`notion ${response.status}`);
    const body = await response.json() as { results?: Bloco[]; has_more?: boolean; next_cursor?: string | null };
    blocos.push(...(body.results ?? []));
    cursor = body.has_more && body.next_cursor ? body.next_cursor : undefined;
  } while (cursor);
  return blocos;
}

/** Linhas de tabela na ordem da página, para que a última ocorrência de um código prevaleça. */
async function linhasDaArvore(id: string, token: string): Promise<string[][]> {
  const blocos = await filhos(id, token);
  const porBloco = await Promise.all(blocos.map(async (bloco) => {
    if (bloco.type === "table_row") {
      const cells = (bloco.table_row as { cells?: unknown[] } | undefined)?.cells ?? [];
      return [cells.map(texto)];
    }
    return bloco.has_children && TIPOS_COM_FILHOS.has(bloco.type) ? linhasDaArvore(bloco.id, token) : [];
  }));
  return porBloco.flat();
}

/** Lê a página Operacional sem cache. Lança erro se o Notion falhar: o sync não grava nada nesse caso. */
export async function lerNotion(token: string): Promise<Map<string, VagaNotion>> {
  return carregar(token);
}

async function carregar(token: string): Promise<Map<string, VagaNotion>> {
  const vagas = new Map<string, VagaNotion>();
  for (const raiz of BLOCOS_RAIZ) {
    for (const celulas of await linhasDaArvore(raiz, token)) {
      const linha = vagaDaLinha(celulas);
      if (!linha) continue;
      for (const codigo of linha.codigos) vagas.set(codigo, linha.vaga);
    }
  }
  return vagas;
}

/** Horário e local por código, lidos da página Operacional. Sem token ou com falha, devolve o cache anterior ou um mapa vazio. */
export async function vagasDoNotion(token: string): Promise<Map<string, VagaNotion>> {
  if (!token) return new Map();
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.vagas;
  emAndamento ??= carregar(token)
    .then((vagas) => {
      cache = { em: Date.now(), vagas };
      return vagas;
    })
    .catch(() => {
      // Tenta de novo em 1 minuto em vez de esperar o timeout a cada busca.
      cache = { em: Date.now() - CACHE_MS + 60_000, vagas: cache?.vagas ?? new Map<string, VagaNotion>() };
      return cache.vagas;
    })
    .finally(() => {
      emAndamento = null;
    });
  return emAndamento;
}
