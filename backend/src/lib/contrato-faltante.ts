/**
 * Contratos da entrada que ainda não voltaram assinados ("contrato faltante").
 * A rescisão não depende deles: a tela só avisa e deixa seguir.
 *
 * Regra do sistema antigo (a mesma da tela Documentos pendentes): documento do candidato
 * (`contratos_diversos.tipo = 'Candidato'`) que pede devolução (`devolucao = '1'`),
 * não marcado como errado (`status = '3'`) e ainda não devolvido (`devolvido` 0 ou vazio).
 * TCE gerado no sistema novo: falta enquanto não estiver assinado nem cancelado.
 */

export type ContratoAntigo = {
  id: number | string;
  nome: string | null;
  data: string | null;
  status: string | number | null;
  devolvido: string | number | null;
  tipo: string | null;
  devolucao: string | number | null;
  texto: string | null;
};

export type TermoNovo = {
  id: number | string;
  nome: string | null;
  status: string | null;
  criado_em: string | null;
};

export type ContratoFaltante = {
  id: string;
  origem: "historico" | "termo";
  nome: string;
  data: string | null;
  situacao: string;
  texto: string | null;
};

const texto = (valor: unknown) => (valor == null ? "" : String(valor).trim());

export function contratoAntigoFaltando(item: ContratoAntigo): boolean {
  if (texto(item.status) === "3") return false;
  if (texto(item.tipo) !== "Candidato") return false;
  if (texto(item.devolucao) !== "1") return false;
  const devolvido = texto(item.devolvido);
  return devolvido === "" || devolvido === "0";
}

export function termoFaltando(item: TermoNovo): boolean {
  const status = texto(item.status).toLowerCase();
  return status !== "assinado" && status !== "cancelado";
}

export function contratosFaltantes(antigos: ContratoAntigo[], termos: TermoNovo[]): ContratoFaltante[] {
  return [
    ...termos.filter(termoFaltando).map((item) => ({
      id: String(item.id),
      origem: "termo" as const,
      nome: texto(item.nome) || "Termo de compromisso de estágio",
      data: item.criado_em,
      situacao: texto(item.status) === "enviado" ? "Enviado, aguardando assinatura" : "Ainda não enviado para assinatura",
      texto: null,
    })),
    ...antigos.filter(contratoAntigoFaltando).map((item) => ({
      id: String(item.id),
      origem: "historico" as const,
      nome: texto(item.nome) || "Documento",
      data: item.data,
      situacao: "Não devolvido assinado",
      texto: item.texto,
    })),
  ];
}
