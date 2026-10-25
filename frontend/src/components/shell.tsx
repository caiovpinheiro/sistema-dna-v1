import { Briefcase, Building2, ChevronDown, FileSignature, FileWarning, GraduationCap, Handshake, LayoutDashboard, LogOut, Mail, Menu, Percent, Receipt, Search, Users, Wallet, X } from "lucide-react";
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
    "block rounded-lg px-3 py-1.5 text-[13px] font-medium transition duration-150",
    isActive ? "bg-white/10 text-cyan-100" : "text-slate-400 hover:bg-white/10 hover:text-white",
  );
  return (
    <div className="grid gap-1">
      <button type="button" aria-expanded={open && expanded} title={label} onClick={() => setOpen((value) => !value)}
        className={cn("flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold transition duration-150", active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
        <Icon size={18} className="shrink-0" />
        <span className={cn("overflow-hidden whitespace-nowrap text-left transition-all duration-300", expanded ? "max-w-56 opacity-100" : "max-w-0 opacity-0")}>{label}</span>
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

function tituloDaRota(pathname: string) {
  if (pathname === "/") return "Painel";
  const rotas: Array<[string, string]> = [
    ["/emails", "E-mails"],
    ["/documentos-pendentes", "Documentos pendentes"],
    ["/financeiro/comissao", "Comissão"],
    ["/financeiro/holerite", "Holerite"],
    ["/financeiro", "Financeiro"],
    ["/instituicoes", "Instituições"],
    ["/termos", "Termos"],
    ["/vagas", "Vagas"],
    ["/contratacoes", "Contratações"],
    ["/candidatos", "Candidatos"],
    ["/empresas", "Empresas"],
  ];
  return rotas.find(([prefixo]) => pathname.startsWith(prefixo))?.[1] ?? "Interno";
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
    "flex h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold transition duration-150",
    isActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_#22d3ee]" : "text-slate-300 hover:bg-white/10 hover:text-white",
  );
  const label = (text: string) => <span className={cn("overflow-hidden whitespace-nowrap transition-all duration-300", expanded ? "max-w-56 opacity-100" : "max-w-0 opacity-0")}>{text}</span>;

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
      <NavLink to="/emails" onClick={() => setOpen(false)} title="E-mails" className={linkClass}>
        <Mail size={18} className="shrink-0" /> {label("E-mails")}
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
        className={cn("hidden overflow-x-hidden bg-gradient-to-b from-navy-900 to-navy-950 text-white transition-[width] duration-300 ease-out lg:flex lg:min-h-screen lg:flex-col", hover ? "lg:w-80" : "lg:w-[76px]")}
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
          <button type="button" title="Sair" onClick={() => void logout()} className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold text-slate-300 transition duration-150 hover:bg-white/10 hover:text-white">
            <LogOut size={18} className="shrink-0" />
            <span className={cn("overflow-hidden whitespace-nowrap transition-all duration-300", expanded ? "max-w-56 opacity-100" : "max-w-0 opacity-0")}>Sair</span>
          </button>
          <p className={cn("truncate px-3 pt-2 text-xs text-slate-400", expanded ? "" : "hidden")}>{email}</p>
        </div>
      </aside>
      {open ? <div className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-80 flex-col bg-navy-900 p-4 text-white lg:hidden", open ? "translate-x-0" : "hidden")}>
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur">
          <button className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100 lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <p className="hidden text-sm font-semibold text-navy-900 sm:block">{tituloDaRota(pathname)}</p>
          {pathname.startsWith("/emails") ? <div className="flex-1" /> : (
            <form className="relative ml-auto w-full max-w-md" onSubmit={(event) => { event.preventDefault(); navigate(`/candidatos?nome=${encodeURIComponent(query)}`); }}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input aria-label="Buscar candidatos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar candidato por nome" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:bg-white focus:ring-4 focus:ring-cyan-700/20" />
            </form>
          )}
        </header>
        <main className={cn("mx-auto p-4 md:p-6", pathname.startsWith("/emails") ? "max-w-none" : "max-w-7xl")}><Outlet /></main>
      </div>
    </div>
  );
}
