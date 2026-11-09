export const FUSO_REGUA = "America/Sao_Paulo";
export const HORA_REGUA = 8;

export function hojeNoFuso(agora = new Date(), fuso = FUSO_REGUA) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function partesNoFuso(agora: Date, fuso: string) {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  return { ano: valor("year"), mes: valor("month"), dia: valor("day"), hora: valor("hour"), minuto: valor("minute"), segundo: valor("second") };
}

function instanteNoFuso(ano: number, mes: number, dia: number, hora: number, fuso: string) {
  const tentativa = new Date(Date.UTC(ano, mes - 1, dia, hora + 3, 0, 0));
  const visto = partesNoFuso(tentativa, fuso);
  const ajuste = (hora - visto.hora) * 60 + (0 - visto.minuto);
  return new Date(tentativa.getTime() + ajuste * 60_000);
}

export function msAteProximaExecucao(agora = new Date(), hora = HORA_REGUA, fuso = FUSO_REGUA) {
  const atual = partesNoFuso(agora, fuso);
  const passou = atual.hora > hora || (atual.hora === hora && (atual.minuto > 0 || atual.segundo > 0));
  const alvo = passou
    ? instanteNoFuso(atual.ano, atual.mes, atual.dia + 1, hora, fuso)
    : instanteNoFuso(atual.ano, atual.mes, atual.dia, hora, fuso);
  return Math.max(0, alvo.getTime() - agora.getTime());
}

export function iniciarAgendaRegua(opcoes: {
  ativo: boolean;
  envioReal: boolean;
  executar: (hoje: string) => Promise<unknown>;
  erro?: (erro: unknown) => void;
  agora?: Date;
}) {
  if (!opcoes.ativo || !opcoes.envioReal) return { ativo: false, parar() {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disparar = () => {
    void opcoes.executar(hojeNoFuso()).catch((erro) => opcoes.erro?.(erro));
    timer = setTimeout(disparar, msAteProximaExecucao());
  };
  timer = setTimeout(disparar, msAteProximaExecucao(opcoes.agora));
  return { ativo: true, parar() { if (timer) clearTimeout(timer); } };
}
