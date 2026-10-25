import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatCpf } from "@/lib/format";

type Company = { id_empresa: string; razao_social: string; nome_fantasia: string | null };
type Job = { id_vaga: string; cargo: string };
type Person = { id_candidato: string; nome: string; cpf: string };

export function ProcessoFormPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyId, setCompanyId] = useState(params.get("empresa") ?? "");
  const [jobId, setJobId] = useState(params.get("vaga") ?? "");
  const [personQuery, setPersonQuery] = useState("");
  const [personId, setPersonId] = useState(params.get("candidato") ?? "");
  const [origem, setOrigem] = useState<"dnawork" | "empresa">("dnawork");
  const [recebimento, setRecebimento] = useState(new Date().toISOString().slice(0, 10));
  const [encaminhamento, setEncaminhamento] = useState("");
  const [observacao, setObservacao] = useState("");
  const companies = useQuery({ queryKey: ["busca-empresas", companyQuery], queryFn: () => api<Company[]>(`/api/v1/empresas?pageSize=8&q=${encodeURIComponent(companyQuery)}`), enabled: companyQuery.length >= 2 });
  const jobs = useQuery({ queryKey: ["vagas-empresa", companyId], queryFn: () => api<Job[]>(`/api/v1/empresas/${companyId}/vagas?pageSize=50`), enabled: Boolean(companyId) });
  const people = useQuery({ queryKey: ["busca-candidatos", personQuery], queryFn: () => api<Person[]>(`/api/v1/candidatos?pageSize=8&nome=${encodeURIComponent(personQuery)}`), enabled: personQuery.length >= 2 });
  const save = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/processos", {
      method: "POST",
      body: JSON.stringify({
        id_candidato: personId,
        id_empresa: companyId,
        id_vaga: jobId,
        origem,
        data_recebimento: recebimento,
        data_encaminhamento: encaminhamento || undefined,
        observacao: observacao || undefined,
      }),
    }),
    onSuccess: (result) => navigate(`/processos/${result.data.id}`),
  });
  return (
    <form className="grid max-w-3xl gap-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Novo processo</h1>
          <p className="text-sm text-slate-400">Informe quem enviou o candidato e para qual vaga.</p>
        </div>
        <Button disabled={!personId || !companyId || !jobId || save.isPending}>Abrir processo</Button>
      </div>
      {save.error instanceof ApiError ? <p className="text-sm text-rose-300">{save.error.message}</p> : null}
      <section className="grid gap-3 rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
        <Field label="Empresa">
          <Input aria-label="Buscar empresa" placeholder="Nome da empresa" value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} />
        </Field>
        <div className="grid gap-2">
          {companies.data?.data.map((item) => (
            <button type="button" key={item.id_empresa} className={`rounded-lg px-3 py-2 text-left text-sm ${companyId === item.id_empresa ? "bg-cyan-400/15 text-cyan-100" : "text-slate-300 hover:bg-white/5"}`} onClick={() => { setCompanyId(item.id_empresa); setJobId(""); }}>
              {item.nome_fantasia || item.razao_social}
            </button>
          ))}
        </div>
        <Field label="Vaga">
          <div className="grid gap-2">
            {(jobs.data?.data ?? []).map((item) => (
              <button type="button" key={item.id_vaga} className={`rounded-lg px-3 py-2 text-left text-sm ${jobId === item.id_vaga ? "bg-cyan-400/15 text-cyan-100" : "text-slate-300 hover:bg-white/5"}`} onClick={() => setJobId(item.id_vaga)}>{item.cargo}</button>
            ))}
            {companyId && jobs.data && jobs.data.data.length === 0 ? <p className="text-sm text-slate-400">Esta empresa não tem vagas.</p> : null}
          </div>
        </Field>
      </section>
      <section className="grid gap-3 rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10">
        <Field label="Candidato">
          <Input aria-label="Buscar candidato" placeholder="Nome do candidato" value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} />
        </Field>
        <div className="grid gap-2">
          {people.data?.data.map((item) => (
            <button type="button" key={item.id_candidato} className={`rounded-lg px-3 py-2 text-left text-sm ${personId === item.id_candidato ? "bg-cyan-400/15 text-cyan-100" : "text-slate-300 hover:bg-white/5"}`} onClick={() => setPersonId(item.id_candidato)}>
              {item.nome} <span className="text-slate-500">{formatCpf(item.cpf)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="grid gap-4 rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10 md:grid-cols-2">
        <fieldset className="grid gap-2 md:col-span-2">
          <legend className="text-sm text-slate-300">Origem</legend>
          <label className="flex items-center gap-2 text-sm text-slate-200"><input type="radio" name="origem" checked={origem === "dnawork"} onChange={() => setOrigem("dnawork")} /> Captado pela DNAWORK</label>
          <label className="flex items-center gap-2 text-sm text-slate-200"><input type="radio" name="origem" checked={origem === "empresa"} onChange={() => setOrigem("empresa")} /> Enviado pela empresa</label>
        </fieldset>
        <Field label="Data de recebimento"><Input type="date" value={recebimento} onChange={(event) => setRecebimento(event.target.value)} required /></Field>
        <Field label="Data de encaminhamento"><Input type="date" value={encaminhamento} onChange={(event) => setEncaminhamento(event.target.value)} required={origem === "dnawork"} /></Field>
        <div className="md:col-span-2"><Field label="Observação"><Textarea value={observacao} onChange={(event) => setObservacao(event.target.value)} /></Field></div>
      </section>
    </form>
  );
}
