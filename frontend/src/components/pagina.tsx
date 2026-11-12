import type { ReactNode } from "react";
import { cn } from "./ui";

/** Cabeçalho das telas de consulta: título, uma frase do que a tela faz e as ações principais à direita. */
export function CabecalhoPagina({ titulo, descricao, acoes, children }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">{titulo}</h1>
        {descricao ? <p className="max-w-2xl text-sm text-slate-500">{descricao}</p> : null}
        {children}
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </header>
  );
}

/** Rótulo visível em cima de cada filtro: o operador sabe o que cada campo filtra mesmo depois de preenchido. */
export function CampoFiltro({ rotulo, className, children }: { rotulo: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-xs font-semibold text-slate-500">{rotulo}</span>
      {children}
    </div>
  );
}

/** Linha entre os filtros e a lista: quantos resultados e, se houver filtro, o botão de limpar. */
export function ResumoResultados({ total, singular, plural, filtrando, onLimpar, carregando }: {
  total: number | null;
  singular: string;
  plural: string;
  filtrando: boolean;
  onLimpar: () => void;
  carregando?: boolean;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-slate-500" aria-live="polite">
        {carregando || total == null ? "Carregando…" : (
          <>
            <span className="font-bold tabular-nums text-navy-900">{total.toLocaleString("pt-BR")}</span> {total === 1 ? singular : plural}
            {filtrando ? " com os filtros escolhidos" : ""}
          </>
        )}
      </p>
      {filtrando ? (
        <button type="button" onClick={onLimpar} className="rounded-lg px-2.5 py-1 text-sm font-semibold text-cyan-700 hover:bg-cyan-50">
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
