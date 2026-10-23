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
