import type { EnderecoExtraido } from "./perfil.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** CEP da busca da triagem a partir do currículo. Nunca vai para o JEV. */
export type CepDoCurriculo = {
  cep: string | null;
  /** "curriculo": CEP escrito no currículo. "endereco": único CEP do ViaCEP para a rua, cidade e UF escritas. */
  origem: "curriculo" | "endereco" | null;
  /** Endereço em uma linha, para o operador conferir. */
  endereco: string | null;
  /** Por que não houve CEP, quando o currículo tinha endereço. */
  motivo: string | null;
};

const SEM_CEP: CepDoCurriculo = { cep: null, origem: null, endereco: null, motivo: null };

function sem(texto: string | null | undefined) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tira o número e o complemento: "Rua X, 120 - apto 3" vira "Rua X". */
function soLogradouro(valor: string) {
  return valor.split(/,|\s+n[ºo°.]?\s*\d|\s+\d+\b|\s+-\s+/i)[0].trim();
}

function linha(endereco: EnderecoExtraido) {
  return [endereco.logradouro, endereco.bairro, [endereco.cidade, endereco.uf].filter(Boolean).join("/")].filter(Boolean).join(", ") || null;
}

/**
 * Usa o CEP escrito no currículo. Sem ele, procura no ViaCEP pela rua, cidade e UF e só aceita quando sobra um CEP
 * (filtrando pelo bairro, se houver). Vários CEPs possíveis ou falha da consulta deixam o campo para o operador.
 */
export async function cepDoCurriculo(endereco: EnderecoExtraido | null, fetcher: FetchLike = fetch): Promise<CepDoCurriculo> {
  if (!endereco) return SEM_CEP;
  const resumo = linha(endereco);
  if (endereco.cep) return { cep: endereco.cep, origem: "curriculo", endereco: resumo, motivo: null };
  const rua = endereco.logradouro ? soLogradouro(endereco.logradouro) : "";
  if (!rua || rua.length < 3 || !endereco.cidade || endereco.cidade.length < 3 || !endereco.uf) {
    return { ...SEM_CEP, endereco: resumo, motivo: resumo ? "O currículo não tem CEP nem rua, cidade e UF completos." : null };
  }
  const url = `https://viacep.com.br/ws/${encodeURIComponent(endereco.uf)}/${encodeURIComponent(endereco.cidade)}/${encodeURIComponent(rua)}/json/`;
  let lista: Array<{ cep?: string; bairro?: string }>;
  try {
    const resposta = await fetcher(url, { signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } });
    if (!resposta.ok) throw new Error(String(resposta.status));
    const corpo = await resposta.json();
    lista = Array.isArray(corpo) ? corpo : [];
  } catch {
    return { ...SEM_CEP, endereco: resumo, motivo: "Não foi possível consultar o CEP pelo endereço agora." };
  }
  const bairro = sem(endereco.bairro);
  const doBairro = bairro ? lista.filter((item) => sem(item.bairro) === bairro) : [];
  const candidatos = new Set((doBairro.length ? doBairro : lista).map((item) => String(item.cep ?? "").replace(/\D/g, "")).filter((cep) => cep.length === 8));
  if (candidatos.size === 1) return { cep: [...candidatos][0], origem: "endereco", endereco: resumo, motivo: null };
  return {
    ...SEM_CEP,
    endereco: resumo,
    motivo: candidatos.size ? `A rua tem ${candidatos.size} CEPs possíveis; confira o número da casa e digite o CEP.` : "Nenhum CEP encontrado para esse endereço.",
  };
}
