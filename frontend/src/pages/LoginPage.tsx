import { useMutation, useQueryClient } from "@tanstack/react-query";
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
    const timer = window.setTimeout(() => navigate("/"), 8000);
    return () => window.clearTimeout(timer);
  }, [entrou, navigate]);

  if (entrou) {
    return (
      <FundoLiquido>
        <div className="grid w-full max-w-xs justify-items-center rounded-[2rem] bg-white px-8 py-8 text-center shadow-2xl" role="status">
          <video
            className="h-44 w-44 rounded-2xl object-contain"
            src="/login-sucesso.webm"
            autoPlay
            muted
            playsInline
            aria-label={`Login realizado, ${entrou}`}
            onEnded={() => navigate("/")}
          />
          <p className="mt-4 text-lg font-extrabold text-navy-900">Login realizado</p>
          <p className="text-sm text-slate-500">{entrou}</p>
        </div>
      </FundoLiquido>
    );
  }

  return (
    <FundoLiquido>
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-4">
          <img src="/logo-laranja.png" alt="DNA Work" className="h-14 w-24 object-contain" />
          <h1 className="text-sm font-semibold text-slate-500">Acesso administrativo</h1>
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
