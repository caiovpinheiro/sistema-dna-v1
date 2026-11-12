import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Check, ChevronDown, Clock, Copy, FileText, House, ListChecks, MapPin, RotateCcw, Search, Sparkles, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { CabecalhoPagina } from "@/components/pagina";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AnaliseDaVaga, PerfilCandidato, useStatusIa, type CepDoCurriculo } from "@/components/triagem-inteligente";
import { Badge, Button, Card, Empty, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { geocodeCep } from "@/lib/triagem-geo";
import {
  PERFIL_VAZIO,
  idsParaRepetir,
  mesclarAvaliacoes,
  ordemDeExibicao,
  organizarVagas,
  problemaDoPerfil,
  proximoLote,
  rotuloTurnos,
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
    <details className="group rounded-xl border border-amber-300/40 bg-amber-50 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-semibold text-amber-800 [&::-webkit-details-marker]:hidden">
        <AlertTriangle size={17} className="shrink-0" />
        <span className="min-w-0 flex-1">
          {lista.length === 1 ? "1 empresa do agente tem vaga aberta e ainda não foi cadastrada no sistema novo." : `${lista.length} empresas do agente têm vaga aberta e ainda não foram cadastradas no sistema novo.`}
          <span className="ml-1 font-normal">As vagas delas não aparecem na busca.</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
          <span className="group-open:hidden">Ver empresas</span><span className="hidden group-open:inline">Ocultar</span>
          <ChevronDown size={15} className="transition group-open:rotate-180" />
        </span>
      </summary>
      <ul className="mt-3 grid gap-1 border-t border-amber-300/40 pt-3 text-sm text-slate-700 sm:grid-cols-2">
        {lista.map((empresa) => (
          <li key={`${empresa.cnpj}-${empresa.nome}`} className="truncate">
            <span className="font-medium">{empresa.nome || "Sem nome"}</span>
            <span className="text-slate-500"> — {empresa.cnpj || "sem CNPJ"}, {empresa.vagas} {empresa.vagas === 1 ? "vaga" : "vagas"}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type Modo = "rapida" | "inteligente";

function AvisoCep({ info, cepAtual, onUsar }: { info: CepDoCurriculo; cepAtual: string; onUsar: (cep: string) => void }) {
  const digitado = cepAtual.replace(/\D/g, "");
  const origem = info.origem === "curriculo" ? "CEP escrito no currículo" : "CEP encontrado pelo endereço do currículo";
  if (!info.cep) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">CEP não preenchido pelo currículo: {info.motivo}{info.endereco ? ` (${info.endereco})` : ""}</p>;
  }
  if (digitado === info.cep) {
    return <p className="flex items-center gap-1.5 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-cyan-800"><MapPin size={13} /> {origem}{info.endereco ? `: ${info.endereco}` : ""}. Confira antes de buscar.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-cyan-800">
      <MapPin size={13} /> {origem}: {mascaraCep(info.cep)}{info.endereco ? ` (${info.endereco})` : ""}.
      <button type="button" className="font-semibold underline" onClick={() => onUsar(info.cep!)}>Usar este CEP</button>
    </p>
  );
}

/** Cartão da vaga: a distância fica em destaque à esquerda, porque proximidade é o critério da triagem. */
function CartaoVaga({ vaga, marcada, onAlternar, turno, children }: { vaga: Vaga; marcada: boolean; onAlternar: () => void; turno?: string; children?: ReactNode }) {
  const estagio = nomeDoTipo(vaga.contractType) !== "CLT";
  return (
    <label className={cn(
      "group flex cursor-pointer overflow-hidden rounded-xl border bg-white transition",
      marcada ? "border-cyan-500 ring-2 ring-cyan-500/30" : "border-slate-200 hover:border-cyan-300",
    )}>
      <div className={cn("flex w-24 shrink-0 flex-col items-center justify-between gap-3 border-r px-2 py-4 text-center", marcada ? "border-cyan-500/30 bg-cyan-50" : "border-slate-200 bg-slate-50")}>
        <span className="grid leading-none">
          <span className="text-2xl font-extrabold tabular-nums text-navy-900">{vaga.distanceKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span>
          <span className="mt-1 text-xs font-semibold text-slate-500">km</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-cyan-700" checked={marcada} onChange={onAlternar} />
          {marcada ? "Marcada" : "Marcar"}
        </span>
      </div>
      <div className="grid min-w-0 flex-1 content-start gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-snug text-navy-900">{vaga.title}</p>
            <p className="text-sm text-slate-500">{vaga.company || "Empresa não informada"}</p>
          </div>
          <Badge value={estagio ? "estagio" : "clt"}>{vaga.contractType}</Badge>
        </div>
        <ul className="grid gap-1 text-sm text-slate-600">
          <li className="flex gap-2"><MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" /><span>{vaga.location || "Local não informado"}</span></li>
          {vaga.schedules.map((horario) => (
            <li key={horario} className="flex gap-2"><Clock size={15} className="mt-0.5 shrink-0 text-slate-400" /><span className="whitespace-pre-line">{horario}</span></li>
          ))}
          {vaga.homeOffice ? <li className="flex gap-2"><House size={15} className="mt-0.5 shrink-0 text-slate-400" /><span>Home office</span></li> : null}
          <li className="flex gap-2"><Wallet size={15} className="mt-0.5 shrink-0 text-slate-400" /><span className="font-medium text-slate-700">{vaga.salaryLabel}{vaga.hasBenefits ? " + benefícios" : ""}</span></li>
        </ul>
        {turno ? <p className="text-xs text-slate-500">{turno}</p> : null}
        {children}
      </div>
    </label>
  );
}

/** Botão de alternar (tipo de vaga, raio): visual de chip, semântica de botão com estado. */
function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold ring-1 transition",
        ativo ? "bg-cyan-700 text-white ring-cyan-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {ativo ? <Check size={14} /> : null}{children}
    </button>
  );
}

/** Antes da primeira busca: o caminho da tela em três passos. */
function ComoFunciona() {
  const passos = [
    { icone: MapPin, titulo: "Informe o CEP", texto: "Do endereço da pessoa. Ajuste o raio se precisar de mais opções." },
    { icone: ListChecks, titulo: "Marque as vagas", texto: "As mais próximas aparecem primeiro. Marque as que combinam." },
    { icone: Copy, titulo: "Copie o texto", texto: "O texto com as vagas marcadas fica pronto para enviar à pessoa." },
  ];
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {passos.map((passo, indice) => (
        <li key={passo.titulo} className="flex gap-3 rounded-xl border border-dashed border-slate-300 px-4 py-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-50 text-sm font-bold text-cyan-800">{indice + 1}</span>
          <div className="grid gap-0.5">
            <p className="flex items-center gap-1.5 text-sm font-bold text-navy-900"><passo.icone size={15} className="text-cyan-700" /> {passo.titulo}</p>
            <p className="text-sm text-slate-500">{passo.texto}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Secao({ titulo, texto, children }: { titulo: string; texto?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="border-b border-slate-200 pb-2">
        <p className="text-[15px] font-bold text-navy-900">{titulo}</p>
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
  const [avaliacoes, setAvaliacoes] = useState<Avaliacoes>({});
  const [emAnalise, setEmAnalise] = useState<string[]>([]);
  const [erroAnalise, setErroAnalise] = useState("");
  const [cepDoCurriculo, setCepDoCurriculo] = useState<CepDoCurriculo | null>(null);

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
      if (dados.inteligente && !problemaDoPerfil(perfil) && resposta.data.jobs.length) {
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
    const problema = inteligente ? problemaDoPerfil(perfil) : null;
    if (problema) return setErro(problema);
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

  /** CEP do currículo: preenche o campo vazio; se já há outro CEP digitado, oferece a troca. */
  function receberCep(localizacao: CepDoCurriculo) {
    setCepDoCurriculo(localizacao);
    if (localizacao.cep && !cep.replace(/\D/g, "")) setCep(mascaraCep(localizacao.cep));
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
    <CartaoVaga key={vaga.id} vaga={vaga} marcada={marcadasValidas.includes(vaga.id)} onAlternar={() => alternarVaga(vaga.id)} turno={analisouAlgo ? rotuloTurnos(perfil) ?? undefined : undefined}>
      {analisouAlgo ? <AnaliseDaVaga avaliacao={vaga.avaliacao ?? null} analisando={emAnalise.includes(vaga.id)} /> : null}
    </CartaoVaga>
  );

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Triagem"
        descricao="Encontre as vagas abertas perto da pessoa, marque as que combinam e copie o texto pronto para enviar."
        acoes={<Link to="/triagem/dossie"><Button variant="secondary"><FileText size={16} /> Gerar dossiê</Button></Link>}
      />

      <AvisoEmpresasPendentes />

      <Card className="p-0">
        <form onSubmit={buscar} className="grid">
          <div className="grid gap-4 p-4 md:p-5 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-slate-700">CEP da pessoa</span>
              <span className="relative block">
                <MapPin size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cyan-700" />
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="00000-000"
                  value={cep}
                  onChange={(event) => setCep(mascaraCep(event.target.value))}
                  className="h-14 pl-12 tracking-wide tabular-nums"
                  // O index.css aplica "font: inherit" em inputs fora das camadas do Tailwind; o tamanho vai inline.
                  style={{ fontSize: "1.5rem", fontWeight: 700 }}
                />
              </span>
            </label>
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-semibold text-slate-700">Tipo de vaga</legend>
              <div className="flex h-14 items-center gap-2">
                {(["CLT", "Estágio"] as Tipo[]).map((tipo) => (
                  <Chip key={tipo} ativo={tipos.includes(tipo)} onClick={() => alternarTipo(tipo)}>{tipo}</Chip>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busca.isPending} className="h-14 w-full px-6 text-base lg:w-auto">
              <Search size={18} /> {busca.isPending ? "Buscando…" : inteligente ? "Buscar e analisar" : "Buscar vagas"}
            </Button>
          </div>
          {inteligente && cepDoCurriculo && (cepDoCurriculo.cep || cepDoCurriculo.motivo) ? (
            <div className="px-4 pb-4 md:px-5"><AvisoCep info={cepDoCurriculo} cepAtual={cep} onUsar={(valor) => setCep(mascaraCep(valor))} /></div>
          ) : null}
          <div className="grid gap-4 border-t border-slate-200 px-4 py-4 md:px-5 lg:grid-cols-[auto_minmax(0,12rem)_minmax(0,9rem)] lg:items-end">
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-sm font-semibold text-slate-700">Distância máxima</legend>
              <div className="flex flex-wrap gap-2">
                {RAIOS.map((raio) => <Chip key={raio} ativo={raioKm === raio} onClick={() => setRaioKm(raio)}>{raio} km</Chip>)}
              </div>
            </fieldset>
            <Field label="Sexo aceito na vaga">
              <Select value={sexo} onChange={(event) => setSexo(event.target.value)}>
                <option value="">Todos</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </Select>
            </Field>
            <Field label="Idade da pessoa">
              <Input type="number" min={1} max={120} placeholder="Opcional" value={idade} onChange={(event) => setIdade(event.target.value)} />
            </Field>
          </div>
          <div className={cn("grid gap-4 border-t border-slate-200 px-4 py-4 md:px-5", inteligente ? "bg-cyan-50" : "")}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-700" checked={inteligente} onChange={(event) => setModo(event.target.checked ? "inteligente" : "rapida")} />
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-bold text-navy-900"><Sparkles size={15} className="text-cyan-700" /> Busca inteligente</span>
                <span className="text-sm text-slate-500">Envie o currículo e o sistema compara a experiência da pessoa com cada vaga (Luna + JEV). Leva mais tempo que a busca simples.</span>
              </span>
            </label>
            {inteligente ? (
              <>
                {statusIa && !statusIa.jev.pronto ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Score JEV indisponível: {statusIa.jev.motivo} As vagas aparecem sem score, com a comparação de termos do DNA Work.
                  </p>
                ) : null}
                <PerfilCandidato perfil={perfil} onPerfil={setPerfil} onCep={receberCep} status={statusIa} />
              </>
            ) : null}
          </div>
          {erro ? <p role="alert" className="border-t border-slate-200 px-4 py-3 text-sm font-medium text-rose-600 md:px-5">{erro}</p> : null}
        </form>
      </Card>

      {busca.isPending ? <Skeleton className="h-64" /> : busca.isError ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{busca.error.message}</p>
      ) : busca.data ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="grid gap-0.5">
                <p className="text-[15px] text-navy-900">
                  <span className="font-extrabold tabular-nums">{vagas.length}</span> {vagas.length === 1 ? "vaga" : "vagas"} em até {raioKm} km
                </p>
                <p className="flex items-center gap-1.5 text-sm text-slate-500"><MapPin size={14} /> {busca.data.data.originLabel}</p>
              </div>
              {vagas.length ? (
                <Button type="button" variant="secondary" onClick={() => setMarcadas(marcadasValidas.length === vagas.length ? [] : vagas.map((vaga) => vaga.id))}>
                  <ListChecks size={16} /> {marcadasValidas.length === vagas.length ? "Desmarcar todas" : "Marcar todas"}
                </Button>
              ) : null}
            </div>
            {!vagas.length ? <Empty title="Nenhuma vaga nesse raio" text="Aumente a distância máxima ou marque CLT e Estágio para ver mais vagas." /> : !analisouAlgo ? (
              <>
                {inteligente ? (
                  <Button type="button" variant="ghost" className="w-fit" disabled={problemaDoPerfil(perfil) != null || compatibilidade.isPending} onClick={analisarMais}>
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
              <div className="grid gap-0.5">
                <p className="text-[15px] font-bold text-navy-900">Texto para a pessoa</p>
                <p className="text-sm text-slate-500">
                  {selecionadas.length ? `${selecionadas.length} ${selecionadas.length === 1 ? "vaga marcada" : "vagas marcadas"}, na ordem da lista.` : "Marque uma ou mais vagas para montar o texto."}
                </p>
              </div>
              {texto ? (
                <Textarea readOnly value={texto} className="min-h-80" />
              ) : (
                <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-slate-300 px-4 text-center text-sm text-slate-500">
                  <span className="grid justify-items-center gap-2"><Briefcase size={20} className="text-slate-400" /> O texto aparece aqui.</span>
                </div>
              )}
              <Button type="button" onClick={() => void copiar()} disabled={!texto} className="h-11 w-full">
                {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Texto copiado" : "Copiar texto"}
              </Button>
            </Card>
          ) : null}
        </div>
      ) : <ComoFunciona />}
    </div>
  );
}
