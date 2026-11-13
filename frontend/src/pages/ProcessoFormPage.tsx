import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, Plus, Search } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Button, Field, Input, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatCpf, textoPlano } from "@/lib/format";

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
  const empresaEscolhida = companies.data?.data.find((item) => item.id_empresa === companyId);
  const pronto = Boolean(personId && companyId && jobId);
  return (
    <form className="grid max-w-4xl grid-cols-[minmax(0,1fr)] gap-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <Link to="/processos" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900">
        <ArrowLeft size={16} /> Processos
      </Link>
      <CabecalhoPagina titulo="Novo processo" descricao="Informe a vaga, o candidato e quem o enviou. O processo começa na etapa certa conforme a origem." />

      <Bloco numero={1} titulo="Empresa e vaga" texto="Busque a empresa (pelo menos 2 letras) e escolha uma das vagas dela." feito={Boolean(companyId && jobId)}>
        <Field label="Empresa">
          <BuscaCampo aria-label="Buscar empresa" placeholder="Nome da empresa" value={companyQuery} onChange={setCompanyQuery} />
        </Field>
        {companyQuery.length >= 2 && companies.data && companies.data.data.length === 0 ? <p className="text-sm text-slate-500">Nenhuma empresa encontrada com esse texto.</p> : null}
        {companies.data?.data.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {companies.data.data.map((item) => (
              <Opcao key={item.id_empresa} ativo={companyId === item.id_empresa} onClick={() => { setCompanyId(item.id_empresa); setJobId(""); }}>
                <span className="block truncate font-semibold text-navy-900">{textoPlano(item.nome_fantasia) || textoPlano(item.razao_social)}</span>
              </Opcao>
            ))}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-slate-700">Vaga{empresaEscolhida ? ` de ${textoPlano(empresaEscolhida.nome_fantasia) || textoPlano(empresaEscolhida.razao_social)}` : ""}</span>
          {!companyId ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Escolha a empresa para ver as vagas.</p> : null}
          {companyId && jobs.isLoading ? <p className="text-sm text-slate-500">Carregando vagas…</p> : null}
          {(jobs.data?.data ?? []).length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {(jobs.data?.data ?? []).map((item) => (
                <Opcao key={item.id_vaga} ativo={jobId === item.id_vaga} onClick={() => setJobId(item.id_vaga)}>
                  <span className="block truncate font-semibold text-navy-900">{textoPlano(item.cargo)}</span>
                </Opcao>
              ))}
            </div>
          ) : null}
          {companyId && jobs.data && jobs.data.data.length === 0 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Esta empresa não tem vagas.</p> : null}
        </div>
      </Bloco>

      <Bloco numero={2} titulo="Candidato" texto="Busque o candidato pelo nome (pelo menos 2 letras)." feito={Boolean(personId)}>
        <Field label="Candidato">
          <BuscaCampo aria-label="Buscar candidato" placeholder="Nome do candidato" value={personQuery} onChange={setPersonQuery} />
        </Field>
        {personQuery.length >= 2 && people.data && people.data.data.length === 0 ? <p className="text-sm text-slate-500">Nenhum candidato com esse nome.</p> : null}
        {people.data?.data.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {people.data.data.map((item) => (
              <Opcao key={item.id_candidato} ativo={personId === item.id_candidato} onClick={() => setPersonId(item.id_candidato)}>
                <span className="block truncate font-semibold text-navy-900">{textoPlano(item.nome)}</span>
                <span className="block text-xs tabular-nums text-slate-500">CPF {formatCpf(item.cpf)}</span>
              </Opcao>
            ))}
          </div>
        ) : null}
        {personId && !people.data?.data.some((item) => item.id_candidato === personId) ? <p className="text-xs text-slate-500">Candidato já escolhido pelo link de origem. Busque outro nome para trocar.</p> : null}
      </Bloco>

      <Bloco numero={3} titulo="Origem e datas" texto="Quem trouxe o candidato. Captado pela DNAWORK exige a data de encaminhamento." feito={false}>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Origem</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <OrigemOpcao nome="Captado pela DNAWORK" texto="Veio pelo atendimento da DNA Work." ativo={origem === "dnawork"} onChange={() => setOrigem("dnawork")} />
            <OrigemOpcao nome="Enviado pela empresa" texto="A própria empresa indicou o candidato." ativo={origem === "empresa"} onChange={() => setOrigem("empresa")} />
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="sm:col-span-2"><Field label="Data de recebimento"><Input type="date" value={recebimento} onChange={(event) => setRecebimento(event.target.value)} required /></Field></div>
          <div className="sm:col-span-2"><Field label={origem === "dnawork" ? "Data de encaminhamento (obrigatória)" : "Data de encaminhamento"}><Input type="date" value={encaminhamento} onChange={(event) => setEncaminhamento(event.target.value)} required={origem === "dnawork"} /></Field></div>
          <div className="sm:col-span-6"><Field label="Observação"><Textarea value={observacao} onChange={(event) => setObservacao(event.target.value)} placeholder="Opcional. Fica no primeiro registro do histórico." /></Field></div>
        </div>
      </Bloco>

      {save.error instanceof ApiError ? <Alerta>{save.error.message}</Alerta> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-11" disabled={!pronto || save.isPending}><Plus size={16} /> {save.isPending ? "Abrindo…" : "Abrir processo"}</Button>
        {!pronto ? <p className="text-sm text-slate-500">Escolha a empresa, a vaga e o candidato para liberar o botão.</p> : null}
      </div>
    </form>
  );
}

function Bloco({ numero, titulo, texto, feito, children }: { numero: number; titulo: string; texto: string; feito: boolean; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5">
      <header className="flex items-start gap-3">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold", feito ? "bg-emerald-50 text-emerald-800" : "bg-cyan-700 text-white")}>
          {feito ? <Check size={14} /> : numero}
        </span>
        <div>
          <h2 className="text-base font-bold text-navy-900">{titulo}</h2>
          <p className="text-sm text-slate-500">{texto}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function BuscaCampo({ value, onChange, placeholder, "aria-label": ariaLabel }: { value: string; onChange: (valor: string) => void; placeholder: string; "aria-label": string }) {
  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input aria-label={ariaLabel} placeholder={placeholder} value={value} autoComplete="off" className="pl-9" onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn("w-full min-w-0 rounded-lg border px-3 py-2.5 text-left text-sm transition", ativo ? "border-cyan-700 bg-cyan-50" : "border-slate-200 bg-white hover:bg-slate-50")}
    >
      {children}
    </button>
  );
}

function OrigemOpcao({ nome, texto, ativo, onChange }: { nome: string; texto: string; ativo: boolean; onChange: () => void }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition", ativo ? "border-cyan-700 bg-cyan-50" : "border-slate-200 bg-white hover:bg-slate-50")}>
      <input type="radio" name="origem" className="mt-0.5 accent-cyan-700" checked={ativo} onChange={onChange} />
      <span>
        <span className="block font-semibold text-navy-900">{nome}</span>
        <span className="block text-xs text-slate-500">{texto}</span>
      </span>
    </label>
  );
}
