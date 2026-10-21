export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (length: number) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cnpj[index]) * weights[index];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
}

export function isValidPhone(value: string): boolean {
  return /^\d{10,11}$/.test(value);
}

export function isValidCep(value: string): boolean {
  return /^\d{8}$/.test(value);
}

export type Regime = "clt" | "estagio" | "outro";

export function classifyRegime(descricao: string | null | undefined): Regime {
  const text = (descricao ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\bestagio\b/.test(text) || text.includes("estagio")) return "estagio";
  if (/\bclt\b/.test(text)) return "clt";
  return "outro";
}
