import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, MapPin, RotateCcw, Search, Sparkles } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AnaliseDaVaga, PerfilCandidato, useStatusIa } from "@/components/triagem-inteligente";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { geocodeCep } from "@/lib/triagem-geo";
import {
  PERFIL_VAZIO,
  idsParaRepetir,
  mesclarAvaliacoes,
  ordemDeExibicao,
  organizarVagas,
  perfilPreenchido,
  proximoLote,
  selecaoValida,
  selecionadasNaOrdem,
  textoParaCandidato,
  type AvaliacaoVaga,
  type Avaliacoes,
  type PerfilProfissional,
  type Tipo,
  type Vaga,
} from "@/lib/triagem-matching";

export { textoParaCandidato };

type Compatibilidade = { avaliacoes: AvaliacaoVaga[] };
type Resultado = { originLabel: string; jobs: Vaga[] };
type EmpresaPendente = { nome: string; cnpj: string; vagas: number };
type Busca = { cep: string; raioKm: number; tipos: Tipo[]; sexo?: "M" | "F"; idade?: number; inteligente?: boolean };

const RAIOS = [5, 10, 15, 20, 30, 50];

function mascaraCep(value: string) {
  const raw = value.replace(/\D/g, "").slice(0, 8);
  return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
}

function nomeDoTipo(tipo: string) {
  return tipo.toLowerCase().startsWith("est") ? "estágio" : "CLT";
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

type Modo = "rapida" | "inteligente";

/** Cartão da vaga. Na busca rápida é idêntico ao de antes; na inteligente ganha a análise embaixo. */
function CartaoVaga({ vaga, marcada, onAlternar, turno, children }: { vaga: Vaga; marcada: boolean; onAlternar: () => void; turno?: string; children?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-xl border bg-white p-4 transition", marcada ? "border-cyan-500 ring-1 ring-cyan-500/40" : "border-slate-200 hover:border-cyan-200")}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-cyan-700" checked={marcada} onChange={onAlternar} />
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
        {vaga.schedules.map((horario) => <p key={horario} className="whitespace-pre-line text-sm text-slate-600">🕒 {horario}</p>)}
        {turno ? <p className="text-xs text-slate-500">Turno informado pela pessoa: {turno}</p> : null}
        {vaga.homeOffice ? <p className="text-sm text-slate-600">🏠 Home office</p> : null}
        <p className="text-sm text-slate-600">💰 {vaga.salaryLabel}{vaga.hasBenefits ? " + benefícios" : ""}</p>
        {children}
      </div>
    </label>
  );
}

function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-semibold text-navy-900">{titulo}</p>
        {texto ? <p className="text-xs text-slate-500">{texto}</p> : null}
      </div>
      {children}
    </div>
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
  const [modo, setModo] = useState<Modo>("rapida");
  const [perfil, setPerfil] = useState<PerfilProfissional>(PERFIL_VAZIO);
  const [turno, setTurno] = useState("");
  const [avaliacoes, setAvaliacoes] = useState<Avaliacoes>({});
  const [emAnalise, setEmAnalise] = useState<string[]>([]);
  const [erroAnalise, setErroAnalise] = useState("");

  const inteligente = modo === "inteligente";
  const status = useStatusIa(inteligente);
  const statusIa = status.data?.data;
  const lote = statusIa?.jev.lote ?? 10;

  const compatibilidade = useMutation({
    mutationFn: (vagaIds: string[]) =>
      api<Compatibilidade>("/api/v1/triagem/compatibilidade", { method: "POST", body: JSON.stringify({ perfil, vagaIds }) }),
    onMutate: (vagaIds) => {
      setErroAnalise("");
      setEmAnalise(vagaIds);
    },
    onSuccess: (resposta) => setAvaliacoes((atuais) => mesclarAvaliacoes(atuais, resposta.data.avaliacoes)),
    // Falha da chamada inteira não some com as vagas: elas continuam na lista, como "ainda não analisadas".
    onError: (error) => setErroAnalise(error.message),
    onSettled: () => setEmAnalise([]),
  });

  const busca = useMutation({
    mutationFn: async ({ inteligente: _modo, ...dados }: Busca) => {
      const geo = await geocodeCep(dados.cep);
      const body = geo.ponto ? { ...dados, lat: geo.ponto.lat, lng: geo.ponto.lng } : dados;
      return api<Resultado>("/api/v1/triagem/vagas", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: (resposta, dados) => {
      setMarcadas([]);
      setAvaliacoes({});
      setErroAnalise("");
      // Busca inteligente: avalia o primeiro lote logo depois da busca geográfica. A busca rápida nunca chama IA nem JEV.
      if (dados.inteligente && perfilPreenchido(perfil) && resposta.data.jobs.length) {
        compatibilidade.mutate(proximoLote(resposta.data.jobs, {}, lote));
      }
    },
  });

  const vagas = busca.data?.data.jobs ?? [];
  const analisouAlgo = busca.data != null && (Object.keys(avaliacoes).length > 0 || compatibilidade.isPending);
  const organizado = useMemo(() => organizarVagas(vagas, avaliacoes), [vagas, avaliacoes]);
  const ordem = useMemo(() => (analisouAlgo ? ordemDeExibicao(organizado) : vagas), [analisouAlgo, organizado, vagas]);
  const marcadasValidas = useMemo(() => selecaoValida(marcadas, vagas), [marcadas, vagas]);
  const selecionadas = useMemo(() => selecionadasNaOrdem(ordem, marcadasValidas), [ordem, marcadasValidas]);
  const texto = textoParaCandidato(selecionadas);
  const pendentes = organizado.pendentes.length;
  const paraRepetir = idsParaRepetir(avaliacoes);

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
    if (inteligente && !perfilPreenchido(perfil)) return setErro("Na busca inteligente, preencha o resumo, as experiências ou as habilidades (pelo menos 30 caracteres), ou volte para a busca rápida.");
    setErro("");
    busca.mutate({
      cep: digitos,
      raioKm,
      tipos,
      ...(sexo === "M" || sexo === "F" ? { sexo } : {}),
      ...(idadeNumero != null ? { idade: idadeNumero } : {}),
      inteligente,
    });
  }

  function analisarMais() {
    const ids = proximoLote(vagas, avaliacoes, lote);
    if (ids.length) compatibilidade.mutate(ids);
  }

  async function copiar() {
    if (!texto) return;
    await navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const cartao = (vaga: Vaga & { avaliacao?: AvaliacaoVaga | null }) => (
    <CartaoVaga key={vaga.id} vaga={vaga} marcada={marcadasValidas.includes(vaga.id)} onAlternar={() => alternarVaga(vaga.id)} turno={analisouAlgo ? turno.trim() : undefined}>
      {analisouAlgo ? <AnaliseDaVaga avaliacao={vaga.avaliacao ?? null} analisando={emAnalise.includes(vaga.id)} /> : null}
    </CartaoVaga>
  );

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
                <Search size={16} /> {busca.isPending ? "Buscando…" : inteligente ? "Buscar e analisar" : "Buscar vagas"}
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
          <div className="grid gap-4 border-t border-slate-200 pt-4">
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={inteligente} onChange={(event) => setModo(event.target.checked ? "inteligente" : "rapida")} />
              <Sparkles size={15} className="text-cyan-700" /> Busca inteligente: comparar o currículo com as vagas (Luna + JEV)
            </label>
            {inteligente ? (
              <>
                {statusIa && !statusIa.jev.pronto ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Score JEV indisponível: {statusIa.jev.motivo} As vagas aparecem sem score, com a comparação de termos do DNA Work.
                  </p>
                ) : null}
                <PerfilCandidato perfil={perfil} onPerfil={setPerfil} turno={turno} onTurno={setTurno} status={statusIa} />
              </>
            ) : null}
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
                <Button type="button" variant="ghost" onClick={() => setMarcadas(marcadasValidas.length === vagas.length ? [] : vagas.map((vaga) => vaga.id))}>
                  {marcadasValidas.length === vagas.length ? "Desmarcar todas" : "Marcar todas"}
                </Button>
              ) : null}
            </div>
            {!vagas.length ? <Empty title="Não há vagas próximas" text="Nenhuma vaga dentro do raio escolhido. Tente um raio maior ou outro tipo." /> : !analisouAlgo ? (
              <>
                {inteligente ? (
                  <Button type="button" variant="ghost" className="w-fit" disabled={!perfilPreenchido(perfil) || compatibilidade.isPending} onClick={analisarMais}>
                    <Sparkles size={15} /> Analisar compatibilidade destas vagas
                  </Button>
                ) : null}
                {vagas.map((vaga) => cartao(vaga))}
                {inteligente && erroAnalise ? <p className="text-sm text-rose-600">Análise de compatibilidade falhou: {erroAnalise}</p> : null}
              </>
            ) : (
              <>
                {erroAnalise ? <p className="text-sm text-rose-600">Análise de compatibilidade falhou: {erroAnalise} As vagas continuam na lista.</p> : null}
                {organizado.avaliadas.length ? (
                  <Secao titulo={`Avaliadas pelo JEV (${organizado.avaliadas.length})`} texto="Da maior para a menor compatibilidade profissional; empate pela distância. A decisão final é sua.">
                    {organizado.avaliadas.map(cartao)}
                  </Secao>
                ) : null}
                {organizado.semAvaliacao.length ? (
                  <Secao titulo={`Sem avaliação ou com informação insuficiente (${organizado.semAvaliacao.length})`} texto="Continuam disponíveis para seleção, na ordem de distância.">
                    {paraRepetir.length ? (
                      <Button type="button" variant="ghost" className="w-fit" disabled={compatibilidade.isPending} onClick={() => compatibilidade.mutate(paraRepetir)}>
                        <RotateCcw size={15} /> Tentar de novo as que falharam ({paraRepetir.length})
                      </Button>
                    ) : null}
                    {organizado.semAvaliacao.map(cartao)}
                  </Secao>
                ) : null}
                {pendentes ? (
                  <Secao titulo={`Ainda não analisadas (${pendentes})`} texto="Mais próximas primeiro. Analise sob demanda para controlar custo e tempo.">
                    <Button type="button" variant="ghost" className="w-fit" disabled={compatibilidade.isPending} onClick={analisarMais}>
                      <Sparkles size={15} /> {compatibilidade.isPending ? "Analisando…" : `Analisar mais ${Math.min(lote, pendentes)}`}
                    </Button>
                    {organizado.pendentes.map(cartao)}
                  </Secao>
                ) : null}
              </>
            )}
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
