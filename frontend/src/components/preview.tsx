import { useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Box = { top: number; left: number };

export function useLinhaPreview() {
  const [id, setId] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  function mostrar(next: string, event: MouseEvent<HTMLElement>) {
    const width = 288;
    const left = Math.min(event.clientX + 16, window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, event.clientY + 16), window.innerHeight - 220);
    setId(next);
    setBox({ top, left });
  }
  function esconder() {
    setId(null);
    setBox(null);
  }
  return { id, box, mostrar, esconder };
}

export function PreviewFlutuante({ box, children }: { box: Box | null; children: ReactNode }) {
  if (!box) return null;
  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-50 w-72 rounded-lg bg-[#12141a] p-3 text-sm text-slate-300 ring-1 ring-white/10" style={{ top: box.top, left: box.left }}>
      {children}
    </div>,
    document.body,
  );
}

export function LinhaPreview({ titulo, linhas }: { titulo: string; linhas: Array<string | null | undefined> }) {
  const itens = linhas.filter((item): item is string => Boolean(item));
  return (
    <div className="grid gap-1">
      <p className="font-semibold text-white">{titulo}</p>
      {itens.map((item, index) => <p key={`${index}-${item}`}>{item}</p>)}
    </div>
  );
}
