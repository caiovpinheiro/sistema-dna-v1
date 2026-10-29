import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, MapPin, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { geocodeCep } from "@/lib/triagem-geo";

type Tipo = "CLT" | "Estágio";
type Vaga = {
  id: string;
  title: string;
  company: string;
  location: string;
  contractType: string;
  salaryLabel: string;
  hasBenefits: boolean;
  schedule: string | null;
  schedules: string[];
  distanceKm: number;
};
type Resultado = { originLabel: string; jobs: Vaga[] };
type EmpresaPendente = { nome: string; cnpj: string; vagas: number };
type Busca = { cep: string; raioKm: number; tipos: Tipo[]; sexo?: "M" | "F"; idade?: number };

const RAIOS = [5, 10, 15, 20, 30, 50];

function mascaraCep(value: string) {
  const raw = value.replace(/\D/g, "").slice(0, 8);
  return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
}

function nomeDoTipo(tipo: string) {
  return tipo.toLowerCase().startsWith("est") ? "estágio" : "CLT";
}

export function textoParaCandidato(vagas: Vaga[]) {
  if (!vagas.length) return "";
  const tipos = [...new Set(vagas.map((vaga) => nomeDoTipo(vaga.contractType)))];
  const deTipo = tipos.length === 1 ? ` de ${tipos[0]}` : "";
  const abertura = vagas.length === 1
    ? `✨ Encontrei esta vaga${deTipo} próxima de você:`
    : `✨ Encontrei estas vagas${deTipo} próximas de você:`;
  const linhas = vagas.map((vaga, indice) => {
    const partes = [`${indice + 1}. ${vaga.title}`];
    if (vaga.location) partes.push(`📍 ${vaga.location}`);
    for (const horario of vaga.schedules) partes.push(`🕒 ${horario}`);
    partes.push(`💰 ${vaga.salaryLabel}${vaga.hasBenefits ? " + benefícios" : ""}`);
    return partes.join("\n");
  });
  const fechamento = vagas.length === 1 ? "Possui interesse?" : "Possui interesse? Se sim, nos informe o número da vaga.";
  return [abertura, ...linhas, fechamento].join("\n\n");
}

function AvisoEmpresasPendentes() {
  const pendentes = useQuery({
    queryKey: ["triagem-empresas-pendentes"],
    queryFn: () => api<EmpresaPendente[]>("/api/v1/triagem/empresas-pendentes"),
    staleTime: 60_000,
  });
  const lista = pendentes.data?.data ?? [];
  if (!lista.length) return null;
  return (
    <Card className="border-amber-300/40 bg-amber-50">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-800" />
        <div className="grid min-w-0 flex-1 gap-2">
          <p className="text-sm font-semibold text-amber-800">
            {lista.length === 1 ? "1 empresa do agente tem vaga aberta e ainda não foi cadastrada no sistema novo." : `${lista.length} empresas do agente têm vaga aberta e ainda não foram cadastradas no sistema novo.`}
          </p>
          <ul className="grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
            {lista.map((empresa) => (
              <li key={`${empresa.cnpj}-${empresa.nome}`} className="truncate">
                <span className="font-medium">{empresa.nome || "Sem nome"}</span>
                <span className="text-slate-500"> · {empresa.cnpj || "sem CNPJ"} · {empresa.vagas} {empresa.vagas === 1 ? "vaga" : "vagas"}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export function TriagemPage() {
  const [cep, setCep] = useState("");
  const [tipos, setTipos] = useState<Tipo[]>(["CLT", "Estágio"]);
  const [raioKm, setRaioKm] = useState(10);
  const [sexo, setSexo] = useState("");
  const [idade, setIdade] = useState("");
  const [erro, setErro] = useState("");
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [copiado, setCopiado] = useState(false);

  const busca = useMutation({
    mutationFn: async (dados: Busca) => {
      const geo = await geocodeCep(dados.cep);
      const body = geo.ponto ? { ...dados, lat: geo.ponto.lat, lng: geo.ponto.lng } : dados;
      return api<Resultado>("/api/v1/triagem/vagas", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => setMarcadas([]),
  });

  const vagas = busca.data?.data.jobs ?? [];
  const selecionadas = useMemo(() => vagas.filter((vaga) => marcadas.includes(vaga.id)), [vagas, marcadas]);
  const texto = textoParaCandidato(selecionadas);

  function alternarTipo(tipo: Tipo) {
    setTipos((atual) => atual.includes(tipo) ? atual.filter((item) => item !== tipo) : [...atual, tipo]);
  }

  function alternarVaga(id: string) {
    setMarcadas((atual) => atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]);
  }

  function buscar(event: FormEvent) {
    event.preventDefault();
    const digitos = cep.replace(/\D/g, "");
    if (digitos.length !== 8) return setErro("Informe um CEP com 8 dígitos.");
    if (!tipos.length) return setErro("Escolha CLT, Estágio ou os dois.");
    const idadeNumero = idade ? Number(idade) : undefined;
    if (idadeNumero != null && (!Number.isInteger(idadeNumero) || idadeNumero < 1 || idadeNumero > 120)) return setErro("Informe uma idade entre 1 e 120.");
    setErro("");
    busca.mutate({
      cep: digitos,
      raioKm,
      tipos,
      ...(sexo === "M" || sexo === "F" ? { sexo } : {}),
      ...(idadeNumero != null ? { idade: idadeNumero } : {}),
    });
  }

  async function copiar() {
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Triagem</h1>
        <p className="text-sm text-slate-500">Informe o CEP da pessoa para ver as vagas próximas, marque as que interessam e copie o texto.</p>
      </div>

      <AvisoEmpresasPendentes />

      <Card>
        <form onSubmit={buscar} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,12rem)_auto_1fr] md:items-end">
            <Field label="CEP da pessoa">
              <Input inputMode="numeric" autoComplete="off" placeholder="00000-000" value={cep} onChange={(event) => setCep(mascaraCep(event.target.value))} />
            </Field>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Tipo</legend>
              <div className="flex h-10 items-center gap-4">
                {(["CLT", "Estágio"] as Tipo[]).map((tipo) => (
                  <label key={tipo} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={tipos.includes(tipo)} onChange={() => alternarTipo(tipo)} />
                    {tipo}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex md:justify-end">
              <Button type="submit" disabled={busca.isPending} className="h-10 w-full md:w-auto">
                <Search size={16} /> {busca.isPending ? "Buscando…" : "Buscar vagas"}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-3">
            <Field label="Raio">
              <Select value={raioKm} onChange={(event) => setRaioKm(Number(event.target.value))}>
                {RAIOS.map((raio) => <option key={raio} value={raio}>{raio} km</option>)}
              </Select>
            </Field>
            <Field label="Sexo">
              <Select value={sexo} onChange={(event) => setSexo(event.target.value)}>
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </Select>
            </Field>
            <Field label="Idade">
              <Input type="number" min={1} max={120} placeholder="Opcional" value={idade} onChange={(event) => setIdade(event.target.value)} />
            </Field>
          </div>
          {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
        </form>
      </Card>

      {busca.isPending ? <Skeleton className="h-64" /> : busca.isError ? (
        <p className="text-sm text-rose-600">{busca.error.message}</p>
      ) : busca.data ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin size={15} /> {busca.data.data.originLabel} · {vagas.length} {vagas.length === 1 ? "vaga" : "vagas"} em até {raioKm} km
              </p>
              {vagas.length ? (
                <Button type="button" variant="ghost" onClick={() => setMarcadas(marcadas.length === vagas.length ? [] : vagas.map((vaga) => vaga.id))}>
                  {marcadas.length === vagas.length ? "Desmarcar todas" : "Marcar todas"}
                </Button>
              ) : null}
            </div>
            {vagas.length ? vagas.map((vaga) => {
              const marcada = marcadas.includes(vaga.id);
              return (
                <label key={vaga.id} className={cn("flex cursor-pointer gap-3 rounded-xl border bg-white p-4 transition", marcada ? "border-cyan-500 ring-1 ring-cyan-500/40" : "border-slate-200 hover:border-cyan-200")}>
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-cyan-700" checked={marcada} onChange={() => alternarVaga(vaga.id)} />
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-navy-900">{vaga.title}</p>
                        <p className="text-sm text-slate-500">{vaga.company}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge value={nomeDoTipo(vaga.contractType) === "CLT" ? "clt" : "estagio"}>{vaga.contractType}</Badge>
                        <span className="text-sm font-semibold text-slate-700">{vaga.distanceKm.toLocaleString("pt-BR")} km</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-600">📍 {vaga.location || "Local não informado"}</p>
                    {vaga.schedules.map((horario) => <p key={horario} className="text-sm text-slate-600">🕒 {horario}</p>)}
                    <p className="text-sm text-slate-600">💰 {vaga.salaryLabel}{vaga.hasBenefits ? " + benefícios" : ""}</p>
                  </div>
                </label>
              );
            }) : <Empty title="Não há vagas próximas" text="Nenhuma vaga dentro do raio escolhido. Tente um raio maior ou outro tipo." />}
          </div>
          {vagas.length ? (
            <Card className="grid gap-3 xl:sticky xl:top-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-navy-900">Texto para o candidato</p>
                <Button type="button" onClick={() => void copiar()} disabled={!texto}>
                  {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Copiado" : "Copiar"}
                </Button>
              </div>
              {texto ? (
                <Textarea readOnly value={texto} className="min-h-80" />
              ) : (
                <p className="text-sm text-slate-500">Marque uma ou mais vagas para montar o texto.</p>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
