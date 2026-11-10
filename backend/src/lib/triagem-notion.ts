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
const TRECHO = new RegExp(String.raw`${DIA}\s*(?:(?:à|a|á|até|e)\s*${DIA})?[\s,:–-]*(?:das\s+)?${HORA}\s*(?:às|as|ás|a|até|-)\s*${HORA}`, "gi");

let cache: { em: number; vagas: Map<string, VagaNotion> } | null = null;
let emAndamento: Promise<Map<string, VagaNotion>> | null = null;

function texto(rich: unknown): string {
  return Array.isArray(rich) ? (rich as RichText[]).map((parte) => parte.plain_text ?? "").join("") : "";
}

function indiceDoDia(raw: string): number {
  const norm = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ["seg", "ter", "qua", "qui", "sex", "sab", "dom"].findIndex((prefixo) => norm.startsWith(prefixo));
}

/** "Quarta e Quinta" e "Sexta e sábado" são dois dias seguidos; "e" entre dias não seguidos não vira intervalo. */
function intervaloValido(texto: string, inicio: number, fim: number) {
  if (!/\se\s/i.test(texto)) return true;
  return (fim - inicio + 7) % 7 === 1;
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
    const fim = match[2] && intervaloValido(match[0], inicio, indiceDoDia(match[2])) ? indiceDoDia(match[2]) : -1;
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

const ESTADOS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES",
  goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB",
  parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

/** UF sempre em sigla maiúscula: "Sp" vira "SP" e o nome do estado (inteiro ou cortado, como "São P") vira a sigla. */
export function normalizarUf(uf: string): string {
  const bruto = uf.trim();
  if (/^[a-z]{2}$/i.test(bruto)) return bruto.toUpperCase();
  const chave = bruto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
  if (chave.length < 3) return bruto;
  if (ESTADOS[chave]) return ESTADOS[chave];
  const achados = [...new Set(Object.entries(ESTADOS).filter(([nome]) => nome === chave || nome.startsWith(chave)).map(([, sigla]) => sigla))];
  return achados.length === 1 ? achados[0] : bruto;
}

export function formatarLocal(partes: LocalPartes): string {
  const cidadeUf = [partes.cidade, normalizarUf(partes.uf)].filter(Boolean).join(" / ");
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
  const trechos = [...limpa.matchAll(TRECHO)];
  // Prefere o trecho de vários dias; se a linha tem só um dia ("Domingo das 11h30 às 20h30"), usa esse.
  const match = trechos.find((item) => item[2]) ?? trechos[0];
  return match ? gradeDoTrecho(limpa, match, (fraseHorario(limpa) ?? "").replace(/;/g, ",")) : null;
}

/**
 * Todos os trechos da linha, um turno por trecho: "Quarta e Quinta: 16h às 00h00; Sexta e sábado das 16h00 às 01h30
 * e Domingo das 11h30 às 20h30" vira três turnos. Linha com um trecho só é igual a gradeDe.
 */
export function gradesDe(linha: string): Grade[] {
  const limpa = linha.replace(/🕐/g, "").replace(/\s+/g, " ").trim();
  const trechos = [...limpa.matchAll(TRECHO)];
  if (trechos.length <= 1) {
    const unica = gradeDe(linha);
    return unica ? [unica] : [];
  }
  return trechos
    .map((match) => gradeDoTrecho(limpa, match, (fraseHorario(match[0]) ?? "").replace(/;/g, ",")))
    .filter((grade): grade is Grade => grade !== null);
}

function gradeDoTrecho(limpa: string, match: RegExpMatchArray, texto: string): Grade | null {
  const inicioIndice = indiceDoDia(match[1]);
  const fimIndice = match[2] ? indiceDoDia(match[2]) : inicioIndice;
  const entrada = hora(match[3], match[4]);
  const saida = hora(match[5], match[6]);
  if (inicioIndice < 0 || fimIndice < 0 || !entrada || !saida) return null;
  if (match[2] && !intervaloValido(match[0], inicioIndice, fimIndice)) return null;
  const inicio = numeroLightsail(inicioIndice);
  const fim = numeroLightsail(fimIndice);
  const dias = [1, 2, 3, 4, 5, 6, 7].filter((numero) => fim >= inicio ? numero >= inicio && numero <= fim : numero >= inicio || numero <= fim);
  const minutos = limpa.match(/intervalos?\s+de\s+(\d{1,3})\s*(?:\([^)]*\)\s*)?min/i) ?? limpa.match(/(\d{1,3})\s*min(?:utos)?\s+de\s+(?:intervalo|almo[cç]o|pausa|refei[cç][aã]o)/i);
  const refeicao = minutos
    ? `${String(Math.floor(Number(minutos[1]) / 60)).padStart(2, "0")}:${String(Number(minutos[1]) % 60).padStart(2, "0")}`
    : null;
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
/** "A, B e C": partes da mesma semana (dias diferentes, horários diferentes). */
function juntarComE(partes: string[]) {
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0] ?? "";
}

export function turnosDe(linhasHorario: string[]): Turnos | null {
  // Cada linha 🕐 é um turno alternativo; cada trecho da linha é uma parte da semana desse turno.
  const porLinha = linhasHorario.map(gradesDe).filter((grades) => grades.length > 0);
  const grades = porLinha.flat();
  const turnos = [...new Map(grades.map((grade) => [`${grade.semanasInicio}-${grade.semanasFim}-${grade.entrada}-${grade.saida}`, grade])).values()];
  if (!turnos.length) return null;
  const refeicao = turnos.find((turno) => turno.refeicao)?.refeicao ?? null;
  // Principal = a semana de referência: o primeiro intervalo de vários dias; se não houver, o primeiro.
  const principal = turnos.find((turno) => turno.dias.length > 1) ?? turnos[0];
  if (turnos.length === 1) return { principal: turnos[0], turnos, texto: turnos[0].texto, refeicao };

  const parte = (turno: Grade) => `${turno.diasTexto}, ${turno.entrada} às ${turno.saida}`;
  const diasSeparados = turnos.every((turno, indice) => turnos.slice(indice + 1).every((outro) => !outro.dias.some((dia) => turno.dias.includes(dia))));
  let corpo: string;
  if (porLinha.length === 1 || (porLinha.every((linha) => linha.length === 1) && diasSeparados)) {
    // Uma semana só, com horários diferentes por dia: "Quarta a quinta, …, Sexta a sábado, … e Domingo, …".
    corpo = juntarComE(turnos.map(parte));
  } else {
    // Turnos alternativos: linhas de um trecho com os mesmos dias juntam as faixas ("Segunda a sábado, 08:30 às 14:00 ou 07:30 às 13:00");
    // linha com vários trechos fica inteira ("Segunda a sexta, … e Sábado, …"). Entre turnos, "ou".
    const segmentos: Array<{ dias: string | null; faixas: string[]; texto: string }> = [];
    for (const linha of porLinha) {
      if (linha.length > 1) {
        segmentos.push({ dias: null, faixas: [], texto: juntarComE(linha.map(parte)) });
        continue;
      }
      const [turno] = linha;
      const faixa = `${turno.entrada} às ${turno.saida}`;
      const existente = segmentos.find((segmento) => segmento.dias === turno.diasTexto);
      if (existente) {
        if (!existente.faixas.includes(faixa)) existente.faixas.push(faixa);
      } else segmentos.push({ dias: turno.diasTexto, faixas: [faixa], texto: "" });
    }
    corpo = segmentos.map((segmento) => (segmento.dias ? `${segmento.dias}, ${segmento.faixas.join(" ou ")}` : segmento.texto)).join(" ou ");
  }
  const folga = turnos.find((turno) => turno.folga)?.folga ?? "";
  return { principal, turnos, texto: folga ? `${corpo} • ${folga}` : corpo, refeicao };
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
