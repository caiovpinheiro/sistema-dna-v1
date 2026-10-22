import { Briefcase, Building2, FileSignature, Handshake, LayoutDashboard, LogOut, Menu, Search, Users, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "./ui";

const items = [
  { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
  { to: "/candidatos", label: "Candidatos", icon: Users },
  { to: "/empresas", label: "Empresas", icon: Building2 },
  { to: "/vagas", label: "Vagas", icon: Briefcase },
  { to: "/contratacoes", label: "Contratações", icon: Handshake },
  { to: "/termos", label: "Termos", icon: FileSignature },
];

export function Shell({ email, notify }: { email: string; notify: (message: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  async function logout() {
    await api("/api/v1/auth/logout", { method: "POST" });
    notify("Sessão encerrada.");
    window.location.href = "/login";
  }

  const nav = (
    <nav className="grid gap-1">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}
          className={({ isActive }) => cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold", isActive ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}>
          <item.icon size={18} /> {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden bg-navy-900 text-white lg:flex lg:flex-col lg:px-4 lg:py-6">
        <div className="mb-8 flex items-center gap-3 px-2">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-400 font-extrabold text-navy-950">DW</span>
          <div>
            <div className="text-sm font-extrabold tracking-wide">DNAWORK</div>
            <div className="text-xs text-slate-400">Recrutamento</div>
          </div>
        </div>
        {nav}
        <div className="mt-auto px-2 text-xs text-slate-400">{email}</div>
      </aside>
      {open ? <div className="fixed inset-0 z-40 bg-navy-950/50 lg:hidden" onClick={() => setOpen(false)} /> : null}
      <aside className={cn("fixed inset-y-0 left-0 z-50 w-72 bg-navy-900 p-4 text-white lg:hidden", open ? "translate-x-0" : "hidden")}>
        <div className="mb-6 flex items-center justify-between">
          <strong>DNAWORK</strong>
          <button aria-label="Fechar menu" onClick={() => setOpen(false)}><X /></button>
        </div>
        {nav}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button className="grid h-10 w-10 place-items-center rounded-xl hover:bg-slate-100 lg:hidden" aria-label="Abrir menu" onClick={() => setOpen(true)}><Menu /></button>
          <form className="relative max-w-xl flex-1" onSubmit={(event) => { event.preventDefault(); navigate(`/candidatos?nome=${encodeURIComponent(query)}`); }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input aria-label="Buscar candidatos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar candidato por nome" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm" />
          </form>
          <button className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" onClick={() => void logout()}><LogOut size={16} /> Sair</button>
        </header>
        <main className="mx-auto max-w-7xl p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
