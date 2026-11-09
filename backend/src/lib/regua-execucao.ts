import type { AcaoPlanejada, FaturaEnvio } from "./regua.js";

export type ResultadoDisparo = {
  enviados: number;
  falhas: number;
  duplicados: number;
  marcos: number;
  encaminhados: number;
};

export async function dispararRegua(acoes: AcaoPlanejada[], deps: {
  reservar: (chave: string) => Promise<boolean>;
  enviar: (acao: AcaoPlanejada) => Promise<void>;
  concluir: (acao: AcaoPlanejada, status: "enviado" | "falha" | "marco" | "encaminhado", detalhe?: string) => Promise<void>;
}): Promise<ResultadoDisparo> {
  const resultado: ResultadoDisparo = { enviados: 0, falhas: 0, duplicados: 0, marcos: 0, encaminhados: 0 };
  for (const acao of acoes) {
    const alvos = acao.faturas?.length ? acao.faturas : [{ chave: acao.chave, id_cobranca: acao.id_cobranca, empresa: acao.empresa, valor: acao.valor, vencimento: acao.vencimento, link: null }];
    const reservados: FaturaEnvio[] = [];
    for (const alvo of alvos) {
      if (await deps.reservar(alvo.chave)) reservados.push(alvo);
      else resultado.duplicados += 1;
    }
    if (!reservados.length) continue;
    const envio = { ...acao, faturas: reservados, valor: reservados.reduce((total, alvo) => total + alvo.valor, 0) };
    const concluir = (status: "enviado" | "falha" | "marco" | "encaminhado", detalhe?: string) => Promise.all(reservados.map((alvo) => deps.concluir({ ...acao, chave: alvo.chave, id_cobranca: alvo.id_cobranca, empresa: alvo.empresa, faturas: [alvo] }, status, detalhe)));
    if (acao.tipo === "marco") {
      await concluir("marco");
      resultado.marcos += reservados.length;
      continue;
    }
    if (acao.tipo === "encaminhar") {
      await concluir("encaminhado");
      resultado.encaminhados += reservados.length;
      continue;
    }
    try {
      await deps.enviar(envio);
      await concluir("enviado");
      resultado.enviados += 1;
    } catch (error) {
      await concluir("falha", error instanceof Error ? error.message : "Falha ao enviar.");
      resultado.falhas += 1;
    }
  }
  return resultado;
}
