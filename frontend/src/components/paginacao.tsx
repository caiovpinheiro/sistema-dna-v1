export function numeroPagina(params: URLSearchParams) {
  const valor = Number(params.get("page") ?? "1");
  return Number.isInteger(valor) && valor > 0 ? valor : 1;
}

export function Paginacao({ pagina, tamanho, total, onPagina }: { pagina: number; tamanho: number; total: number; onPagina: (pagina: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  if (paginas <= 1) return null;
  const atual = Math.min(Math.max(pagina, 1), paginas);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-slate-500">Página {atual} de {paginas}</span>
      <div className="flex gap-2">
        <button type="button" disabled={atual <= 1} onClick={() => onPagina(atual - 1)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-40">Anterior</button>
        <button type="button" disabled={atual >= paginas} onClick={() => onPagina(atual + 1)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-40">Próxima</button>
      </div>
    </div>
  );
}
