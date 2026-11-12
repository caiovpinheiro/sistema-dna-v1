export function numeroPagina(params: URLSearchParams) {
  const valor = Number(params.get("page") ?? "1");
  return Number.isInteger(valor) && valor > 0 ? valor : 1;
}

export const TAMANHOS_PAGINA = [20, 25, 50, 100];

/** Quantos registros por página, lido do `pageSize` da URL (o backend aceita até 100). */
export function tamanhoPagina(params: URLSearchParams, padrao = 20) {
  const valor = Number(params.get("pageSize") ?? padrao);
  return TAMANHOS_PAGINA.includes(valor) ? valor : padrao;
}

export function Paginacao({ pagina, tamanho, total, onPagina, onTamanho }: { pagina: number; tamanho: number; total: number; onPagina: (pagina: number) => void; onTamanho?: (tamanho: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  if (paginas <= 1 && !onTamanho) return null;
  const atual = Math.min(Math.max(pagina, 1), paginas);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      {onTamanho ? (
        <label className="flex items-center gap-2 text-sm text-slate-500">
          Mostrar
          <select aria-label="Registros por página" value={tamanho} onChange={(event) => onTamanho(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700">
            {TAMANHOS_PAGINA.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          por página
        </label>
      ) : null}
      {paginas > 1 ? (
        <>
          <span className="text-sm text-slate-500">Página {atual} de {paginas}</span>
          <div className="flex gap-2">
            <button type="button" disabled={atual <= 1} onClick={() => onPagina(atual - 1)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={atual >= paginas} onClick={() => onPagina(atual + 1)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-40">Próxima</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
