export function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function formatCpf(value: string | null | undefined): string {
  const raw = digits(value ?? "");
  if (raw.length !== 11) return value || "—";
  return raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatCnpj(value: string | null | undefined): string {
  const raw = digits(value ?? "");
  if (raw.length !== 14) return value || "—";
  return raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function formatPhone(value: string | null | undefined): string {
  const raw = digits(value ?? "");
  if (raw.length === 11) return raw.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (raw.length === 10) return raw.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value || "—";
}

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dateBr(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).replaceAll("/", "-").split("-");
  if (!year || !month || !day || year.length < 4) return value;
  return `${day}/${month}/${year}`;
}

export const regimeLabel: Record<string, string> = { clt: "CLT", estagio: "Estágio", outro: "Outro" };
export const origemLabel: Record<string, string> = { dnawork: "Captado pela DNAWORK", empresa: "Enviado pela empresa" };
export const etapaLabel: Record<string, string> = {
  recebido: "Recebido",
  encaminhado: "Encaminhado",
  entrevista_agendada: "Entrevista agendada",
  entrevista_realizada: "Entrevista realizada",
  contratado: "Contratado",
  reprovado: "Reprovado",
  desistente: "Desistente",
};
export function textoPlano(valor: string | null | undefined) {
  return (valor ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const statusVagaLabel: Record<number, string> = {
  0: "Aberta",
  1: "Ocupada",
  2: "Suspensa",
  3: "Stand by",
  4: "Em andamento",
  5: "Encerrada",
};

export const situacaoLabel: Record<string, string> = {
  aberta: "Aberta",
  preenchida: "Preenchida",
  encerrada: "Encerrada",
  capacidade_pendente: "Capacidade pendente",
  ativa: "Ativa",
  indefinida: "Indefinida",
  sem_vinculo: "Sem vínculo",
  ativo: "Ativo",
};
