import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FileText, Loader2, Upload, X } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Button, Field, Input, Select, cn } from "@/components/ui";
import { api } from "@/lib/api";
import {
  ESCOLARIDADES,
  ROTULO_STATUS,
  TURNOS,
  rotuloConfianca,
  rotuloScore,
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

type AnaliseCurriculo = { extraido: Extraido; perfil: PerfilProfissional; modelo: string };

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
  status,
}: {
  perfil: PerfilProfissional;
  onPerfil: (perfil: PerfilProfissional) => void;
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
  avaliada: "bg-emerald-50 text-emerald-800",
  indisponivel: "bg-slate-100 text-slate-600",
  dados_insuficientes: "bg-amber-50 text-amber-800",
  falhou: "bg-rose-50 text-rose-700",
  resposta_invalida: "bg-rose-50 text-rose-700",
  nao_encontrada: "bg-slate-100 text-slate-600",
};

/** Score, confiança e nível do JEV na vaga, mais o botão "Ver análise". */
export function AnaliseDaVaga({ avaliacao, analisando }: { avaliacao: AvaliacaoVaga | null; analisando: boolean }) {
  const [aberta, setAberta] = useState(false);
  if (!avaliacao) {
    return analisando
      ? <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Analisando compatibilidade…</p>
      : <p className="text-xs text-slate-400">Ainda não analisada.</p>;
  }
  const { jev, explicacao } = avaliacao;
  const temDetalhes = Boolean(jev || explicacao);
  return (
    <div className="grid gap-2 border-t border-slate-100 pt-2" onClick={(event) => event.preventDefault()}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("rounded-md px-2 py-0.5 font-semibold", tomDoStatus[avaliacao.status])}>{jev?.nivel ?? ROTULO_STATUS[avaliacao.status]}</span>
        {jev ? <span className="font-semibold text-slate-700">Score JEV {rotuloScore(jev)}</span> : null}
        {jev && rotuloConfianca(jev.confianca) ? <span className="text-slate-500">{rotuloConfianca(jev.confianca)}</span> : null}
        {!jev && avaliacao.motivo ? <span className="text-slate-500">{avaliacao.motivo}</span> : null}
        {temDetalhes ? (
          <button type="button" className="ml-auto flex items-center gap-1 font-semibold text-cyan-700 hover:underline" onClick={() => setAberta((valor) => !valor)}>
            {aberta ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {aberta ? "Ocultar análise" : "Ver análise"}
          </button>
        ) : null}
      </div>
      {aberta ? (
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          {jev ? (
            <div className="grid gap-1">
              <p className="font-semibold text-navy-900">JEV ({jev.modelo ?? "modelo não informado"})</p>
              <p>
                Nível mais provável: <strong>{jev.nivel ?? "não informado"}</strong>
                {jev.probabilidadeNivel != null ? ` (probabilidade ${jev.probabilidadeNivel.toLocaleString("pt-BR", { maximumFractionDigits: 2 })})` : ""}
                {jev.descricaoNivel ? ` — régua: ${jev.descricaoNivel}` : ""}
              </p>
              {jev.probabilidades ? (
                <p className="text-slate-500">
                  Probabilidade por nível: {Object.entries(jev.probabilidades).map(([nivel, p]) => `${nivel}: ${p.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`).join(" · ")}
                </p>
              ) : null}
              {jev.justificativa ? <p>Justificativa do JEV: {jev.justificativa}</p> : <p className="text-slate-500">O JEV não devolve justificativa em texto; abaixo, só a comparação feita pelo DNA Work.</p>}
              {jev.evidencias.length ? <ul className="list-disc pl-4">{jev.evidencias.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              {jev.lacunas.length ? <ul className="list-disc pl-4">{jev.lacunas.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            </div>
          ) : null}
          {explicacao ? (
            <div className="grid gap-1.5">
              <p className="font-semibold text-navy-900">Comparação do DNA Work</p>
              <p className="text-slate-500">{explicacao.aviso}</p>
              {explicacao.favoraveis.length ? (
                <div>
                  <p className="font-medium text-emerald-800">Trechos da vaga com termos do currículo</p>
                  <ul className="list-disc pl-4">
                    {explicacao.favoraveis.map((item) => <li key={item.trecho}>{item.trecho} <span className="text-slate-500">({item.termos.join(", ")})</span></li>)}
                  </ul>
                </div>
              ) : null}
              {explicacao.naoComprovados.length ? (
                <div>
                  <p className="font-medium text-amber-800">Não comprovados no currículo</p>
                  <ul className="list-disc pl-4">{explicacao.naoComprovados.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ) : null}
              {explicacao.notas.map((nota) => <p key={nota}>{nota}</p>)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
