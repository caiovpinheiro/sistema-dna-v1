import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Field, Input } from "@/components/ui";
import { ApiError, api, idempotencyKey } from "@/lib/api";
import { formatCpf, regimeLabel } from "@/lib/format";

type Company = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string };
type Job = { id_vaga: string; cargo: string; regime: string; situacao: string; disponiveis: number | null; quantidade_posicoes: number | null; ocupadas: number };
type Person = { id_candidato: string; nome: string; cpf: string };

export function NovaContratacaoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyId, setCompanyId] = useState(params.get("empresa") ?? "");
  const [jobId, setJobId] = useState(params.get("vaga") ?? "");
  const [personQuery, setPersonQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ nome: "", cpf: "", email: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id_contratacao: number; id_colaborador: string; id_candidato: string; id_vaga: string; id_empresa: string } | null>(null);

  const companies = useQuery({ queryKey: ["busca-empresas", companyQuery], queryFn: () => api<Company[]>(`/api/v1/empresas?pageSize=8&q=${encodeURIComponent(companyQuery)}`), enabled: companyQuery.length >= 2 });
  const jobs = useQuery({ queryKey: ["vagas-empresa", companyId], queryFn: () => api<Job[]>(`/api/v1/empresas/${companyId}/vagas?pageSize=50`), enabled: Boolean(companyId) });
  const people = useQuery({ queryKey: ["busca-candidatos", personQuery], queryFn: () => api<Person[]>(`/api/v1/candidatos?pageSize=8&nome=${encodeURIComponent(personQuery)}`), enabled: personQuery.length >= 2 });
  const available = useMemo(() => (jobs.data?.data ?? []).filter((job) => job.situacao === "aberta"), [jobs.data]);
  const selectedJob = jobs.data?.data.find((job) => job.id_vaga === jobId);

  const createPerson = useMutation({
    mutationFn: () => api<Person>("/api/v1/candidatos", { method: "POST", body: JSON.stringify(draft) }),
    onSuccess: async (response) => {
      setPersonId(response.data.id_candidato);
      setShowCreate(false);
      await client.invalidateQueries({ queryKey: ["busca-candidatos"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Não foi possível cadastrar o candidato."),
  });
  const hire = useMutation({
    mutationFn: () => api<{ id_contratacao: number; id_colaborador: string; id_candidato: string; id_vaga: string; id_empresa: string }>("/api/v1/contratacoes", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ id_candidato: personId, id_vaga: jobId, data_inicio: start }),
    }),
    onSuccess: (response) => setResult(response.data),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Não foi possível contratar."),
  });

  if (result) {
    return (
      <Card className="grid max-w-xl gap-3">
        <h1 className="text-2xl font-extrabold">Contratação registrada</h1>
        <p>Contratação <strong>{result.id_contratacao}</strong></p>
        <p className="text-sm text-slate-500">Candidato {result.id_candidato}<br />Vaga {result.id_vaga}<br />Empresa {result.id_empresa}<br />Colaborador {result.id_colaborador}</p>
        <Button onClick={() => navigate(`/contratacoes/${result.id_contratacao}`)}>Abrir vínculo</Button>
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <h1 className="text-2xl font-extrabold">Nova contratação</h1>
      {error ? <p className="text-sm text-rose-600" role="alert">{error}</p> : null}
      <Card className="grid gap-3">
        <h2 className="font-bold">1. Empresa</h2>
        <Input aria-label="Buscar empresa" placeholder="CNPJ, razão social ou fantasia" value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} />
        <div className="grid gap-2">{companies.data?.data.map((item) => (
          <button type="button" key={item.id_empresa} className={`rounded-xl border px-3 py-2 text-left ${companyId === item.id_empresa ? "border-cyan-600 bg-cyan-50" : "border-slate-200"}`} onClick={() => { setCompanyId(item.id_empresa); setJobId(""); }}>
            <strong>{item.nome_fantasia || item.razao_social}</strong><span className="block text-xs text-slate-500">{item.cnpj}</span>
          </button>
        ))}</div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="font-bold">2. Vaga disponível</h2>
        {!companyId ? <p className="text-sm text-slate-500">Selecione a empresa para ver as vagas.</p> : available.length ? available.map((job) => (
          <button type="button" key={job.id_vaga} className={`rounded-xl border px-3 py-3 text-left ${jobId === job.id_vaga ? "border-cyan-600 bg-cyan-50" : "border-slate-200"}`} onClick={() => setJobId(job.id_vaga)}>
            <strong>{job.cargo}</strong>
            <span className="mt-1 block text-sm">{job.quantidade_posicoes} posições · {job.ocupadas} preenchidas · {job.disponiveis} disponíveis · {regimeLabel[job.regime]}</span>
          </button>
        )) : <p className="text-sm text-slate-500">Não há vaga aberta com posição livre nesta empresa.</p>}
      </Card>
      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><h2 className="font-bold">3. Candidato</h2><Button type="button" variant="secondary" onClick={() => setShowCreate((value) => !value)}>Criar candidato</Button></div>
        <Input aria-label="Buscar candidato" placeholder="Nome" value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} />
        <div className="grid gap-2">{people.data?.data.map((item) => (
          <button type="button" key={item.id_candidato} className={`rounded-xl border px-3 py-2 text-left ${personId === item.id_candidato ? "border-cyan-600 bg-cyan-50" : "border-slate-200"}`} onClick={() => setPersonId(item.id_candidato)}>
            <strong>{item.nome}</strong><span className="ml-2 text-xs text-slate-500">{formatCpf(item.cpf)}</span>
          </button>
        ))}</div>
        {showCreate ? (
          <div className="grid gap-3 rounded-xl bg-slate-50 p-3 md:grid-cols-3">
            <Field label="Nome"><Input value={draft.nome} onChange={(event) => setDraft({ ...draft, nome: event.target.value })} /></Field>
            <Field label="CPF"><Input value={draft.cpf} onChange={(event) => setDraft({ ...draft, cpf: event.target.value })} /></Field>
            <Field label="E-mail"><Input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field>
            <Button type="button" onClick={() => createPerson.mutate()} disabled={createPerson.isPending}>Salvar candidato</Button>
          </div>
        ) : null}
      </Card>
      <Card className="grid gap-3 md:max-w-sm">
        <Field label="Data de início"><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
        <Button disabled={!jobId || !personId || !selectedJob || hire.isPending} onClick={() => { setError(""); hire.mutate(); }}>Registrar contratação</Button>
        {!jobId ? <p className="text-xs text-slate-500">A contratação só é concluída com uma vaga válida.</p> : null}
      </Card>
    </div>
  );
}
