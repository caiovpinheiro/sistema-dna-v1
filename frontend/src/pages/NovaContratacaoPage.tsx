import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronRight, Search, UserCheck, UserPlus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Badge, Button, Card, Field, Input, cn } from "@/components/ui";
import { ApiError, api, idempotencyKey } from "@/lib/api";
import { dateBr, formatCnpj, formatCpf, money, regimeLabel, textoPlano } from "@/lib/format";

type Company = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string };
type Job = {
  id_vaga: string; cargo: string; regime: string; modalidade: string | null; situacao: string;
  disponiveis: number | null; quantidade_posicoes: number | null; ocupadas: number; salario: number | null;
  codigo: string | null; horario: string | null; local: string | null; beneficios: string | null;
  carga_horaria: string | null; sexo: string | null; idade: string | null; idade_ate: string | null;
};
type Person = { id_candidato: string; nome: string; cpf: string };

function sexoDaVaga(valor: string | null) {
  const sexo = (valor ?? "").trim().toUpperCase();
  if (sexo === "M") return "Masculino";
  if (sexo === "F") return "Feminino";
  if (sexo === "I" || sexo === "A") return "Indiferente";
  return sexo || "—";
}

function faixaIdade(de: string | null, ate: string | null) {
  const inicio = (de ?? "").trim();
  const fim = (ate ?? "").trim();
  if (inicio && fim) return `${inicio} a ${fim} anos`;
  if (inicio) return `a partir de ${inicio} anos`;
  if (fim) return `até ${fim} anos`;
  return "—";
}

export function NovaContratacaoPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyId, setCompanyId] = useState(params.get("empresa") ?? "");
  const [jobId, setJobId] = useState(params.get("vaga") ?? "");
  const [personQuery, setPersonQuery] = useState("");
  const [personId, setPersonId] = useState(params.get("candidato") ?? "");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ nome: "", cpf: "", email: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id_contratacao: number; id_colaborador: string; id_candidato: string; id_vaga: string; id_empresa: string } | null>(null);
  // Só para mostrar no resumo o nome do que foi escolhido (a busca some quando o texto muda).
  const [companyName, setCompanyName] = useState("");
  const [personName, setPersonName] = useState("");

  const companies = useQuery({ queryKey: ["busca-empresas", companyQuery], queryFn: () => api<Company[]>(`/api/v1/empresas?pageSize=8&q=${encodeURIComponent(companyQuery)}`), enabled: companyQuery.length >= 2 });
  const jobs = useQuery({ queryKey: ["vagas-empresa", companyId], queryFn: () => api<Job[]>(`/api/v1/empresas/${companyId}/vagas?pageSize=100&situacao=aberta`), enabled: Boolean(companyId) });
  const people = useQuery({ queryKey: ["busca-candidatos", personQuery], queryFn: () => api<Person[]>(`/api/v1/candidatos?pageSize=8&nome=${encodeURIComponent(personQuery)}`), enabled: personQuery.length >= 2 });
  const available = useMemo(() => (jobs.data?.data ?? []).filter((job) => job.situacao === "aberta" && (job.disponiveis ?? 0) > 0), [jobs.data]);
  const selectedJob = jobs.data?.data.find((job) => job.id_vaga === jobId);

  const createPerson = useMutation({
    mutationFn: () => api<Person>("/api/v1/candidatos", { method: "POST", body: JSON.stringify(draft) }),
    onSuccess: async (response) => {
      setPersonId(response.data.id_candidato);
      setPersonName(response.data.nome || draft.nome);
      setShowCreate(false);
      await client.invalidateQueries({ queryKey: ["busca-candidatos"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Não foi possível cadastrar o candidato."),
  });
  const hire = useMutation({
    mutationFn: () => api<{ id_contratacao: number; id_colaborador: string; id_candidato: string; id_vaga: string; id_empresa: string }>("/api/v1/contratacoes", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: JSON.stringify({ id_candidato: personId, id_vaga: jobId, data_inicio: start, id_processo: params.get("processo") || undefined }),
    }),
    onSuccess: (response) => setResult(response.data),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Não foi possível contratar."),
  });

  if (result) {
    return (
      <Card className="grid max-w-xl gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-800"><Check size={18} /></span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">Contratação registrada</h1>
            <p className="text-sm text-slate-500">O vínculo nº {result.id_contratacao} foi criado. Abra a contratação para conferir os dados e os documentos.</p>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <Par rotulo="Contratação"><span className="tabular-nums">{result.id_contratacao}</span></Par>
          <Par rotulo="Colaborador"><span className="break-all">{result.id_colaborador}</span></Par>
          <Par rotulo="Candidato"><Link className="font-semibold text-cyan-700 hover:underline" to={`/candidatos/${result.id_candidato}`}>{personName || result.id_candidato}</Link></Par>
          <Par rotulo="Vaga"><Link className="font-semibold text-cyan-700 hover:underline" to={`/vagas/${result.id_vaga}`}>{selectedJob?.cargo ? textoPlano(selectedJob.cargo) : result.id_vaga}</Link></Par>
          <Par rotulo="Empresa"><Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${result.id_empresa}`}>{companyName || result.id_empresa}</Link></Par>
        </dl>
        <Button className="justify-self-start" onClick={() => navigate(`/contratacoes/${result.id_contratacao}`)}>Abrir contratação <ChevronRight size={16} /></Button>
      </Card>
    );
  }

  const podeRegistrar = Boolean(jobId && personId && selectedJob);
  const empresaResumo = companyName || (companyId ? "Escolhida pelo link de origem" : "");
  const candidatoResumo = personName || (personId ? "Escolhido pelo link de origem" : "");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link to="/contratacoes" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900">
        <ArrowLeft size={16} /> Contratações
      </Link>
      <CabecalhoPagina
        titulo="Nova contratação"
        descricao="Escolha a empresa, uma vaga aberta com posição livre e o candidato. A contratação ocupa uma posição da vaga."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Bloco numero={1} titulo="Empresa" texto="Digite pelo menos 2 letras do nome, da razão social ou do CNPJ." feito={Boolean(companyId)}>
            <BuscaCampo aria-label="Buscar empresa" placeholder="CNPJ, razão social ou nome fantasia" value={companyQuery} onChange={setCompanyQuery} />
            {companies.isFetching && !companies.data ? <p className="text-sm text-slate-500">Buscando…</p> : null}
            {companyQuery.length >= 2 && companies.data && companies.data.data.length === 0 ? <p className="text-sm text-slate-500">Nenhuma empresa encontrada com esse texto.</p> : null}
            {companies.data?.data.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {companies.data.data.map((item) => {
                  const nome = textoPlano(item.nome_fantasia) || textoPlano(item.razao_social);
                  return (
                    <Opcao key={item.id_empresa} ativo={companyId === item.id_empresa} onClick={() => { setCompanyId(item.id_empresa); setCompanyName(nome); setJobId(""); }}>
                      <span className="block truncate font-semibold text-navy-900">{nome}</span>
                      <span className="block truncate text-xs tabular-nums text-slate-500">{formatCnpj(item.cnpj)}</span>
                    </Opcao>
                  );
                })}
              </div>
            ) : null}
          </Bloco>

          <Bloco numero={2} titulo="Vaga disponível" texto="Só aparecem vagas abertas com posição livre. Passe o mouse para ver os detalhes da vaga." feito={Boolean(jobId && selectedJob)}>
            {!companyId ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Escolha a empresa no passo 1 para ver as vagas.</p> : jobs.isLoading ? <p className="text-sm text-slate-500">Carregando vagas…</p> : available.length ? (
              <div className="grid gap-2">
                {available.map((job) => (
                  <div key={job.id_vaga} className="group relative">
                    <Opcao ativo={jobId === job.id_vaga} onClick={() => setJobId(job.id_vaga)}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-navy-900">{textoPlano(job.cargo)}</span>
                        <Badge value={job.regime}>{regimeLabel[job.regime] ?? job.regime}</Badge>
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        <span className="tabular-nums">{job.quantidade_posicoes ?? 1}</span> posições · <span className="tabular-nums">{job.ocupadas}</span> preenchidas · <span className="font-semibold tabular-nums text-emerald-800">{job.disponiveis}</span> disponíveis{job.salario != null ? ` · ${money(job.salario)}` : ""}
                      </span>
                    </Opcao>
                    <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-full max-w-lg rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg group-hover:block">
                      <p className="font-bold text-navy-900">{textoPlano(job.cargo)}{job.codigo ? ` · ${job.codigo}` : ""}</p>
                      <dl className="mt-2 grid gap-1 text-slate-600">
                        <div><dt className="inline font-semibold">Salário: </dt><dd className="inline">{money(job.salario)}</dd></div>
                        <div><dt className="inline font-semibold">Horário: </dt><dd className="inline">{job.horario || "—"}</dd></div>
                        <div><dt className="inline font-semibold">Local: </dt><dd className="inline">{job.local || "—"}</dd></div>
                        <div><dt className="inline font-semibold">Carga horária: </dt><dd className="inline">{job.carga_horaria || "—"}</dd></div>
                        <div><dt className="inline font-semibold">Modalidade: </dt><dd className="inline">{job.modalidade || regimeLabel[job.regime]}</dd></div>
                        <div><dt className="inline font-semibold">Sexo: </dt><dd className="inline">{sexoDaVaga(job.sexo)}</dd></div>
                        <div><dt className="inline font-semibold">Idade: </dt><dd className="inline">{faixaIdade(job.idade, job.idade_ate)}</dd></div>
                        <div><dt className="inline font-semibold">Benefícios: </dt><dd className="inline whitespace-pre-line">{job.beneficios || "—"}</dd></div>
                      </dl>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Não há vaga aberta com posição livre nesta empresa.</p>}
          </Bloco>

          <Bloco
            numero={3}
            titulo="Candidato"
            texto="Busque pelo nome. Se a pessoa ainda não tiver cadastro, use “Criar candidato”."
            feito={Boolean(personId)}
            acao={<Button type="button" variant="secondary" onClick={() => setShowCreate((value) => !value)}><UserPlus size={16} /> {showCreate ? "Fechar cadastro" : "Criar candidato"}</Button>}
          >
            <BuscaCampo aria-label="Buscar candidato" placeholder="Nome do candidato" value={personQuery} onChange={setPersonQuery} />
            {personQuery.length >= 2 && people.data && people.data.data.length === 0 ? <p className="text-sm text-slate-500">Nenhum candidato com esse nome. Confira a grafia ou use “Criar candidato”.</p> : null}
            {people.data?.data.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {people.data.data.map((item) => (
                  <Opcao key={item.id_candidato} ativo={personId === item.id_candidato} onClick={() => { setPersonId(item.id_candidato); setPersonName(textoPlano(item.nome)); }}>
                    <span className="block truncate font-semibold text-navy-900">{textoPlano(item.nome)}</span>
                    <span className="block text-xs tabular-nums text-slate-500">CPF {formatCpf(item.cpf)}</span>
                  </Opcao>
                ))}
              </div>
            ) : null}
            {showCreate ? (
              <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-700">Cadastro rápido</p>
                <div className="grid gap-3 sm:grid-cols-6">
                  <div className="sm:col-span-3"><Field label="Nome"><Input value={draft.nome} onChange={(event) => setDraft({ ...draft, nome: event.target.value })} /></Field></div>
                  <div className="sm:col-span-3"><Field label="CPF"><Input inputMode="numeric" value={draft.cpf} onChange={(event) => setDraft({ ...draft, cpf: event.target.value })} /></Field></div>
                  <div className="sm:col-span-6"><Field label="E-mail"><Input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field></div>
                </div>
                <Button type="button" className="justify-self-start" onClick={() => createPerson.mutate()} disabled={createPerson.isPending}>
                  <UserPlus size={16} /> {createPerson.isPending ? "Salvando…" : "Salvar candidato"}
                </Button>
              </div>
            ) : null}
          </Bloco>
        </div>

        <aside className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 xl:sticky xl:top-0">
          <div>
            <p className="text-[15px] font-bold text-navy-900">Registrar a contratação</p>
            <p className="text-sm text-slate-500">Confira o que foi escolhido e a data de início.</p>
          </div>
          <dl className="grid gap-2 text-sm">
            <Resumo rotulo="Empresa" valor={empresaResumo} />
            <Resumo rotulo="Vaga" valor={selectedJob ? textoPlano(selectedJob.cargo) : ""} />
            <Resumo rotulo="Candidato" valor={candidatoResumo} />
          </dl>
          <Field label="Data de início"><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          {!jobId ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">A contratação só é concluída com uma vaga válida.</p> : null}
          {error ? <Alerta>{error}</Alerta> : null}
          <Button className="h-11 w-full" disabled={!podeRegistrar || hire.isPending} onClick={() => { setError(""); hire.mutate(); }}>
            <UserCheck size={16} /> {hire.isPending ? "Registrando…" : "Registrar contratação"}
          </Button>
          {start ? <p className="text-xs text-slate-500">Início em {dateBr(start)}.</p> : null}
        </aside>
      </div>
    </div>
  );
}

function Bloco({ numero, titulo, texto, feito, acao, children }: { numero: number; titulo: string; texto: string; feito: boolean; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold", feito ? "bg-emerald-50 text-emerald-800" : "bg-cyan-700 text-white")}>
            {feito ? <Check size={14} /> : numero}
          </span>
          <div>
            <h2 className="text-base font-bold text-navy-900">{titulo}</h2>
            <p className="text-sm text-slate-500">{texto}</p>
          </div>
        </div>
        {acao}
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
      className={cn(
        "w-full min-w-0 rounded-lg border px-3 py-2.5 text-left text-sm transition",
        ativo ? "border-cyan-700 bg-cyan-50" : "border-slate-200 bg-white hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className={cn("min-w-0 text-right", valor ? "font-semibold text-slate-700" : "text-slate-400")}>{valor || "Não escolhido"}</dd>
    </div>
  );
}

function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}
