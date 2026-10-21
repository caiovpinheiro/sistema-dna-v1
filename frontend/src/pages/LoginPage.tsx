import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Field, Input } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: () => api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Falha no login."),
  });

  return (
    <div className="grid min-h-screen place-items-center bg-navy-950 px-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-900 font-extrabold text-cyan-300">DW</span>
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
    </div>
  );
}
