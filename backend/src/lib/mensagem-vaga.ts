import { moneyToNumber } from "./money.js";

/** Dados da vaga usados na mensagem para o candidato. */
export type DadosMensagemVaga = {
  cargo: string | null;
  bairro: string | null;
  cidade: string | null;
  salario: string | number | null;
  beneficios: string | null;
  horario: string | null;
};

function limpar(valor: string | null | undefined) {
  return (valor ?? "").replace(/\s+/g, " ").trim();
}

function semPontoFinal(valor: string) {
  return valor.replace(/[.;\s]+$/, "");
}

/** "R$ 2.137,60"; sem salário (vazio ou zero), "a combinar". */
function salarioTexto(valor: string | number | null) {
  const numero = typeof valor === "number" ? valor : moneyToNumber(String(valor ?? ""));
  if (numero == null || !Number.isFinite(numero) || numero <= 0) return "a combinar";
  return numero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/ /g, " ");
}

/**
 * Um benefício por linha. No formato do sync ("Auxílio Transporte — R$ 10,00 — Mensal") fica o nome e o valor;
 * a periodicidade sai. Texto livre ("VR R$33,00 o dia") fica como está.
 */
function beneficiosTexto(valor: string | null) {
  return (valor ?? "")
    .split(/\r?\n/)
    .map((linha) => {
      const partes = linha.split(" — ").map((parte) => parte.trim()).filter(Boolean);
      const semPeriodo = partes.filter((parte, indice) => indice === 0 || !/^(mensal|di[aá]rio|semanal)$/i.test(parte));
      return semPontoFinal(limpar(semPeriodo.join(" ")));
    })
    .filter(Boolean);
}

/**
 * Mensagem para o candidato no formato usado no Notion:
 * cargo, bairro / cidade, salário + benefícios e horário.
 */
export function mensagemDaVaga(dados: DadosMensagemVaga): string {
  const linhas = ["Encontramos oportunidades com o seu perfil. Dá uma olhada:", limpar(dados.cargo) || "Vaga"];
  const local = [limpar(dados.bairro), limpar(dados.cidade)].filter(Boolean).join(" / ");
  if (local) linhas.push(`📍 ${local}`);
  linhas.push(`💰Salário: ${[salarioTexto(dados.salario), ...beneficiosTexto(dados.beneficios)].join(" + ")}.`);
  const horario = semPontoFinal(limpar(dados.horario));
  if (horario) linhas.push(`🕐 ${horario}.`);
  return linhas.join("\n");
}
