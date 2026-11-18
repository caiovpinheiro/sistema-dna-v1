import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { voltarPara } from "../lib/voltar";

/**
 * Link "← …" do topo das fichas. Leva para a página de onde a pessoa veio (ex.: a empresa);
 * aberta direto, sem histórico na aba, leva para `to` com o texto `rotulo`.
 */
export function VoltarLink({ to, rotulo, className }: { to: string; rotulo: string; className?: string }) {
  const { pathname, search } = useLocation();
  const destino = useMemo(() => voltarPara(`${pathname}${search}`, { to, rotulo }), [pathname, search, to, rotulo]);
  return (
    <Link
      to={destino.to}
      className={className ?? "inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900"}
    >
      <ArrowLeft size={16} /> {destino.rotulo}
    </Link>
  );
}
