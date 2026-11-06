export type TipoVaga = 'clt' | 'estagio';

export function classificarTipoVaga(value: unknown): TipoVaga | null {
  const texto = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!texto) return null;
  if (texto === 'clt') return 'clt';
  if (texto.includes('est')) return 'estagio';
  return null;
}

export function tipoSalvo(value: string | null | undefined): TipoVaga | null {
  return value === 'clt' || value === 'estagio' ? value : null;
}

function listasDe(value: unknown): unknown[][] {
  if (Array.isArray(value)) return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap((item) => listasDe(item));
}

export function tipoVagaDoContato(contact: unknown): TipoVaga | null {
  if (!contact || typeof contact !== 'object') return null;
  const row = contact as Record<string, unknown>;
  const listas = [
    ...listasDe(row.dealInboxPanelFields),
    ...listasDe(row.inboxLeadPanelFields),
    ...listasDe(row.customFields),
    ...listasDe(row.panelFields),
  ];
  for (const lista of listas) {
    for (const item of lista) {
      if (!item || typeof item !== 'object') continue;
      const campo = item as Record<string, unknown>;
      const nome = typeof campo.name === 'string' ? campo.name : '';
      const slug = typeof campo.slug === 'string' ? campo.slug : '';
      const key = `${nome} ${slug}`.toLowerCase();
      if (!key.includes('tipo_de_vaga') && !key.includes('tipo de vaga')) continue;
      const tipo = classificarTipoVaga(campo.value);
      if (tipo) return tipo;
    }
  }
  return null;
}
