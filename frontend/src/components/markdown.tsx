import type { ReactNode } from "react";
import { analisar, type Trecho } from "@/lib/markdown";

/** Mostra Markdown sem HTML cru (ver lib/markdown.ts): seguro contra XSS por construção. */
export function Markdown({ texto, className }: { texto: string; className?: string }) {
  return (
    <div className={className ?? "grid gap-3 text-sm leading-6 text-slate-700"}>
      {analisar(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          const cls = ["", "text-xl font-extrabold text-navy-900", "text-lg font-bold text-navy-900", "text-base font-bold text-navy-900", "text-sm font-bold text-navy-900"][b.nivel];
          return b.nivel === 1 ? <h2 key={i} className={cls}>{render(b.trechos)}</h2> : b.nivel === 2 ? <h3 key={i} className={cls}>{render(b.trechos)}</h3> : <h4 key={i} className={cls}>{render(b.trechos)}</h4>;
        }
        if (b.tipo === "paragrafo") return <p key={i}>{render(b.trechos)}</p>;
        if (b.tipo === "lista") {
          const itens = b.itens.map((t, j) => <li key={j}>{render(t)}</li>);
          return b.ordenada ? <ol key={i} className="grid list-decimal gap-1 pl-5">{itens}</ol> : <ul key={i} className="grid list-disc gap-1 pl-5">{itens}</ul>;
        }
        if (b.tipo === "citacao") return <blockquote key={i} className="border-l-4 border-cyan-600/40 pl-3 text-slate-600">{render(b.trechos)}</blockquote>;
        if (b.tipo === "codigo") return <pre key={i} className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-navy-900">{b.texto}</pre>;
        return <hr key={i} className="border-slate-200" />;
      })}
    </div>
  );
}

function render(trechos: Trecho[]): ReactNode {
  return trechos.map((t, i) => {
    if (t.tipo === "texto") return <span key={i}>{t.texto}</span>;
    if (t.tipo === "negrito") return <strong key={i} className="font-semibold text-navy-900">{render(t.filhos)}</strong>;
    if (t.tipo === "italico") return <em key={i}>{render(t.filhos)}</em>;
    if (t.tipo === "codigo") return <code key={i} className="rounded bg-slate-100 px-1 text-[0.85em]">{t.texto}</code>;
    return <a key={i} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-cyan-700 underline">{render(t.filhos)}</a>;
  });
}
