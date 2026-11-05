import { useEffect, useState } from "react";
import { Input } from "@/components/ui";

export function normalizarBusca(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** Cada palavra digitada precisa aparecer no texto, em qualquer ordem e sem acento: "parana itaco" acha "Paraná Supermercados - Jardim Itacolomi". */
export function combinaBusca(texto: string, busca: string) {
  const alvo = normalizarBusca(texto);
  return normalizarBusca(busca).split(/[\s\-–/,]+/).filter(Boolean).every((palavra) => alvo.includes(palavra));
}

const listaFixaVazia: string[] = [];

export function BuscaOpcao({ value, onChange, opcoes, placeholder, fixas = [], onTexto, ariaLabel, preservarTexto = listaFixaVazia }: {
  value: string;
  onChange: (id: string) => void;
  /** detalhe entra na busca, mas não no texto mostrado (por exemplo o grupo ou o bairro). */
  opcoes: Array<{ id: string; label: string; detalhe?: string }>;
  placeholder: string;
  /** Sempre aparecem no fim da lista, sem passar pelo filtro do texto digitado. */
  fixas?: Array<{ id: string; label: string }>;
  onTexto?: (texto: string) => void;
  ariaLabel?: string;
  /** Estes ids mantêm o que a pessoa digitou, em vez de trocar o campo pelo rótulo da opção. */
  preservarTexto?: string[];
}) {
  const selecionada = [...opcoes, ...fixas].find((item) => item.id === value);
  const [texto, setTexto] = useState(selecionada?.label ?? "");
  const [aberto, setAberto] = useState(false);
  const manterTexto = Boolean(selecionada && preservarTexto.includes(selecionada.id));
  useEffect(() => {
    if (selecionada && !manterTexto) setTexto(selecionada.label);
  }, [selecionada?.id, selecionada?.label, manterTexto]);
  const busca = selecionada && texto === selecionada.label ? "" : texto.trim();
  const lista: Array<{ id: string; label: string; detalhe?: string }> = [...opcoes.filter((item) => !busca || combinaBusca(`${item.label} ${item.detalhe ?? ""}`, busca)).slice(0, 20), ...fixas];
  return (
    <div className="relative">
      <Input
        value={texto}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        onChange={(event) => {
          const proximo = event.target.value;
          setTexto(proximo);
          onTexto?.(proximo);
          setAberto(true);
          if (!selecionada || proximo !== selecionada.label) onChange("");
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
      />
      {aberto ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {lista.length ? lista.map((item) => (
            <li key={item.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={(event) => {
                event.preventDefault();
                onChange(item.id);
                if (!preservarTexto.includes(item.id)) setTexto(item.label);
                setAberto(false);
              }}>
                {item.label}
                {item.detalhe ? <span className="block text-xs text-slate-500">{item.detalhe}</span> : null}
              </button>
            </li>
          )) : <li className="px-3 py-2 text-sm text-slate-500">Nenhum resultado</li>}
        </ul>
      ) : null}
    </div>
  );
}
