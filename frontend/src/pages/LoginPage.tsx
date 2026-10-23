import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Field, Input } from "@/components/ui";
import { FundoLiquido } from "@/components/fundo-liquido";
import { ApiError, api } from "@/lib/api";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [entrou, setEntrou] = useState("");
  const navigate = useNavigate();
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: () => api<{ nome?: string }>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async (resposta) => {
      await client.invalidateQueries({ queryKey: ["me"] });
      setEntrou(resposta.data.nome || email);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha no login."),
  });

  useEffect(() => {
    if (!entrou) return;
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => navigate("/"), reduzido ? 350 : 1100);
    return () => window.clearTimeout(timer);
  }, [entrou, navigate]);

  if (entrou) {
    return (
      <FundoLiquido>
        <div className="login-ok" role="status">
          <span className="login-badge">
            <span className="login-ring" />
            <Check size={36} strokeWidth={2.6} />
          </span>
          <p className="login-title">Login realizado</p>
          <p className="login-sub">{entrou}</p>
        </div>
      </FundoLiquido>
    );
  }

  return (
    <FundoLiquido>
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo-mono.png" alt="DNAWORK" className="h-12 w-20 object-contain" />
          <div>
            <h1 className="text-2xl font-extrabold text-navy-900">DNAWORK</h1>
            <p className="text-sm text-slate-500">Acesso administrativo</p>
          </div>
        </div>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); setError(""); login.mutate(); }}>
          <Field label="E-mail"><Input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label="Senha"><Input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
          <Button type="submit" disabled={login.isPending}>{login.isPending ? "Entrando…" : "Entrar"}</Button>
        </form>
      </Card>
    </FundoLiquido>
  );
}
