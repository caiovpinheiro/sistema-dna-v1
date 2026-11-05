/**
 * Cada dia da vaga é Fixo, Escala ou Folga. O Lightsail não tem coluna para escala: os horários continuam nos campos
 * de cada dia e a escala vai no texto do horário ("sábado e domingo por escala, 08:00 às 14:00").
 * Cópia em frontend/src/lib/horario-escala.ts: as duas precisam gerar o mesmo texto.
 */
export const DIAS_ESCALA = ["segunda", "terca", "quarta", "quinta", "sexta", "sab", "domingo"] as const;
export type DiaEscala = (typeof DIAS_ESCALA)[number];
export type ModoDia = "fixo" | "escala" | "folga";
export type DiaDoHorario = { modo: ModoDia; entrada: string; saida: string };

const NOMES = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const HORA = /^\d{2}:\d{2}$/;

function nomeDoGrupo(inicio: number, fim: number) {
  if (inicio === fim) return NOMES[inicio];
  return `${NOMES[inicio]} ${fim - inicio === 1 ? "e" : "a"} ${NOMES[fim]}`;
}

/** Dias em ordem (segunda a domingo). Junta dias seguidos com o mesmo modo e horário; folga e dia sem horário ficam fora. */
export function textoDoHorario(dias: DiaDoHorario[]): string {
  const partes: string[] = [];
  let inicio = -1;
  const fechar = (fim: number) => {
    if (inicio < 0) return;
    const dia = dias[inicio];
    const nome = nomeDoGrupo(inicio, fim);
    partes.push(dia.modo === "escala" ? `${nome} por escala, ${dia.entrada} às ${dia.saida}` : `${nome}, ${dia.entrada} às ${dia.saida}`);
    inicio = -1;
  };
  dias.forEach((dia, indice) => {
    const trabalha = dia.modo !== "folga" && HORA.test(dia.entrada) && HORA.test(dia.saida);
    const anterior = inicio >= 0 ? dias[inicio] : null;
    const continua = trabalha && anterior && anterior.modo === dia.modo && anterior.entrada === dia.entrada && anterior.saida === dia.saida;
    if (continua) return;
    fechar(indice - 1);
    if (trabalha) inicio = indice;
  });
  fechar(dias.length - 1);
  const texto = partes.join("; ");
  return (texto.charAt(0).toUpperCase() + texto.slice(1)).slice(0, 255);
}

/** Índices (0 segunda … 6 domingo) que o texto marca como "por escala", no formato gerado por textoDoHorario. */
export function diasPorEscala(texto: string | null | undefined): Set<number> {
  const dias = new Set<number>();
  const nome = "(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)";
  const busca = new RegExp(`${nome}(?:\\s+(a|e)\\s+${nome})?\\s+por escala`, "gi");
  const indice = (valor: string) => NOMES.indexOf(valor.toLowerCase().replace("terca", "terça").replace("sabado", "sábado"));
  for (const match of (texto ?? "").matchAll(busca)) {
    const inicio = indice(match[1]);
    const fim = match[3] ? indice(match[3]) : inicio;
    if (inicio < 0 || fim < 0) continue;
    for (let dia = inicio; dia <= fim; dia += 1) dias.add(dia);
  }
  return dias;
}
