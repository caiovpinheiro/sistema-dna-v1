/** Lógica pura da triagem (sem React e sem imports com "@/"), para ser testada com node:test. */

export type Tipo = "CLT" | "Estágio";

export type Vaga = {
  id: string;
  title: string;
  company: string;
  location: string;
  contractType: string;
  salaryLabel: string;
  hasBenefits: boolean;
  homeOffice?: boolean;
  schedule: string | null;
  schedules: string[];
  distanceKm: number;
};

export const ESCOLARIDADES = {
  medio_incompleto: "Ensino médio incompleto",
  medio_completo: "Ensino médio completo",
  cursando_medio: "Cursando ensino médio",
  cursando_superior: "Cursando ensino superior",
  superior_completo: "Ensino superior completo",
} as const;
export type Escolaridade = keyof typeof ESCOLARIDADES;

export const TURNOS = { manha: "Manhã", tarde: "Tarde", noite: "Noite" } as const;
export type Turno = keyof typeof TURNOS;

export type PerfilProfissional = {
  escolaridade: Escolaridade | "";
  /** Só quando a escolaridade é "cursando ensino médio". */
  turnoEstudo: Turno | "";
  tempoExperiencia: string;
  habilidades: string;
  turno: Turno | "";
  /** Texto do currículo analisado pela Luna. Vai para o JEV; não é editado na tela. */
  curriculo: string;
};

export const PERFIL_VAZIO: PerfilProfissional = {
  escolaridade: "", turnoEstudo: "", tempoExperiencia: "", habilidades: "", turno: "", curriculo: "",
};

export type Escala = { min: number; max: number };

export type AvaliacaoJev = {
  score: number;
  escala: Escala;
  confianca: number | null;
  nivel: string | null;
  descricaoNivel: string | null;
  probabilidadeNivel: number | null;
  probabilidades: Record<string, number> | null;
  legenda: Record<string, string>;
  modelo: string | null;
  justificativa: string | null;
  evidencias: string[];
  lacunas: string[];
};

export type Explicacao = {
  origem: "dna_work_comparacao_textual";
  aviso: string;
  favoraveis: Array<{ trecho: string; termos: string[] }>;
  naoComprovados: string[];
  notas: string[];
};

export type StatusAvaliacao = "avaliada" | "indisponivel" | "dados_insuficientes" | "falhou" | "resposta_invalida" | "nao_encontrada";

export type AvaliacaoVaga = {
  id: string;
  status: StatusAvaliacao;
  motivo: string | null;
  jev: AvaliacaoJev | null;
  explicacao: Explicacao | null;
};

export type Avaliacoes = Record<string, AvaliacaoVaga>;

export type VagaComAvaliacao = Vaga & { avaliacao: AvaliacaoVaga | null };

export type Organizado = {
  /** Avaliadas pelo JEV, da maior para a menor compatibilidade; empate pela distância. */
  avaliadas: VagaComAvaliacao[];
  /** Analisadas mas sem score: JEV indisponível, falha, resposta inválida ou dados insuficientes. */
  semAvaliacao: VagaComAvaliacao[];
  /** Ainda não enviadas para análise, na ordem de distância. */
  pendentes: VagaComAvaliacao[];
};

/** Junta o lote novo ao que já havia. A avaliação mais recente da mesma vaga substitui a anterior. */
export function mesclarAvaliacoes(atuais: Avaliacoes, novas: AvaliacaoVaga[]): Avaliacoes {
  const saida = { ...atuais };
  for (const avaliacao of novas) saida[avaliacao.id] = avaliacao;
  return saida;
}

/** Posição relativa na escala do próprio JEV (0 a 1), só para comparar avaliações de escalas diferentes. */
export function posicaoNaEscala(jev: AvaliacaoJev): number {
  const largura = jev.escala.max - jev.escala.min;
  return largura > 0 ? (jev.score - jev.escala.min) / largura : jev.score;
}

function semRepetir(vagas: Vaga[]): Vaga[] {
  const vistos = new Set<string>();
  return vagas.filter((vaga) => (vistos.has(vaga.id) ? false : (vistos.add(vaga.id), true)));
}

export function organizarVagas(vagas: Vaga[], avaliacoes: Avaliacoes): Organizado {
  const organizado: Organizado = { avaliadas: [], semAvaliacao: [], pendentes: [] };
  for (const vaga of semRepetir(vagas)) {
    const avaliacao = avaliacoes[vaga.id] ?? null;
    const item = { ...vaga, avaliacao };
    if (!avaliacao) organizado.pendentes.push(item);
    else if (avaliacao.status === "avaliada" && avaliacao.jev) organizado.avaliadas.push(item);
    else organizado.semAvaliacao.push(item);
  }
  organizado.avaliadas.sort((a, b) => {
    const diferenca = posicaoNaEscala(b.avaliacao!.jev!) - posicaoNaEscala(a.avaliacao!.jev!);
    if (diferenca !== 0) return diferenca;
    return a.distanceKm - b.distanceKm || a.id.localeCompare(b.id);
  });
  return organizado;
}

/** Ordem em que as vagas aparecem na tela: avaliadas, depois sem avaliação, depois pendentes. */
export function ordemDeExibicao(organizado: Organizado): VagaComAvaliacao[] {
  return [...organizado.avaliadas, ...organizado.semAvaliacao, ...organizado.pendentes];
}

/** Próximas vagas para analisar: as ainda não avaliadas, mais próximas primeiro. */
export function proximoLote(vagas: Vaga[], avaliacoes: Avaliacoes, tamanho: number): string[] {
  return semRepetir(vagas).filter((vaga) => !avaliacoes[vaga.id]).slice(0, Math.max(1, tamanho)).map((vaga) => vaga.id);
}

/** Vagas cuja análise falhou e podem ser tentadas de novo. */
export function idsParaRepetir(avaliacoes: Avaliacoes): string[] {
  return Object.values(avaliacoes).filter((item) => item.status === "falhou").map((item) => item.id);
}

/** Seleção é por id: reordenar ou analisar mais não desmarca nada. Só some o que saiu do resultado. */
export function selecaoValida(marcadas: string[], vagas: Vaga[]): string[] {
  const existentes = new Set(vagas.map((vaga) => vaga.id));
  return [...new Set(marcadas)].filter((id) => existentes.has(id));
}

export function selecionadasNaOrdem<T extends Vaga>(ordem: T[], marcadas: string[]): T[] {
  const conjunto = new Set(marcadas);
  return ordem.filter((vaga) => conjunto.has(vaga.id));
}

/** Mesma regra do backend: currículo analisado ou, sem ele, habilidades informadas. */
export function perfilPreenchido(perfil: PerfilProfissional): boolean {
  return perfil.curriculo.trim().length >= 30 || perfil.habilidades.trim().length >= 3;
}

/** Problema que impede a busca inteligente, ou null. */
export function problemaDoPerfil(perfil: PerfilProfissional): string | null {
  if (perfil.escolaridade === "cursando_medio" && !perfil.turnoEstudo) return "Informe o turno em que a pessoa estuda.";
  if (!perfilPreenchido(perfil)) return "Na busca inteligente, envie o currículo ou informe as habilidades, ou volte para a busca rápida.";
  return null;
}

/** Turnos da pessoa para mostrar ao lado do horário da vaga. Não entram no score. */
export function rotuloTurnos(perfil: PerfilProfissional): string | null {
  const partes = [];
  if (perfil.turno) partes.push(`disponível: ${TURNOS[perfil.turno].toLowerCase()}`);
  if (perfil.escolaridade === "cursando_medio" && perfil.turnoEstudo) partes.push(`estuda: ${TURNOS[perfil.turnoEstudo].toLowerCase()}`);
  return partes.length ? `Turno da pessoa — ${partes.join(" · ")}` : null;
}

const decimal = (valor: number, casas = 2) => valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });

/** "2,32 de 0–4": mostra o score na escala do JEV, sem converter para porcentagem. */
export function rotuloScore(jev: AvaliacaoJev): string {
  return `${decimal(jev.score)} (escala ${decimal(jev.escala.min, 0)}–${decimal(jev.escala.max, 0)})`;
}

export function rotuloConfianca(confianca: number | null): string | null {
  return confianca == null ? null : `confiança ${decimal(confianca)}`;
}

export const ROTULO_STATUS: Record<StatusAvaliacao, string> = {
  avaliada: "Avaliada pelo JEV",
  indisponivel: "Avaliação indisponível",
  dados_insuficientes: "Dados insuficientes",
  falhou: "Falha na avaliação",
  resposta_invalida: "Resposta do JEV descartada",
  nao_encontrada: "Vaga não encontrada",
};

function nomeDoTipo(tipo: string) {
  return tipo.toLowerCase().startsWith("est") ? "estágio" : "CLT";
}

export function textoParaCandidato(vagas: Vaga[]) {
  if (!vagas.length) return "";
  const tipos = [...new Set(vagas.map((vaga) => nomeDoTipo(vaga.contractType)))];
  const deTipo = tipos.length === 1 ? ` de ${tipos[0]}` : "";
  const abertura = vagas.length === 1
    ? `✨ Encontrei esta vaga${deTipo} próxima de você:`
    : `✨ Encontrei estas vagas${deTipo} próximas de você:`;
  const linhas = vagas.map((vaga, indice) => {
    const partes = [`${indice + 1}. ${vaga.title}`];
    if (vaga.location) partes.push(`📍 ${vaga.location}`);
    for (const horario of vaga.schedules) partes.push(`🕒 ${horario}`);
    if (vaga.homeOffice) partes.push("🏠 Home office");
    partes.push(`💰 ${vaga.salaryLabel}${vaga.hasBenefits ? " + benefícios" : ""}`);
    return partes.join("\n");
  });
  const fechamento = vagas.length === 1 ? "Possui interesse?" : "Possui interesse? Se sim, nos informe o número da vaga.";
  return [abertura, ...linhas, fechamento].join("\n\n");
}
