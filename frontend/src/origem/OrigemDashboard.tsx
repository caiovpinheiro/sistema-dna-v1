
import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import './origem.css';
import {
  addMonthsIso,
  brasiliaTodayIso,
  clampOrigemRange,
  isoToBr,
  rangeForPreset,
  type PeriodPreset,
} from './date-range';

interface OrigemItem {
  nome: string;
  quantidade: number;
  percentual: number;
}

interface CampanhaItem {
  origem: string;
  campanha: string;
  quantidade: number;
}

interface MarcoData {
  total: number;
  clt?: number;
  estagio?: number;
  origens: OrigemItem[];
  redes?: OrigemItem[];
  campanhas: CampanhaItem[];
}

interface DashboardData {
  total: number;
  clt?: number;
  estagio?: number;
  origens: OrigemItem[];
  redes?: OrigemItem[];
  campanhas: CampanhaItem[];
  ganhos?: MarcoData;
  enviadas?: MarcoData;
  atendimentos?: MarcoData;
}

interface PieSlice {
  item: OrigemItem;
  start: number;
  end: number;
  color: string;
}

interface PieHover {
  item: OrigemItem;
  color: string;
  x: number;
  y: number;
}

const PIE_COLORS = ['#ff7a08', '#6a5cff', '#38bdf8', '#4ade80', '#f472b6', '#facc15', '#fb7185'];

function maskBrDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function brToIso(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return iso;
}

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  const startPoint = polar(cx, cy, r, start);
  const endPoint = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${startPoint.x} ${startPoint.y} A ${r} ${r} 0 ${large} 1 ${endPoint.x} ${endPoint.y} Z`;
}

const REDE_COR: Record<string, string> = {
  Instagram: '#f472b6',
  Facebook: '#38bdf8',
  'Não identificado': '#94a3b8',
};

function textoPercentual(valor: number): string {
  return `${valor.toFixed(1).replace('.', ',')}%`;
}

function CanalPie({
  origens,
  unidade = 'leads',
  redes,
}: {
  origens: OrigemItem[];
  unidade?: string;
  redes?: OrigemItem[];
}) {
  const [hover, setHover] = useState<PieHover | null>(null);
  const slices = useMemo<PieSlice[]>(() => {
    let angle = 0;
    return origens.map((item, index) => {
      const sweep = (item.percentual / 100) * 360;
      const start = angle;
      const end = angle + sweep;
      angle = end;
      return { item, start, end, color: PIE_COLORS[index % PIE_COLORS.length] };
    });
  }, [origens]);

  function moveTooltip(event: MouseEvent<SVGElement>, slice: PieSlice) {
    const box = event.currentTarget.closest('.origem-pie-chart')?.getBoundingClientRect();
    if (!box) return;
    setHover({
      item: slice.item,
      color: slice.color,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  }

  return (
    <div className="origem-pie-block">
      <div className="origem-pie-chart">
        <svg
          viewBox="0 0 240 240"
          className="origem-pie"
          role="img"
          aria-label={`Canais de ${unidade}`}
          onMouseLeave={() => setHover(null)}
        >
          {slices.length === 1 ? (
            <circle
              cx="120"
              cy="120"
              r="100"
              fill={slices[0].color}
              onMouseMove={(event) => moveTooltip(event, slices[0])}
            />
          ) : (
            slices.map((slice) => (
              <path
                key={slice.item.nome}
                d={slicePath(120, 120, 100, slice.start, slice.end)}
                fill={slice.color}
                onMouseMove={(event) => moveTooltip(event, slice)}
              />
            ))
          )}
        </svg>
        {hover && (
          <div
            className="origem-pie-tooltip"
            style={{ left: hover.x, top: hover.y }}
          >
            <strong>{hover.item.nome}</strong>
            <span>
              <i style={{ background: hover.color }} />
              {hover.item.quantidade} {unidade} ({hover.item.percentual}%)
            </span>
            {hover.item.nome === 'meta' &&
              redes
                ?.filter((rede) => rede.nome === 'Instagram' || rede.nome === 'Facebook' || rede.quantidade > 0)
                .map((rede) => (
                  <span key={rede.nome}>
                    <i style={{ background: REDE_COR[rede.nome] || '#94a3b8' }} />
                    {rede.nome} {textoPercentual(rede.percentual)}
                  </span>
                ))}
          </div>
        )}
      </div>
      <ul className="origem-pie-legend">
        {slices.map((slice) => (
          <li key={slice.item.nome}>
            <i style={{ background: slice.color }} />
            <span>{slice.item.nome}</span>
            <em>
              {slice.item.quantidade} ({slice.item.percentual}%)
            </em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CampanhasLista({ titulo, itens }: { titulo: string; itens: CampanhaItem[] }) {
  return (
    <section className="origem-panel">
      <h2>{titulo}</h2>
      {itens.length === 0 ? (
        <p className="subtitle">Nenhuma campanha nesse período.</p>
      ) : (
        <ul className="origem-campaigns">
          {itens.map((item) => (
            <li key={`${titulo}-${item.origem}-${item.campanha}`}>
              <div>
                <strong>{item.campanha}</strong>
                <span>{item.origem}</span>
              </div>
              <em>{item.quantidade}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: '7d', label: '7 dias' },
  { value: '1m', label: '1 mês' },
  { value: '3m', label: '3 meses' },
];

function periodLabel(preset: PeriodPreset | 'custom'): string {
  if (preset === 'custom') return 'Personalizado';
  return PERIOD_OPTIONS.find((option) => option.value === preset)?.label || '7 dias';
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function toIso(year: number, month: number, day: number): string {
  const date = new Date(year, month - 1, day);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function OrigemCalendar({
  value,
  min,
  max,
  onSelect,
}: {
  value: string;
  min: string;
  max: string;
  onSelect: (iso: string) => void;
}) {
  const [year, month] = value.split('-').map(Number);
  const [viewYear, setViewYear] = useState(year || new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(month || new Date().getMonth() + 1);

  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth - 1, 0).getDate();
  const cells: Array<{ iso: string; day: number; outside: boolean }> = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    const day = prevMonthDays - firstWeekday + 1 + i;
    cells.push({ iso: toIso(viewYear, viewMonth - 1, day), day, outside: true });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: toIso(viewYear, viewMonth, day), day, outside: false });
  }
  while (cells.length < 42) {
    const day = cells.length - (firstWeekday + daysInMonth) + 1;
    cells.push({ iso: toIso(viewYear, viewMonth + 1, day), day, outside: true });
  }

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth() + 1);
  }

  const today = brasiliaTodayIso();

  return (
    <div className="origem-calendar" role="dialog" aria-label="Calendário">
      <div className="origem-calendar-head">
        <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mês anterior">
          ‹
        </button>
        <strong>
          {MONTHS[viewMonth - 1]} de {viewYear}
        </strong>
        <button type="button" onClick={() => shiftMonth(1)} aria-label="Próximo mês">
          ›
        </button>
      </div>
      <div className="origem-calendar-week">
        {WEEKDAYS.map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="origem-calendar-grid">
        {cells.map((cell) => (
          <button
            key={cell.iso}
            type="button"
            className={`${cell.outside ? 'outside' : ''} ${cell.iso === value ? 'selected' : ''}`}
            disabled={cell.iso < min || cell.iso > max}
            onClick={() => onSelect(cell.iso)}
          >
            {cell.day}
          </button>
        ))}
      </div>
      <div className="origem-calendar-foot">
        <button
          type="button"
          disabled={today < min || today > max}
          onClick={() => onSelect(today)}
        >
          Hoje
        </button>
      </div>
    </div>
  );
}

function OrigemDateField({
  label,
  display,
  iso,
  min,
  max,
  onTyped,
  onPicked,
}: {
  label: string;
  display: string;
  iso: string;
  min: string;
  max: string;
  onTyped: (value: string) => void;
  onPicked: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: Event) {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <label className="origem-date-label" ref={fieldRef}>
      {label}
      <div className="origem-date-field">
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd/mm/aaaa"
          value={display}
          onChange={(event) => onTyped(maskBrDate(event.target.value))}
          onClick={() => setOpen(true)}
        />
        <button
          type="button"
          className="origem-date-calendar"
          aria-label={`Abrir calendário de ${label.toLowerCase()}`}
          onClick={() => setOpen((current) => !current)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 11h18" />
          </svg>
        </button>
        {open && (
          <OrigemCalendar
            value={iso}
            min={min}
            max={max}
            onSelect={(next) => {
              onPicked(next);
              setOpen(false);
            }}
          />
        )}
      </div>
    </label>
  );
}

function TipoLinha({ clt, estagio }: { clt?: number; estagio?: number }) {
  return (
    <p className="origem-tipo">
      CLT {(clt || 0).toLocaleString('pt-BR')} · Estágio {(estagio || 0).toLocaleString('pt-BR')}
    </p>
  );
}

function MarcoPainel({
  titulo,
  totalRotulo,
  vazio,
  unidade,
  dados,
}: {
  titulo: string;
  totalRotulo: string;
  vazio: string;
  unidade: string;
  dados?: MarcoData;
}) {
  const total = dados?.total ?? 0;
  return (
    <section className="origem-panel">
      <h2>{titulo}</h2>
      <div className="origem-kpi">
        <span>{totalRotulo}</span>
        <strong>{total}</strong>
        <TipoLinha clt={dados?.clt} estagio={dados?.estagio} />
      </div>
      {total === 0 ? (
        <p className="subtitle">{vazio}</p>
      ) : (
        <>
          <section>
            <h2>Canais</h2>
            <CanalPie origens={dados?.origens || []} unidade={unidade} redes={dados?.redes} />
          </section>
        </>
      )}
    </section>
  );
}

function taxaNumero(parte: number, total: number): number | null {
  if (!total) return null;
  return (parte / total) * 100;
}

function tetoDaEscala(valores: number[]): number {
  const maximo = Math.max(0, ...valores);
  if (maximo <= 5) return 5;
  if (maximo <= 10) return 10;
  if (maximo <= 25) return 25;
  if (maximo <= 50) return 50;
  if (maximo <= 100) return 100;
  return Math.ceil(maximo / 25) * 25;
}

function GraficoColunas({
  titulo,
  cor,
  linhas,
}: {
  titulo: string;
  cor: string;
  linhas: Array<{ nome: string; taxa: number | null }>;
}) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const largura = 640;
  const altura = 300;
  // Margens para caber "425,0%" no eixo e os nomes inclinados (até 16 letras) embaixo.
  const esquerda = 64;
  const direita = 12;
  const topo = 28;
  const base = 104;
  const areaLargura = largura - esquerda - direita;
  const areaAltura = altura - topo - base;
  const teto = tetoDaEscala(linhas.map((linha) => linha.taxa || 0));
  const faixa = linhas.length ? areaLargura / linhas.length : areaLargura;
  const barra = Math.min(42, faixa * 0.46);
  const marcas = [0, teto / 2, teto];

  return (
    <figure className="origem-coluna">
      <figcaption>{titulo}</figcaption>
      <svg viewBox={`0 0 ${largura} ${altura}`} className="origem-coluna-chart" role="img" aria-label={titulo}>
        {marcas.map((marca) => {
          const y = topo + areaAltura - (marca / teto) * areaAltura;
          return (
            <g key={marca}>
              <line x1={esquerda} x2={largura - direita} y1={y} y2={y} className="origem-coluna-eixo" />
              <text x={esquerda - 8} y={y + 4} textAnchor="end">
                {textoPercentual(marca)}
              </text>
            </g>
          );
        })}
        {linhas.map((linha, index) => {
          const centro = esquerda + faixa * index + faixa / 2;
          const taxa = linha.taxa || 0;
          const alturaBarra = linha.taxa == null ? 0 : (taxa / teto) * areaAltura;
          const y = topo + areaAltura - alturaBarra;
          return (
            <g key={linha.nome} onMouseEnter={() => setAtiva(index)} onMouseLeave={() => setAtiva(null)}>
              <rect
                x={centro - barra / 2}
                y={y}
                width={barra}
                height={Math.max(alturaBarra, linha.taxa == null ? 0 : 2)}
                rx="6"
                fill={cor}
                opacity={ativa == null || ativa === index ? 1 : 0.45}
              />
              <text x={centro} y={Math.max(y - 8, 14)} textAnchor="middle" className="origem-coluna-valor">
                {linha.taxa == null ? '—' : textoPercentual(linha.taxa)}
              </text>
              <text
                x={centro}
                y={topo + areaAltura + 16}
                textAnchor="end"
                transform={`rotate(-35 ${centro} ${topo + areaAltura + 16})`}
              >
                <title>{linha.nome}</title>
                {linha.nome.length > 16 ? `${linha.nome.slice(0, 15).trimEnd()}…` : linha.nome}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function ConversaoGrafico({
  leads,
  atendimentos,
  enviadas,
  ganhos,
}: {
  leads: OrigemItem[];
  atendimentos: OrigemItem[];
  enviadas: OrigemItem[];
  ganhos: OrigemItem[];
}) {
  const linhas = useMemo(() => {
    const nomes = new Set<string>([
      ...leads.map((item) => item.nome),
      ...atendimentos.map((item) => item.nome),
      ...enviadas.map((item) => item.nome),
      ...ganhos.map((item) => item.nome),
    ]);
    const quantidade = (lista: OrigemItem[], nome: string) =>
      lista.find((item) => item.nome === nome)?.quantidade || 0;
    const itens = [...nomes]
      .map((nome) => ({
        nome,
        leads: quantidade(leads, nome),
        atendimentos: quantidade(atendimentos, nome),
        enviadas: quantidade(enviadas, nome),
        ganhos: quantidade(ganhos, nome),
      }))
      .sort((a, b) => b.leads - a.leads || b.atendimentos - a.atendimentos || b.enviadas - a.enviadas || a.nome.localeCompare(b.nome));
    return itens;
  }, [leads, atendimentos, enviadas, ganhos]);

  return (
    <section className="origem-conversao">
      <h2>Conversão</h2>
      <div className="origem-conversao-graficos">
        <GraficoColunas
          titulo="Leads → atendimento"
          cor="#0ea5e9"
          linhas={linhas.map((linha) => ({
            nome: linha.nome,
            taxa: taxaNumero(linha.atendimentos, linha.leads),
          }))}
        />
        <GraficoColunas
          titulo="Leads → processo seletivo"
          cor="#ff7a08"
          linhas={linhas.map((linha) => ({
            nome: linha.nome,
            taxa: taxaNumero(linha.enviadas, linha.leads),
          }))}
        />
        <GraficoColunas
          titulo="Processo seletivo → ganho"
          cor="#6a5cff"
          linhas={linhas.map((linha) => ({
            nome: linha.nome,
            taxa: taxaNumero(linha.ganhos, linha.enviadas),
          }))}
        />
      </div>
    </section>
  );
}

const initialRange = rangeForPreset('7d');

export function OrigemDashboard() {
  const [preset, setPreset] = useState<PeriodPreset | 'custom'>('7d');
  const [fromDisplay, setFromDisplay] = useState(isoToBr(initialRange.from));
  const [toDisplay, setToDisplay] = useState(isoToBr(initialRange.to));
  const [queryRange, setQueryRange] = useState(initialRange);
  const [data, setData] = useState<DashboardData | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const periodRef = useRef<HTMLDivElement>(null);

  const parsedFrom = brToIso(fromDisplay);
  const parsedTo = brToIso(toDisplay);

  useEffect(() => {
    function close(event: Event) {
      if (!periodRef.current?.contains(event.target as Node)) setPeriodOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (!parsedFrom || !parsedTo) return;
    const next = clampOrigemRange(parsedFrom, parsedTo);
    setQueryRange((current) =>
      current.from === next.from && current.to === next.to ? current : next
    );
    const nextFrom = isoToBr(next.from);
    const nextTo = isoToBr(next.to);
    if (fromDisplay !== nextFrom) setFromDisplay(nextFrom);
    if (toDisplay !== nextTo) setToDisplay(nextTo);
  }, [parsedFrom, parsedTo, fromDisplay, toDisplay]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setErrorMessage('');
      try {
        const params = new URLSearchParams({ from: queryRange.from, to: queryRange.to });
        const response = await fetch(`/api/v1/dashboard/origem?${params.toString()}`, { credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || 'Não foi possível carregar o dashboard.');
        }
        if (!cancelled) setData(payload);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Erro ao carregar o dashboard.'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [queryRange.from, queryRange.to]);

  function applyPreset(next: PeriodPreset) {
    const selected = rangeForPreset(next);
    setPreset(next);
    setFromDisplay(isoToBr(selected.from));
    setToDisplay(isoToBr(selected.to));
  }

  return (
    <div className="origem-dashboard">
      <div className="origem-filters">
        <div className="origem-period" ref={periodRef}>
          Período
          <button
            type="button"
            className="origem-period-trigger"
            aria-haspopup="listbox"
            aria-expanded={periodOpen}
            onClick={() => setPeriodOpen((open) => !open)}
          >
            {periodLabel(preset)}
            <span aria-hidden>▾</span>
          </button>
          {periodOpen && (
            <ul className="origem-period-menu" role="listbox">
              {PERIOD_OPTIONS.map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={preset === option.value}
                    onClick={() => {
                      applyPreset(option.value);
                      setPeriodOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <OrigemDateField
          label="Data inicial"
          display={fromDisplay}
          iso={parsedFrom || queryRange.from}
          min={addMonthsIso(queryRange.to, -3)}
          max={queryRange.to}
          onTyped={(value) => {
            setPreset('custom');
            setFromDisplay(value);
          }}
          onPicked={(iso) => {
            setPreset('custom');
            setFromDisplay(isoToBr(iso));
          }}
        />
        <OrigemDateField
          label="Data final"
          display={toDisplay}
          iso={parsedTo || queryRange.to}
          min={queryRange.from}
          max={brasiliaTodayIso()}
          onTyped={(value) => {
            setPreset('custom');
            setToDisplay(value);
          }}
          onPicked={(iso) => {
            setPreset('custom');
            setToDisplay(isoToBr(iso));
          }}
        />
      </div>

      {isLoading && (
        <p className="subtitle">
          Carregando origem dos candidatos…
        </p>
      )}
      {errorMessage && <div className="message error">{errorMessage}</div>}
      {!isLoading && !errorMessage && data && (
        <>
        <div className="origem-columns">
          <div className="origem-panel">
            {data.total === 0 ? (
              <p className="subtitle">Nenhum lead nesse período.</p>
            ) : (
              <>
                <div className="origem-kpi">
                  <span>Total de leads</span>
                  <strong>{data.total}</strong>
                  <TipoLinha clt={data.clt} estagio={data.estagio} />
                </div>

                <section>
                  <h2>Canais</h2>
                  <CanalPie origens={data.origens} redes={data.redes} />
                </section>
              </>
            )}
          </div>

          <MarcoPainel
            titulo="Atendimento candidatura"
            totalRotulo="Quem passou"
            vazio="Ninguém passou por Atendimento candidatura nesse período."
            unidade="atendimentos"
            dados={data.atendimentos}
          />
          <MarcoPainel
            titulo="Processo seletivo realizado"
            totalRotulo="Quem passou"
            vazio="Ninguém passou por Processo seletivo realizado nesse período."
            unidade="realizados"
            dados={data.enviadas}
          />
          <MarcoPainel
            titulo="Ganhos"
            totalRotulo="Total de ganhos"
            vazio="Nenhum ganho nesse período."
            unidade="ganhos"
            dados={data.ganhos}
          />
        </div>
        <ConversaoGrafico
          leads={data.origens}
          atendimentos={data.atendimentos?.origens || []}
          enviadas={data.enviadas?.origens || []}
          ganhos={data.ganhos?.origens || []}
        />
        <div className="origem-columns">
          <CampanhasLista titulo="Campanhas dos leads" itens={data.campanhas} />
          <CampanhasLista titulo="Campanhas do atendimento" itens={data.atendimentos?.campanhas || []} />
          <CampanhasLista titulo="Campanhas do processo seletivo" itens={data.enviadas?.campanhas || []} />
          <CampanhasLista titulo="Campanhas dos ganhos" itens={data.ganhos?.campanhas || []} />
        </div>
        </>
      )}
    </div>
  );
}
