import { Briefcase, Building2, ChevronDown, FileSignature, FileWarning, GraduationCap, Handshake, LayoutDashboard, LogOut, Menu, Percent, Receipt, Search, Users, Wallet, X } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "./ui";

const items = [
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/candidatos", label: "Candidatos", icon: Users },
  { to: "/empresas", label: "Empresas", icon: Building2 },
];

const afterVagas = [
  { to: "/contratacoes", label: "Contratações", icon: Handshake },
];

const termoLinks: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/termos", label: "Consultar", end: true },
  { to: "/termos/gerar", label: "Gerar TCE" },
];

const vagaLinks: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/vagas", label: "Consultar", end: true },
  { to: "/vagas/modelos", label: "Consultar Modelos", end: true },
  { to: "/vagas/modelos/novo", label: "Cadastrar Modelo" },
];

const instituicaoLinks: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/instituicoes", label: "Consultar", end: true },
  { to: "/instituicoes/nova", label: "Cadastrar" },
];

const financeLinks = [
  { to: "/financeiro/faturamento", label: "Gerar Faturamento" },
  { to: "/financeiro/contas-a-receber", label: "Contas a Receber" },
  { to: "/financeiro/regua", label: "Régua de cobrança" },
  { to: "/financeiro/relatorio-procfy", label: "Relatório Procfy" },
];

const comissaoLinks: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/financeiro/comissao", label: "Consultar", end: true },
  { to: "/financeiro/comissao/empresas", label: "Empresas" },
];

function SideGroup({ label, icon: Icon, active, expanded, links, onNavigate }: {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  expanded: boolean;
  links: Array<{ to: string; label: string; end?: boolean }>;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!expanded) setOpen(false); }, [expanded]);
  const subClass = ({ isActive }: { isActive: boolean }) => cn(
    "block rounded-xl px-3 py-2 text-sm font-semibold transition duration-200",
    isActive ? "bg-cyan-400/20 text-cyan-100" : "text-slate-300 hover:bg-white/10 hover:text-white",
  );
  return (
    <div className="grid gap-1">
      <button type="button" aria-expanded={open && expanded} title={label} onClick={() => setOpen((value) => !value)}
        className={cn("flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition duration-200", active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
        <Icon size={18} className="shrink-0" />
        <span className={cn("overflow-hidden whitespace-nowrap text-left transition-all duration-300", expanded ? "max-w-40 opacity-100" : "max-w-0 opacity-0")}>{label}</span>
        <ChevronDown size={16} className={cn("ml-auto shrink-0 transition duration-200", expanded ? "" : "w-0 opacity-0", open ? "" : "-rotate-90")} />
      </button>
      {open && expanded ? (
        <div className="nav-sub grid gap-1 pl-8">
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={subClass}>{item.label}</NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ email, notify }: { email: string; notify: (message: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const financeiroActive = pathname.startsWith("/financeiro") && !pathname.startsWith("/financeiro/comissao") && !pathname.startsWith("/financeiro/holerite");
  const comissaoActive = pathname.startsWith("/financeiro/comissao");
  const vagaActive = pathname.startsWith("/vagas");
  const instituicaoActive = pathname.startsWith("/instituicoes");
  const termoActive = pathname.startsWith("/termos");
  const expanded = open || hover;
  const linkClass = ({ isActive }: { isActive: boolean }) => cn(
    "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition duration-200",
    isActive ? "bg-cyan-400 text-navy-950" : "text-slate-300 hover:bg-white/10 hover:text-white",
  );
  const label = (text: string) => <span className={cn("overflow-hidden whitespace-nowrap transition-all duration-300", expanded ? "max-w-40 opacity-100" : "max-w-0 opacity-0")}>{text}</span>;

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" });
    notify("Sessão encerrada.");
    window.location.href = "/login";
  }

  const nav = (
    <nav className="grid gap-1">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} title={item.label} className={linkClass}>
          <item.icon size={18} className="shrink-0" /> {label(item.label)}
        </NavLink>
      ))}
      <SideGroup label="Vagas" icon={Briefcase} active={vagaActive} expanded={expanded} links={vagaLinks} onNavigate={() => setOpen(false)} />
      {afterVagas.map((item) => (
        <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} title={item.label} className={linkClass}>
          <item.icon size={18} className="shrink-0" /> {label(item.label)}
        </NavLink>
      ))}
      <SideGroup label="Termos" icon={FileSignature} active={termoActive} expanded={expanded} links={termoLinks} onNavigate={() => setOpen(false)} />
      <SideGroup label="Instituições" icon={GraduationCap} active={instituicaoActive} expanded={expanded} links={instituicaoLinks} onNavigate={() => setOpen(false)} />
      <SideGroup label="Financeiro" icon={Wallet} active={financeiroActive} expanded={expanded} links={financeLinks} onNavigate={() => setOpen(false)} />
      <SideGroup label="Comissão" icon={Percent} active={comissaoActive} expanded={expanded} links={comissaoLinks} onNavigate={() => setOpen(false)} />
      <NavLink to="/financeiro/holerite" onClick={() => setOpen(false)} title="Holerite" className={linkClass}>
        <Receipt size={18} className="shrink-0" /> {label("Holerite")}
      </NavLink>
      <NavLink to="/documentos-pendentes" onClick={() => setOpen(false)} title="Documentos Pendentes" className={linkClass}>
        <FileWarning size={18} className="shrink-0" /> {label("Documentos Pendentes")}
      </NavLink>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("hidden overflow-x-hidden bg-gradient-to-b from-navy-900 to-navy-950 text-white transition-[width] duration-300 ease-out lg:flex lg:min-h-screen lg:flex-col", hover ? "lg:w-72" : "lg:w-[76px]")}
      >
        <div className={cn("flex items-center py-5", expanded ? "gap-3 px-4" : "justify-center px-2")}>
          <img src="/logo-laranja.png" alt="DNA Work" className={cn("shrink-0 object-contain", expanded ? "h-9 w-16" : "h-8 w-12")} />
          <div className={cn("overflow-hidden whitespace-nowrap transition-all duration-300", expanded ? "w-auto opacity-100" : "w-0 opacity-0")}>
            <div className="text-sm font-extrabold tracking-wide">DNAWORK</div>
            <div className="text-xs text-slate-400">Recrutamento</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2">{nav}</div>
        <div className="mt-auto border-t border-white/10 p-2">
          <button type="button" title="Sair" onClick={() => void logout()} className="flex h-11 w-full items-center gap-3 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white transition duration-200 hover:bg-cyan-400 hover:text-navy-950">
            <LogOut size={18} className="shrink-0" />
            <span className={cn("overflow-hidden whitespace-nowrap transition-all duration-300", expanded ? "max-w-40 opacity-100" : "max-w-0 opacity-0")}>Sair</span>
          </button>
          <p className={cn("truncate px-3 pt-2 text-xs text-slate-400", expanded ? "" : "hidden")}>{email}</p>
        </div>
      </aside>
      {open ? <div className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-navy-900 p-4 text-white lg:hidden", open ? "translate-x-0" : "hidden")}>
        <div className="mb-6 flex items-center justify-between">
          <strong>DNAWORK</strong>
          <button aria-label="Fechar menu" onClick={() => setOpen(false)}><X /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{nav}</div>
        <button type="button" onClick={() => void logout()} className="mt-4 flex h-11 w-full items-center gap-3 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white">
          <LogOut size={18} /> Sair
        </button>
        <p className="truncate px-3 pt-2 text-xs text-slate-400">{email}</p>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100 lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu /></button>
          <form className="relative max-w-xl flex-1" onSubmit={(event) => { event.preventDefault(); navigate(`/candidatos?nome=${encodeURIComponent(query)}`); }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input aria-label="Buscar candidatos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar candidato por nome" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" />
          </form>
          <button className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition duration-200 hover:bg-slate-100 active:scale-95" onClick={() => void logout()}><LogOut size={16} /> Sair</button>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
