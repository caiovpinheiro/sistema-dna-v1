export type NotaSugerida = {
  tipo: "Recorrente" | "Recrutamento";
  codigo: string;
  iss: number;
  descricao: string;
  valor: number;
};

const ESTAGIO: Omit<NotaSugerida, "valor"> = {
  tipo: "Recorrente",
  codigo: "03158",
  iss: 5,
  descricao: "Administração de estagiários",
};

const CLT: Omit<NotaSugerida, "valor"> = {
  tipo: "Recrutamento",
  codigo: "06475",
  iss: 5,
  descricao: "Recrutamento e Seleção",
};

function centavos(valor: number) {
  return Math.round(valor * 100);
}

/** Estágio vira administração de estagiários. Só CLT vira recrutamento e seleção. Os dois juntos saem em duas notas, somando o valor do boleto. */
export function notasSugeridas(valorBoleto: number, partes: { estagio: number; clt: number }) {
  const boleto = centavos(valorBoleto);
  const estagio = Math.max(0, centavos(partes.estagio));
  const clt = Math.max(0, centavos(partes.clt));
  if (boleto <= 0) return { notas: [] as NotaSugerida[], origem: "padrao" as const };
  if (clt > 0 && estagio === 0) return { notas: [{ ...CLT, valor: boleto / 100 }], origem: "clt" as const };
  if (estagio > 0 && clt === 0) return { notas: [{ ...ESTAGIO, valor: boleto / 100 }], origem: "estagio" as const };
  if (estagio > 0 && clt > 0) {
    const cltCent = Math.min(boleto, Math.round((boleto * clt) / (estagio + clt)));
    const estagioCent = boleto - cltCent;
    const notas = [
      estagioCent > 0 ? { ...ESTAGIO, valor: estagioCent / 100 } : null,
      cltCent > 0 ? { ...CLT, valor: cltCent / 100 } : null,
    ].filter((item): item is NotaSugerida => item !== null);
    return { notas, origem: "misto" as const };
  }
  return { notas: [{ ...ESTAGIO, valor: boleto / 100 }], origem: "padrao" as const };
}
