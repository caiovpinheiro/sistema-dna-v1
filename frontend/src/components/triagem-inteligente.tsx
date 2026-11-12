import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, CircleHelp, FileText, Loader2, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Button, Field, Input, Select, cn } from "@/components/ui";
import { api } from "@/lib/api";
import {
  ESCOLARIDADES,
  ROTULO_STATUS,
  TURNOS,
  type AvaliacaoJev,
  type AvaliacaoVaga,
  type Escolaridade,
  type PerfilProfissional,
  type Turno,
} from "@/lib/triagem-matching";

export type StatusIa = {
  luna: { configurada: boolean; modelo: string; disponivel?: boolean | null; motivo?: string };
  jev: { pronto: boolean; motivo: string | null; modelo: string; pergunta: string; escala: { min: number; max: number }; lote: number };
};

type Extraido = {
  nome: string | null;
  localizacao: string | null;
  tempoTotal: { meses: number | null; texto: string };
};

export type CepDoCurriculo = { cep: string | null; origem: "curriculo" | "endereco" | null; endereco: string | null; motivo: string | null };

type AnaliseCurriculo = { extraido: Extraido; perfil: PerfilProfissional; localizacao: CepDoCurriculo; modelo: string };

const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const ACEITOS = ".pdf,.docx,.png,.jpg,.jpeg,.webp";

export function useStatusIa(ativo: boolean) {
  return useQuery({
    queryKey: ["triagem-ia-status"],
    queryFn: () => api<StatusIa>("/api/v1/triagem/ia/status"),
    enabled: ativo,
    staleTime: 60_000,
  });
}

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

function Aviso({ tom, children }: { tom: "info" | "alerta"; children: React.ReactNode }) {
  return (
    <p className={cn("rounded-lg px-3 py-2 text-xs", tom === "alerta" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600")}>{children}</p>
  );
}

/**
 * Dados do candidato para a busca inteligente: currículo (opcional, analisado pela Luna), escolaridade,
 * tempo total, habilidades e turnos. Tudo editável; o texto do currículo analisado só é exibido.
 */
export function PerfilCandidato({
  perfil,
  onPerfil,
  onCep,
  status,
}: {
  perfil: PerfilProfissional;
  onPerfil: (perfil: PerfilProfissional) => void;
  /** CEP achado no currículo (escrito ou pelo endereço), para a página preencher o campo de CEP. */
  onCep: (localizacao: CepDoCurriculo) => void;
  status: StatusIa | undefined;
}) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState("");
  const [extraido, setExtraido] = useState<Extraido | null>(null);
  const [verCurriculo, setVerCurriculo] = useState(false);
  const lunaPronta = status?.luna.configurada ?? false;

  const analise = useMutation({
    mutationFn: (body: { arquivo: { nome: string; base64: string } }) =>
      api<AnaliseCurriculo>("/api/v1/triagem/curriculo", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (resposta) => {
      setExtraido(resposta.data.extraido);
      onCep(resposta.data.localizacao);
      // O que o operador já escolheu à mão (turnos) continua valendo; o resto vem do currículo e pode ser corrigido.
      const novo = resposta.data.perfil;
      onPerfil({
        ...novo,
        escolaridade: novo.escolaridade || perfil.escolaridade,
        turnoEstudo: perfil.turnoEstudo,
        turno: perfil.turno,
        tempoExperiencia: novo.tempoExperiencia || perfil.tempoExperiencia,
        habilidades: novo.habilidades || perfil.habilidades,
      });
    },
    onError: (error) => setErro(error.message),
  });

  async function enviarArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;
    setErro("");
    if (arquivo.size > TAMANHO_MAXIMO) return setErro("O currículo passa de 5 MB. Envie um arquivo menor.");
    if (/\.doc$/i.test(arquivo.name)) return setErro("Arquivo .doc antigo não é suportado. Salve como PDF ou DOCX.");
    try {
      analise.mutate({ arquivo: { nome: arquivo.name, base64: await lerBase64(arquivo) } });
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível ler o arquivo.");
    }
  }

  function removerCurriculo() {
    setExtraido(null);
    setVerCurriculo(false);
    onPerfil({ ...perfil, curriculo: "" });
  }

  function escolaridade(valor: string) {
    const nova = valor as Escolaridade | "";
    onPerfil({ ...perfil, escolaridade: nova, turnoEstudo: nova === "cursando_medio" ? perfil.turnoEstudo : "" });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={arquivoRef} type="file" accept={ACEITOS} className="hidden" onChange={(event) => void enviarArquivo(event)} />
        <Button type="button" variant="ghost" disabled={!lunaPronta || analise.isPending} onClick={() => arquivoRef.current?.click()}>
          <Upload size={16} /> {perfil.curriculo ? "Trocar currículo" : "Enviar currículo"}
        </Button>
        {analise.isPending ? <span className="flex items-center gap-1.5 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Analisando currículo…</span> : null}
        <span className="text-xs text-slate-500">PDF, DOCX, PNG, JPG ou WEBP até 5 MB. Opcional: sem currículo, informe as habilidades.</span>
      </div>
      {status && !lunaPronta ? <Aviso tom="alerta">Análise de currículo por IA indisponível (Luna não configurada). Preencha os campos manualmente.</Aviso> : null}
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      {perfil.curriculo ? (
        <div className="grid gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={13} />
            <span>
              Currículo analisado por {status?.luna.modelo ?? "IA"}
              {extraido && (extraido.nome || extraido.localizacao) ? ` · ${[extraido.nome, extraido.localizacao].filter(Boolean).join(" · ")} (não vai para o JEV)` : ""}.
              {" "}Revise os campos abaixo antes de analisar as vagas.
            </span>
            <button type="button" className="ml-auto flex items-center gap-1 font-semibold text-cyan-700 hover:underline" onClick={() => setVerCurriculo((valor) => !valor)}>
              {verCurriculo ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {verCurriculo ? "Ocultar" : "Ver o que vai para o JEV"}
            </button>
            <button type="button" className="flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600" onClick={removerCurriculo}>
              <X size={14} /> Remover
            </button>
          </div>
          {verCurriculo ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-slate-700">{perfil.curriculo}</pre> : null}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Escolaridade">
          <Select value={perfil.escolaridade} onChange={(event) => escolaridade(event.target.value)}>
            <option value="">Selecione</option>
            {Object.entries(ESCOLARIDADES).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </Select>
        </Field>
        {perfil.escolaridade === "cursando_medio" ? (
          <Field label="Turno em que estuda">
            <Select value={perfil.turnoEstudo} onChange={(event) => onPerfil({ ...perfil, turnoEstudo: event.target.value as Turno | "" })}>
              <option value="">Selecione</option>
              {Object.entries(TURNOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Tempo total de experiência">
          <Input placeholder="Ex.: 2 anos e 3 meses" value={perfil.tempoExperiencia} onChange={(event) => onPerfil({ ...perfil, tempoExperiencia: event.target.value })} />
        </Field>
        <Field label="Habilidades e conhecimentos">
          <Input placeholder="Separe por vírgula" value={perfil.habilidades} onChange={(event) => onPerfil({ ...perfil, habilidades: event.target.value })} />
        </Field>
        <Field label="Turno disponível">
          <Select value={perfil.turno} onChange={(event) => onPerfil({ ...perfil, turno: event.target.value as Turno | "" })}>
            <option value="">Selecione</option>
            {Object.entries(TURNOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-slate-500">Turnos, sexo e idade ficam fora do score profissional. Os turnos aparecem ao lado do horário de cada vaga, para a sua decisão.</p>
    </div>
  );
}

const tomDoStatus: Record<string, string> = {
  avaliada: "bg-cyan-50 text-cyan-800",
  indisponivel: "bg-slate-100 text-slate-600",
  dados_insuficientes: "bg-amber-50 text-amber-800",
  falhou: "bg-rose-50 text-rose-700",
  resposta_invalida: "bg-rose-50 text-rose-700",
  nao_encontrada: "bg-slate-100 text-slate-600",
};

const numeroBr = (valor: number, casas = 2) => valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
const porcento = (valor: number) => `${Math.round(valor * 100)}%`;

/** Nível ordinal em um tom só: baixo neutro, moderado claro, alto cheio. */
function tomDoNivel(posicao: number) {
  if (posicao >= 0.625) return "bg-cyan-700 text-white";
  if (posicao >= 0.375) return "bg-cyan-50 text-cyan-800";
  return "bg-slate-100 text-slate-700";
}

/** Régua da escala do JEV (0 a N) com a posição do score. */
function ReguaScore({ jev }: { jev: AvaliacaoJev }) {
  const { min, max } = jev.escala;
  const posicao = max > min ? (jev.score - min) / (max - min) : 0;
  const marcas = Array.from({ length: max - min + 1 }, (_, indice) => min + indice);
  return (
    <div className="grid w-full max-w-64 gap-1" role="img" aria-label={`Score ${numeroBr(jev.score)} numa escala de ${min} a ${max}`}>
      <div className="jev-trilho relative h-1.5 rounded-full">
        <div className="jev-fraco absolute inset-y-0 left-0 rounded-full" style={{ width: `${posicao * 100}%` }} />
        <div className="jev-marca absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${posicao * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        {marcas.map((marca) => <span key={marca}>{marca}</span>)}
      </div>
    </div>
  );
}

/** Probabilidade de cada nível da régua, do mais alto ao mais baixo. É tudo o que o JEV devolve como "motivo". */
function DistribuicaoJev({ jev }: { jev: AvaliacaoJev }) {
  if (!jev.probabilidades) return <p className="text-slate-500">O JEV não devolveu a probabilidade por nível nesta resposta.</p>;
  const niveis = Object.entries(jev.probabilidades)
    .map(([nivel, p]) => ({ nivel: Number(nivel), p }))
    .sort((a, b) => b.nivel - a.nivel);
  const topo = Math.max(...niveis.map((item) => item.p));
  return (
    <ul className="grid gap-2.5">
      {niveis.map(({ nivel, p }) => {
        const texto = jev.legenda[String(nivel)] ?? `Nível ${nivel}`;
        const [nome, ...resto] = texto.split(":");
        const principal = p === topo;
        return (
          <li key={nivel} className="grid gap-1" title={`${nome.trim()}: ${porcento(p)} de probabilidade`}>
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_2.75rem] items-center gap-3">
              <span className={cn("text-xs", principal ? "font-bold text-navy-900" : "text-slate-600")}>{nivel} · {nome.trim()}</span>
              <div className="jev-trilho h-2 rounded-full">
                <div className={cn("h-2 rounded-full", principal ? "jev-forte" : "jev-fraco")} style={{ width: `${Math.max(p * 100, p > 0 ? 2 : 0)}%` }} />
              </div>
              <span className={cn("text-right text-xs tabular-nums", principal ? "font-bold text-navy-900" : "text-slate-500")}>{porcento(p)}</span>
            </div>
            {principal ? <p className="pl-[8.25rem] text-xs text-slate-600">{resto.join(":").trim()}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ComparacaoDnaWork({ explicacao }: { explicacao: NonNullable<AvaliacaoVaga["explicacao"]> }) {
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-sm font-semibold text-navy-900">Comparação do DNA Work</p>
        <p className="text-xs text-slate-500">{explicacao.aviso}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid content-start gap-2 rounded-lg border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-navy-900"><Check size={14} className="text-cyan-700" /> Aparece no currículo ({explicacao.favoraveis.length})</p>
          {explicacao.favoraveis.length ? (
            <ul className="grid gap-2">
              {explicacao.favoraveis.map((item) => (
                <li key={item.trecho} className="grid gap-1 text-xs text-slate-700">
                  <span>{item.trecho}</span>
                  <span className="flex flex-wrap gap-1">
                    {item.termos.map((termo) => <span key={termo} className="rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-800">{termo}</span>)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">Nenhum trecho da vaga com termos do currículo.</p>}
        </div>
        <div className="grid content-start gap-2 rounded-lg border border-slate-200 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-navy-900"><CircleHelp size={14} className="text-slate-500" /> Não comprovado no currículo ({explicacao.naoComprovados.length})</p>
          {explicacao.naoComprovados.length ? (
            <ul className="grid list-disc gap-1 pl-4 text-xs text-slate-600">
              {explicacao.naoComprovados.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : <p className="text-xs text-slate-500">Todos os trechos da vaga têm termos no currículo.</p>}
        </div>
      </div>
      {explicacao.notas.map((nota) => <p key={nota} className="text-xs text-slate-600">{nota}</p>)}
    </div>
  );
}

/** Score do JEV em destaque na vaga, e a análise completa em "Ver análise". */
export function AnaliseDaVaga({ avaliacao, analisando }: { avaliacao: AvaliacaoVaga | null; analisando: boolean }) {
  const [aberta, setAberta] = useState(false);
  if (!avaliacao) {
    return analisando
      ? <p className="flex items-center gap-1.5 border-t border-slate-100 pt-2 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Analisando compatibilidade…</p>
      : <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">Ainda não analisada.</p>;
  }
  const { jev, explicacao } = avaliacao;
  const posicao = jev ? (jev.escala.max > jev.escala.min ? (jev.score - jev.escala.min) / (jev.escala.max - jev.escala.min) : 0) : 0;
  const botao = jev || explicacao ? (
    <button type="button" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-cyan-700 hover:underline" onClick={() => setAberta((valor) => !valor)}>
      {aberta ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {aberta ? "Ocultar análise" : "Ver análise"}
    </button>
  ) : null;
  return (
    <div className="mt-1 grid gap-3 border-t border-slate-100 pt-3" onClick={(event) => event.preventDefault()}>
      {jev ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-baseline gap-1" title="Score de compatibilidade profissional do JEV">
            <span className="text-3xl font-extrabold tabular-nums text-navy-900">{numeroBr(jev.score)}</span>
            <span className="text-xs text-slate-500">de {jev.escala.max}</span>
          </div>
          <div className="grid min-w-48 flex-1 gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("rounded-md px-2 py-0.5 font-semibold", tomDoNivel(posicao))}>{jev.nivel ?? "Nível não informado"}</span>
              {jev.confianca != null ? <span className="text-slate-500">confiança {porcento(jev.confianca)}</span> : null}
              <span className="text-slate-400">Score JEV · compatibilidade profissional</span>
            </div>
            <ReguaScore jev={jev} />
          </div>
          {botao}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={cn("rounded-md px-2 py-0.5 font-semibold", tomDoStatus[avaliacao.status])}>{ROTULO_STATUS[avaliacao.status]}</span>
          {avaliacao.motivo ? <span className="text-slate-500">{avaliacao.motivo}</span> : null}
          <span className="ml-auto">{botao}</span>
        </div>
      )}
      {aberta ? (
        <div className="grid gap-5 rounded-xl bg-slate-50 p-4">
          {jev ? (
            <div className="grid gap-3">
              <div>
                <p className="text-sm font-semibold text-navy-900">Como o JEV chegou a {numeroBr(jev.score)}</p>
                <p className="text-xs text-slate-500">
                  O JEV ({jev.modelo ?? "modelo não informado"}) devolve a probabilidade de cada nível da régua; o score é a média ponderada desses níveis.
                  Ele não escreve motivo em texto: a descrição abaixo é a do nível mais provável na régua usada.
                </p>
              </div>
              <DistribuicaoJev jev={jev} />
            </div>
          ) : null}
          {explicacao ? <ComparacaoDnaWork explicacao={explicacao} /> : null}
        </div>
      ) : null}
    </div>
  );
}
