/** Títulos lidos do scraping Pandapé (node 1) para os IDs já gravados como Infojobs {id}. */
export const INFOJOBS_VACANCY_TITLES: Record<string, string> = {
  '3735541': 'Operador de Loja - Estágio Ensino médio',
  '3735530': 'Padeiro',
  '3723042': 'Atendente',
  '3723018': 'Operador de Loja',
  '3722924': 'Estágio Auxiliar de Produção',
  '3722085': 'Auxiliar Administrativo',
  '3686557': 'Auxiliar de Produção',
  '3647515': 'Operador de Caixa',
  '3609340': 'Repositor de Mercadorias',
  '3607377': 'Padeiro',
  '3607132': 'Operador de Caixa - Estágio Ensino médio',
  '3607006': 'Operador de Loja - Estágio Ensino médio',
  '3606392': 'Operador de Loja - Estágio ensino médio',
};

export function infojobsVacancyId(value?: string | null): string | null {
  const match = value?.trim().match(/^(?:infojobs\s+)?(\d{5,})$/i);
  return match?.[1] || null;
}

export function titleForInfojobsId(id?: string | null): string | null {
  if (!id) return null;
  return INFOJOBS_VACANCY_TITLES[id] || null;
}
