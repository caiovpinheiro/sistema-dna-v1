import { Briefcase, Building2, ChevronDown, FileSignature, FileWarning, GraduationCap, Handshake, LayoutDashboard, ListChecks, LogOut, Mail, Menu, Moon, Percent, Receipt, Settings, Sun, Users, Wallet, X } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "./ui";

type LinkItem = { id: string; to: string; label: string; end?: boolean };

const items = [
  { id: "painel", to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { id: "candidatos", to: "/candidatos", label: "Candidatos", icon: Users },
  { id: "empresas", to: "/empresas", label: "Empresas", icon: Building2 },
];

const afterVagas = [
  { id: "processos", to: "/processos", label: "Processos", icon: ListChecks },
];

const contratacaoLinks: LinkItem[] = [
  { id: "contratacoes", to: "/contratacoes", label: "Consultar", end: true },
  { id: "contratacoes", to: "/contratacoes/rescisao", label: "Rescisão" },
];

const termoLinks: LinkItem[] = [
  { id: "termos", to: "/termos", label: "Consultar", end: true },
  { id: "termos-gerar", to: "/termos/gerar", label: "Gerar TCE" },
];

const vagaLinks: LinkItem[] = [
  { id: "vagas", to: "/vagas", label: "Consultar", end: true },
  { id: "vagas-modelos", to: "/vagas/modelos", label: "Consultar Modelos", end: true },
  { id: "vagas-modelo", to: "/vagas/modelos/novo", label: "Cadastrar Modelo" },
];

const instituicaoLinks: LinkItem[] = [
  { id: "instituicoes", to: "/instituicoes", label: "Consultar", end: true },
  { id: "instituicoes-nova", to: "/instituicoes/nova", label: "Cadastrar" },
];

const financeLinks: LinkItem[] = [
  { id: "faturamento", to: "/financeiro/faturamento", label: "Gerar Faturamento" },
  { id: "contas", to: "/financeiro/contas-a-receber", label: "Contas a Receber" },
  { id: "regua", to: "/financeiro/regua", label: "Régua de cobrança" },
  { id: "procfy", to: "/financeiro/relatorio-procfy", label: "Relatório Procfy" },
];

const comissaoLinks: LinkItem[] = [
  { id: "comissao", to: "/financeiro/comissao", label: "Consultar", end: true },
  { id: "comissao-empresas", to: "/financeiro/comissao/empresas", label: "Empresas" },
];

const CAMINHOS: Array<[string, string]> = [
  ["/financeiro/comissao/empresas", "comissao-empresas"],
  ["/financeiro/comissao", "comissao"],
  ["/financeiro/faturamento", "faturamento"],
  ["/financeiro/contas-a-receber", "contas"],
  ["/financeiro/regua", "regua"],
  ["/financeiro/relatorio-procfy", "procfy"],
  ["/financeiro/holerite", "holerite"],
  ["/vagas/modelos/novo", "vagas-modelo"],
  ["/vagas/modelos", "vagas-modelos"],
  ["/vagas", "vagas"],
  ["/termos/gerar", "termos-gerar"],
  ["/termos", "termos"],
  ["/instituicoes/nova", "instituicoes-nova"],
  ["/instituicoes", "instituicoes"],
  ["/candidatos", "candidatos"],
  ["/empresas", "empresas"],
  ["/processos", "processos"],
  ["/contratacoes/rescisao", "contratacoes"],
  ["/contratacoes", "contratacoes"],
  ["/emails", "emails"],
  ["/documentos-pendentes", "documentos"],
];

export function paginaDoCaminho(pathname: string) {
  if (pathname === "/") return "painel";
  return CAMINHOS.find(([prefixo]) => pathname === prefixo || pathname.startsWith(`${prefixo}/`))?.[1] ?? null;
}

function SideGroup({ label, icon: Icon, active, expanded, links, onNavigate }: {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  expanded: boolean;
  links: Array<{ to: string; label: string; end?: boolean }>;
  onNavigate: () => void;
}) {
  if (!links.length) return null;
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (!expanded) setOpen(false);
    else if (active) setOpen(true);
  }, [expanded, active]);
  const visivel = open && expanded;
  const subClass = ({ isActive }: { isActive: boolean }) => cn(
    "block rounded-lg px-3 py-1.5 text-[13px] font-medium transition duration-150",
    isActive ? "bg-white/10 text-cyan-100" : "text-slate-400 hover:bg-white/10 hover:text-white",
  );
  return (
    <div className="grid gap-1">
      <button type="button" aria-expanded={visivel} title={label} onClick={() => setOpen((value) => !value)}
        className={cn("flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-semibold transition duration-150", active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white")}>
        <Icon size={18} className="shrink-0" />
        <span className={cn("overflow-hidden whitespace-nowrap text-left transition-all duration-300", expanded ? "max-w-56 opacity-100" : "max-w-0 opacity-0")}>{label}</span>
        <ChevronDown size={16} className={cn("ml-auto shrink-0 transition duration-200", expanded ? "" : "w-0 opacity-0", open ? "" : "-rotate-90")} />
      </button>
      {visivel ? (
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
    ["/configuracoes", "Configurações"],
    ["/emails", "E-mails"],
    ["/documentos-pendentes", "Documentos pendentes"],
    ["/financeiro/comissao", "Comissão"],
    ["/financeiro/holerite", "Holerite"],
    ["/financeiro", "Financeiro"],
    ["/instituicoes", "Instituições"],
    ["/termos", "Termos"],
    ["/processos", "Processos"],
    ["/vagas", "Vagas"],
    ["/contratacoes", "Contratações"],
    ["/candidatos", "Candidatos"],
    ["/empresas", "Empresas"],
  ];
  return rotas.find(([prefixo]) => pathname.startsWith(prefixo))?.[1] ?? "Interno";
}

export function Shell({ email, admin, paginas, notify }: { email: string; admin: boolean; paginas: string[]; notify: (message: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [escuro, setEscuro] = useState(() => localStorage.getItem("dnawork-tema") !== "claro");
  const { pathname } = useLocation();
  useEffect(() => {
    const tema = escuro ? "escuro" : "claro";
    localStorage.setItem("dnawork-tema", tema);
    document.documentElement.dataset.tema = tema;
    window.dispatchEvent(new Event("dnawork-tema"));
  }, [escuro]);

  const financeiroActive = pathname.startsWith("/financeiro") && !pathname.startsWith("/financeiro/comissao") && !pathname.startsWith("/financeiro/holerite");
  const comissaoActive = pathname.startsWith("/financeiro/comissao");
  const vagaActive = pathname.startsWith("/vagas");
  const instituicaoActive = pathname.startsWith("/instituicoes");
  const termoActive = pathname.startsWith("/termos");
  const contratacaoActive = pathname.startsWith("/contratacoes");
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

  const permitido = (id: string) => admin || paginas.includes(id);
  const nav = (
    <nav className="grid gap-1">
      {items.filter((item) => permitido(item.id)).map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} title={item.label} className={linkClass}>
          <item.icon size={18} className="shrink-0" /> {label(item.label)}
        </NavLink>
      ))}
      <SideGroup label="Vagas" icon={Briefcase} active={vagaActive} expanded={expanded} links={vagaLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      {afterVagas.filter((item) => permitido(item.id)).map((item) => (
        <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} title={item.label} className={linkClass}>
          <item.icon size={18} className="shrink-0" /> {label(item.label)}
        </NavLink>
      ))}
      <SideGroup label="Contratações" icon={Handshake} active={contratacaoActive} expanded={expanded} links={contratacaoLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      <SideGroup label="Termos" icon={FileSignature} active={termoActive} expanded={expanded} links={termoLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      <SideGroup label="Instituições" icon={GraduationCap} active={instituicaoActive} expanded={expanded} links={instituicaoLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      <SideGroup label="Financeiro" icon={Wallet} active={financeiroActive} expanded={expanded} links={financeLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      <SideGroup label="Comissão" icon={Percent} active={comissaoActive} expanded={expanded} links={comissaoLinks.filter((item) => permitido(item.id))} onNavigate={() => setOpen(false)} />
      {permitido("holerite") ? (
        <NavLink to="/financeiro/holerite" onClick={() => setOpen(false)} title="Holerite" className={linkClass}>
          <Receipt size={18} className="shrink-0" /> {label("Holerite")}
        </NavLink>
      ) : null}
      {permitido("emails") ? (
        <NavLink to="/emails" onClick={() => setOpen(false)} title="E-mails" className={linkClass}>
          <Mail size={18} className="shrink-0" /> {label("E-mails")}
        </NavLink>
      ) : null}
      {permitido("documentos") ? (
        <NavLink to="/documentos-pendentes" onClick={() => setOpen(false)} title="Documentos Pendentes" className={linkClass}>
          <FileWarning size={18} className="shrink-0" /> {label("Documentos Pendentes")}
        </NavLink>
      ) : null}
      {admin ? (
        <NavLink to="/configuracoes" onClick={() => setOpen(false)} title="Configurações" className={linkClass}>
          <Settings size={18} className="shrink-0" /> {label("Configurações")}
        </NavLink>
      ) : null}
    </nav>
  );

  return (
    <div className={cn("app-canvas flex h-screen overflow-hidden", escuro ? "escuro" : "claro")}>
      <aside
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn("sticky top-0 hidden h-screen shrink-0 overflow-x-hidden border-r border-white/10 bg-[#0b0d12] text-white transition-[width] duration-300 ease-out lg:flex lg:flex-col", hover ? "lg:w-80" : "lg:w-[76px]")}
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
      <aside className={cn("fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-white/10 bg-[#0b0d12] p-4 text-white lg:hidden", open ? "translate-x-0" : "hidden")}>
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
      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/10 bg-[#0e1014] px-4">
          <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <p className="hidden text-sm font-semibold text-white sm:block">{tituloDaRota(pathname)}</p>
          <button
            type="button"
            className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label={escuro ? "Usar visual claro" : "Usar visual escuro"}
            title={escuro ? "Visual claro" : "Visual escuro"}
            onClick={() => setEscuro((atual) => !atual)}
          >
            {escuro ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <main className={cn("min-h-0 flex-1 overflow-y-auto p-4 md:p-6", pathname.startsWith("/emails") ? "" : "mx-auto w-full max-w-7xl")}>
          {pathname.startsWith("/configuracoes") && !admin ? <p className="text-sm text-slate-300">Somente o administrador configura os acessos.</p> : paginaDoCaminho(pathname) && !permitido(paginaDoCaminho(pathname)!) ? <p className="text-sm text-slate-300">Você não tem acesso a esta página.</p> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
