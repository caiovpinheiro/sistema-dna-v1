const WEBHOOK_URL = "https://sistema.dnawork.ai/webhook/empresa.php";
const CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;

type VagaWebhook = Record<string, unknown> & { codigo?: string };
type EmpresaWebhook = { vagas?: VagaWebhook[] };

const DIAS = [
  { nome: "Segunda", campo: "segunda" },
  { nome: "Terça", campo: "terca" },
  { nome: "Quarta", campo: "quarta" },
  { nome: "Quinta", campo: "quinta" },
  { nome: "Sexta", campo: "sexta" },
  { nome: "Sábado", campo: "sab" },
  { nome: "Domingo", campo: "domindo" },
] as const;

let cache: { em: number; horarios: Map<string, string> } | null = null;
let emAndamento: Promise<Map<string, string>> | null = null;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hora(value: unknown): string {
  const raw = texto(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function indiceDoDia(value: unknown): number {
  const raw = texto(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const prefixos = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
  return prefixos.findIndex((prefixo) => raw.startsWith(prefixo));
}

/** Trecho de folga escrito no texto_carga, por exemplo "com folgas alternadas". */
function folgaDoTexto(textoCarga: string): string {
  const match = textoCarga.match(/(com\s+)?((uma|duas|\d+)\s+)?folgas?\b[^.?;]*/i);
  if (!match) return "";
  let trecho = match[0].replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "");
  if (trecho.length > 120) trecho = `${trecho.slice(0, 117).trim()}…`;
  trecho = trecho.charAt(0).toLowerCase() + trecho.slice(1);
  return trecho.startsWith("com ") ? trecho : `com ${trecho}`;
}

export function formatarHorario(vaga: VagaWebhook): string | null {
  const base = { entrada: hora(vaga.horabase), saida: hora(vaga.hora_saida_base) };
  const inicio = indiceDoDia(vaga.semanas_inicio);
  const fim = indiceDoDia(vaga.semanas_fim);
  const noIntervalo = new Set<number>();
  if (inicio >= 0 && fim >= 0) {
    // Início igual ao fim vem do cadastro antigo como "semana inteira", não como um dia só.
    const ultimo = fim === inicio ? (inicio + 6) % 7 : fim;
    for (let dia = inicio; ; dia = (dia + 1) % 7) {
      noIntervalo.add(dia);
      if (dia === ultimo) break;
    }
  }

  const porDia = DIAS.map((dia, indice) => {
    const entradaPropria = hora(vaga[`${dia.campo}_entrada`] ?? (dia.campo === "domindo" ? vaga.domingo_entrada : undefined));
    const saidaPropria = hora(vaga[`${dia.campo}_saida`] ?? (dia.campo === "domindo" ? vaga.domingo_saida : undefined));
    if (!noIntervalo.has(indice) && !entradaPropria && !saidaPropria) return null;
    const entrada = entradaPropria || base.entrada;
    const saida = saidaPropria || base.saida;
    return entrada && saida ? `${entrada} às ${saida}` : null;
  });

  const grupos: Array<{ de: number; ate: number; faixa: string }> = [];
  porDia.forEach((faixa, indice) => {
    if (!faixa) return;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.ate === indice - 1 && ultimo.faixa === faixa) ultimo.ate = indice;
    else grupos.push({ de: indice, ate: indice, faixa });
  });
  if (!grupos.length) return null;

  const partes = grupos.map((grupo, posicao) => {
    const primeiro = DIAS[grupo.de].nome;
    const dias = grupo.de === grupo.ate ? primeiro : `${primeiro} a ${DIAS[grupo.ate].nome.toLowerCase()}`;
    return `${posicao === 0 ? dias : dias.charAt(0).toLowerCase() + dias.slice(1)}, ${grupo.faixa}`;
  });
  let resultado = partes.join("; ");

  const diasTrabalhados = porDia.filter(Boolean).length;
  const folga = folgaDoTexto(texto(vaga.texto_carga));
  if (folga) resultado += `, ${folga}`;
  else if (diasTrabalhados >= 6) resultado += ", com folga na semana";
  return resultado;
}

function parseWebhook(corpo: string): EmpresaWebhook[] {
  const inicio = corpo.search(/[[{]/);
  if (inicio < 0) return [];
  const json = JSON.parse(corpo.slice(inicio)) as unknown;
  if (Array.isArray(json)) return json as EmpresaWebhook[];
  if (json && typeof json === "object") return Object.values(json as Record<string, EmpresaWebhook>);
  return [];
}

async function carregar(): Promise<Map<string, string>> {
  const response = await fetch(WEBHOOK_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`webhook ${response.status}`);
  const horarios = new Map<string, string>();
  for (const empresa of parseWebhook(await response.text())) {
    for (const vaga of empresa.vagas ?? []) {
      const codigo = texto(vaga.codigo).toUpperCase();
      if (!codigo || horarios.has(codigo)) continue;
      const horario = formatarHorario(vaga);
      if (horario) horarios.set(codigo, horario);
    }
  }
  return horarios;
}

/** Horários por código de vaga. Se o webhook falhar, segue com o cache anterior ou sem horário. */
export async function horariosPorCodigo(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.horarios;
  emAndamento ??= carregar()
    .then((horarios) => {
      cache = { em: Date.now(), horarios };
      return horarios;
    })
    .catch(() => {
      // Tenta de novo em 1 minuto em vez de esperar o timeout a cada busca.
      cache = { em: Date.now() - CACHE_MS + 60_000, horarios: cache?.horarios ?? new Map<string, string>() };
      return cache.horarios;
    })
    .finally(() => {
      emAndamento = null;
    });
  return emAndamento;
}
