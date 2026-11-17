import { Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Input, cn } from "@/components/ui";

export type Sugestao = {
  id: string;
  label: string;
  /** Linha menor embaixo do nome (CNPJ, cidade, empresa…). */
  detalhe?: string;
  /** Para onde a sugestão leva ao ser escolhida. Sem href, o texto da sugestão vira a busca. */
  href?: string;
};

const ESPERA_MS = 250;
const MINIMO = 2;

/**
 * Campo de pesquisa inteligente das listas: enquanto a pessoa digita, mostra até 6 sugestões do
 * próprio sistema (não o histórico do navegador, que fica desligado). Escolher uma sugestão abre o
 * registro (ou vira a busca, se a sugestão não tiver href). Enter sem sugestão marcada faz a busca
 * normal da página. A busca no servidor aceita palavras em qualquer ordem e sem acento.
 *
 * Dentro de um <form>, use `name`/`defaultValue` como num Input comum: o formulário recebe o texto.
 * Fora de um form, use `value`/`onChange` e `onBuscar`.
 */
export function BuscaInteligente({
  sugerir, name, defaultValue, value, onChange, onBuscar, aoSair, placeholder, ariaLabel, className, onEscolher,
}: {
  sugerir: (texto: string, sinal: AbortSignal) => Promise<Sugestao[]>;
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (texto: string) => void;
  /** Busca completa (Enter ou "Pesquisar …" na lista). Num <form>, o padrão é enviar o formulário. */
  onBuscar?: (texto: string) => void;
  /** Chamado ao sair do campo sem escolher sugestão (páginas que já pesquisavam ao sair do campo). */
  aoSair?: (texto: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Troca o comportamento padrão ao escolher (abrir o href ou pesquisar o texto). */
  onEscolher?: (sugestao: Sugestao) => void;
}) {
  const navigate = useNavigate();
  const idLista = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const [textoInterno, setTextoInterno] = useState(defaultValue ?? "");
  const texto = value ?? textoInterno;
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [marcada, setMarcada] = useState(-1);
  const termo = texto.trim();
  const textoAtual = useRef(texto);
  textoAtual.current = texto;

  useEffect(() => {
    if (!aberto || termo.length < MINIMO) {
      setSugestoes([]);
      setCarregando(false);
      return;
    }
    const controle = new AbortController();
    setCarregando(true);
    const espera = window.setTimeout(() => {
      sugerir(termo, controle.signal)
        .then((lista) => { if (!controle.signal.aborted) { setSugestoes(lista.slice(0, 6)); setMarcada(-1); } })
        .catch(() => { if (!controle.signal.aborted) setSugestoes([]); })
        .finally(() => { if (!controle.signal.aborted) setCarregando(false); });
    }, ESPERA_MS);
    return () => { controle.abort(); window.clearTimeout(espera); };
    // `sugerir` costuma ser recriada a cada render; a busca depende só do texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo, aberto]);

  function mudar(proximo: string) {
    if (value === undefined) setTextoInterno(proximo);
    onChange?.(proximo);
    setAberto(true);
  }

  function buscarTudo(textoBusca = texto) {
    setAberto(false);
    if (onBuscar) {
      onBuscar(textoBusca);
      return;
    }
    // Num formulário, o valor do campo já está certo (ou acabou de ser trocado): envia depois do render.
    window.setTimeout(() => caixa.current?.querySelector("input")?.form?.requestSubmit(), 0);
  }

  function escolher(sugestao: Sugestao) {
    setAberto(false);
    if (onEscolher) {
      onEscolher(sugestao);
      return;
    }
    if (sugestao.href) {
      navigate(sugestao.href);
      return;
    }
    mudar(sugestao.label);
    setAberto(false);
    buscarTudo(sugestao.label);
  }

  function teclar(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setAberto(false);
      return;
    }
    if (!aberto || !sugestoes.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMarcada((atual) => (atual + 1) % sugestoes.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setMarcada((atual) => (atual <= 0 ? sugestoes.length - 1 : atual - 1));
    } else if (event.key === "Enter" && marcada >= 0) {
      event.preventDefault();
      escolher(sugestoes[marcada]);
    } else if (event.key === "Enter" && onBuscar) {
      event.preventDefault();
      buscarTudo();
    }
  }

  const mostrarLista = aberto && termo.length >= MINIMO;
  return (
    <div ref={caixa} className={cn("relative", className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input
        name={name}
        value={texto}
        onChange={(event) => mudar(event.target.value)}
        onFocus={() => setAberto(true)}
        onBlur={() => window.setTimeout(() => { setAberto(false); aoSair?.(textoAtual.current); }, 150)}
        onKeyDown={teclar}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        // Sem histórico do navegador: as sugestões vêm do sistema.
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={mostrarLista}
        aria-controls={idLista}
        aria-activedescendant={marcada >= 0 ? `${idLista}-${marcada}` : undefined}
        className="pl-9"
      />
      {mostrarLista ? (
        <ul id={idLista} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full min-w-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {sugestoes.map((sugestao, indice) => (
            <li key={sugestao.id} id={`${idLista}-${indice}`} role="option" aria-selected={indice === marcada}>
              <button
                type="button"
                tabIndex={-1}
                className={cn("w-full px-3 py-2 text-left text-sm hover:bg-slate-50", indice === marcada && "bg-slate-100")}
                onMouseDown={(event) => { event.preventDefault(); escolher(sugestao); }}
              >
                <span className="block truncate font-medium text-navy-900">{sugestao.label}</span>
                {sugestao.detalhe ? <span className="block truncate text-xs text-slate-500">{sugestao.detalhe}</span> : null}
              </button>
            </li>
          ))}
          {carregando ? (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" aria-hidden /> Buscando…</li>
          ) : !sugestoes.length ? (
            <li className="px-3 py-2 text-sm text-slate-500">Nenhuma sugestão.</li>
          ) : null}
          <li className="border-t border-slate-100">
            <button
              type="button"
              tabIndex={-1}
              className="w-full px-3 py-2 text-left text-sm font-semibold text-cyan-700 hover:bg-slate-50"
              onMouseDown={(event) => { event.preventDefault(); buscarTudo(); }}
            >
              Pesquisar “{termo}” na lista
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
