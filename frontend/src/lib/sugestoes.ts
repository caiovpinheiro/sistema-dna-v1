import type { Sugestao } from "@/components/busca-inteligente";
import { api } from "@/lib/api";
import { formatCnpj } from "@/lib/format";

/**
 * Sugestões da pesquisa inteligente: as primeiras linhas da própria lista, buscadas com o texto
 * digitado (o servidor aceita palavras em qualquer ordem e sem acento).
 */
const QTD = "6";

function juntar(...partes: Array<string | null | undefined>) {
  return partes.map((parte) => (parte ?? "").trim()).filter(Boolean).join(" · ");
}

export async function sugerirEmpresas(texto: string, signal: AbortSignal, comLink = true): Promise<Sugestao[]> {
  type Linha = { id_empresa: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string | null; cidade: string | null; uf: string | null };
  const resposta = await api<Linha[]>(`/api/v1/empresas?${new URLSearchParams({ q: texto, pageSize: QTD })}`, { signal });
  return resposta.data.map((empresa) => {
    const nome = (empresa.nome_fantasia || empresa.razao_social || "Empresa").trim();
    const razao = empresa.razao_social && empresa.razao_social.trim() !== nome ? empresa.razao_social : null;
    return {
      id: empresa.id_empresa,
      label: nome,
      detalhe: juntar(razao, empresa.cnpj ? formatCnpj(empresa.cnpj) : null, [empresa.cidade, empresa.uf].filter(Boolean).join("/")),
      href: comLink ? `/empresas/${empresa.id_empresa}` : undefined,
    };
  });
}

export async function sugerirCandidatos(texto: string, signal: AbortSignal): Promise<Sugestao[]> {
  type Linha = { id_candidato: string; nome: string; cidade: string | null; estado: string | null; empresa_nome?: string | null };
  const resposta = await api<Linha[]>(`/api/v1/candidatos?${new URLSearchParams({ nome: texto, pageSize: QTD })}`, { signal });
  return resposta.data.map((candidato) => ({
    id: candidato.id_candidato,
    label: candidato.nome,
    detalhe: juntar([candidato.cidade, candidato.estado].filter(Boolean).join("/"), candidato.empresa_nome),
    href: `/candidatos/${candidato.id_candidato}`,
  }));
}

/** Contratações (e Rescisão, que é a mesma lista com status ativo e outro destino). */
export async function sugerirContratacoes(texto: string, signal: AbortSignal, opcoes: { status?: string; rota?: (id: number) => string } = {}): Promise<Sugestao[]> {
  type Linha = { id_contratacao: number; candidato_nome: string | null; empresa_fantasia: string | null; empresa_razao: string | null; cargo: string | null };
  const filtro = new URLSearchParams({ q: texto, pageSize: QTD });
  if (opcoes.status) filtro.set("status", opcoes.status);
  const resposta = await api<Linha[]>(`/api/v1/contratacoes?${filtro}`, { signal });
  const rota = opcoes.rota ?? ((id: number) => `/contratacoes/${id}`);
  return resposta.data.map((contratacao) => ({
    id: String(contratacao.id_contratacao),
    label: contratacao.candidato_nome || "Candidato",
    detalhe: juntar(contratacao.cargo, contratacao.empresa_fantasia || contratacao.empresa_razao),
    href: rota(contratacao.id_contratacao),
  }));
}

export async function sugerirProcessos(texto: string, signal: AbortSignal): Promise<Sugestao[]> {
  type Linha = { id: string; candidato_nome: string | null; empresa_nome: string | null; cargo: string | null };
  const resposta = await api<Linha[]>(`/api/v1/processos?${new URLSearchParams({ nome: texto, pageSize: QTD })}`, { signal });
  return resposta.data.map((processo) => ({
    id: processo.id,
    label: processo.candidato_nome || "Candidato",
    detalhe: juntar(processo.cargo, processo.empresa_nome),
    href: `/processos/${processo.id}`,
  }));
}

/** Instituições não têm ficha: escolher a sugestão pesquisa pelo nome dela. */
export async function sugerirInstituicoes(texto: string, signal: AbortSignal): Promise<Sugestao[]> {
  type Linha = { cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; cidade: string | null; uf: string | null };
  const resposta = await api<Linha[]>(`/api/v1/instituicoes?${new URLSearchParams({ q: texto, pageSize: QTD })}`, { signal });
  return resposta.data.map((instituicao, indice) => {
    const nome = (instituicao.nome_fantasia || instituicao.razao_social || "Instituição").trim();
    return {
      id: `${instituicao.cnpj ?? ""}-${indice}`,
      label: nome,
      detalhe: juntar(instituicao.cnpj ? formatCnpj(instituicao.cnpj) : null, [instituicao.cidade, instituicao.uf].filter(Boolean).join("/")),
    };
  });
}

/** Documentos pendentes: nomes de candidatos com pendência (sem repetir); escolher pesquisa pelo nome. */
export async function sugerirCandidatosComPendencia(texto: string, signal: AbortSignal): Promise<Sugestao[]> {
  type Linha = { nome: string | null; empresa: string | null };
  const resposta = await api<Linha[]>(`/api/v1/documentos-pendentes?${new URLSearchParams({ candidato: texto, pageSize: "30" })}`, { signal });
  const vistos = new Map<string, Sugestao>();
  for (const linha of resposta.data) {
    const nome = (linha.nome ?? "").trim();
    if (!nome || vistos.has(nome.toLowerCase())) continue;
    vistos.set(nome.toLowerCase(), { id: nome.toLowerCase(), label: nome, detalhe: linha.empresa ?? undefined });
  }
  return [...vistos.values()];
}
