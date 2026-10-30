const FUSO = "America/Sao_Paulo";
const HORAS_SLOT = 6;

function partesEmSaoPaulo(data: Date) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(data)
      .map((parte) => [parte.type, parte.value]),
  );
  return { ano: partes.year, mes: partes.month, dia: partes.day, hora: Number(partes.hour), minuto: Number(partes.minute), segundo: Number(partes.second) };
}

/** Slot do relógio de São Paulo (00, 06, 12 ou 18), por exemplo "2026-10-29-12". */
export function slotDe(data: Date): string {
  const { ano, mes, dia, hora } = partesEmSaoPaulo(data);
  const inicio = Math.floor(hora / HORAS_SLOT) * HORAS_SLOT;
  return `${ano}-${mes}-${dia}-${String(inicio).padStart(2, "0")}`;
}

/** Milissegundos até o próximo slot (13:10 → 18:00). */
export function msAteProximoSlot(data: Date): number {
  const { hora, minuto, segundo } = partesEmSaoPaulo(data);
  const proximaHora = (Math.floor(hora / HORAS_SLOT) + 1) * HORAS_SLOT;
  const segundos = (proximaHora - hora) * 3600 - minuto * 60 - segundo;
  return segundos * 1000 - data.getMilliseconds();
}

/**
 * Roda a tarefa uma vez por slot. No start roda se o slot atual ainda não rodou neste processo
 * e agenda o próximo pelo relógio, não por um timer a partir do boot.
 */
export function agendarPorSlot(tarefa: (slot: string) => Promise<unknown>, onErro: (error: unknown) => void) {
  let ultimoSlot: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  const rodarSeNovo = async () => {
    const slot = slotDe(new Date());
    if (slot === ultimoSlot) return;
    ultimoSlot = slot;
    try {
      await tarefa(slot);
    } catch (error) {
      onErro(error);
    }
  };

  const agendar = () => {
    // +5 s para não cair um instante antes da virada do slot.
    timer = setTimeout(() => {
      void rodarSeNovo().finally(agendar);
    }, msAteProximoSlot(new Date()) + 5000);
    timer.unref();
  };

  void rodarSeNovo().finally(agendar);
  return () => {
    if (timer) clearTimeout(timer);
  };
}
