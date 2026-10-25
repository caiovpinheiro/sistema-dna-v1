export const ETAPAS = [
  "recebido",
  "encaminhado",
  "entrevista_agendada",
  "entrevista_realizada",
  "contratado",
  "reprovado",
  "desistente",
] as const;

export type Etapa = (typeof ETAPAS)[number];
export type Origem = "dnawork" | "empresa";

const TRILHA: Etapa[] = ["recebido", "encaminhado", "entrevista_agendada", "entrevista_realizada", "contratado"];
const FINAIS = new Set<Etapa>(["contratado", "reprovado", "desistente"]);

export function etapaInicial(origem: Origem, dataEncaminhamento: string | null): Etapa {
  if (origem === "dnawork") return "encaminhado";
  return dataEncaminhamento ? "encaminhado" : "recebido";
}

export function podeMover(atual: Etapa, proxima: Etapa): boolean {
  if (atual === proxima || FINAIS.has(atual) || proxima === "contratado") return false;
  if (proxima === "reprovado" || proxima === "desistente") return true;
  return TRILHA.indexOf(proxima) > TRILHA.indexOf(atual);
}

export function taxaConversao(contratados: number, entrada: number): number | null {
  if (entrada <= 0) return null;
  return Math.round((contratados / entrada) * 1000) / 10;
}
