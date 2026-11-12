import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { Button, Field, Input, Textarea, cn } from "@/components/ui";
import { api } from "@/lib/api";
import {
  ROTULO_STATUS,
  rotuloConfianca,
  rotuloScore,
  type AvaliacaoVaga,
  type PerfilProfissional,
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

/** Currículo do candidato: envio opcional para a Luna e campos sempre editáveis pelo operador. */
export function PerfilCandidato({
  perfil,
  onPerfil,
  turno,
  onTurno,
  status,
}: {
  perfil: PerfilProfissional;
  onPerfil: (perfil: PerfilProfissional) => void;
  turno: string;
  onTurno: (turno: string) => void;
  status: StatusIa | undefined;
}) {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState("");
  const [extraido, setExtraido] = useState<Extraido | null>(null);
  const lunaPronta = status?.luna.configurada ?? false;

  const analise = useMutation({
    mutationFn: (body: { arquivo?: { nome: string; base64: string }; texto?: string }) =>
      api<AnaliseCurriculo>("/api/v1/triagem/curriculo", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (resposta) => {
      setExtraido(resposta.data.extraido);
      onPerfil(resposta.data.perfil);
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

  function organizarTexto() {
    setErro("");
    const texto = perfil.resumo.trim();
    if (texto.length < 30) return setErro("Cole o texto do currículo no resumo (pelo menos 30 caracteres) para organizar com IA.");
    analise.mutate({ texto });
  }

  const campo = (chave: keyof PerfilProfissional) => ({
    value: perfil[chave],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onPerfil({ ...perfil, [chave]: event.target.value }),
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={arquivoRef} type="file" accept={ACEITOS} className="hidden" onChange={(event) => void enviarArquivo(event)} />
        <Button type="button" variant="ghost" disabled={!lunaPronta || analise.isPending} onClick={() => arquivoRef.current?.click()}>
          <Upload size={16} /> Enviar currículo
        </Button>
        <Button type="button" variant="ghost" disabled={!lunaPronta || analise.isPending} onClick={organizarTexto}>
          <Sparkles size={16} /> Organizar texto colado com IA
        </Button>
        {analise.isPending ? <span className="flex items-center gap-1.5 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" /> Analisando currículo…</span> : null}
        <span className="text-xs text-slate-500">PDF, DOCX, PNG, JPG ou WEBP até 5 MB. A IA é opcional: você pode preencher tudo à mão.</span>
      </div>
      {status && !lunaPronta ? <Aviso tom="alerta">Análise de currículo por IA indisponível (Luna não configurada). Preencha ou cole o resumo manualmente.</Aviso> : null}
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      {extraido ? (
        <Aviso tom="info">
          <FileText size={13} className="mr-1 inline" />
          Dados extraídos por {status?.luna.modelo ?? "IA"}. Revise antes de analisar as vagas.
          {extraido.nome || extraido.localizacao ? ` Identificação: ${[extraido.nome, extraido.localizacao].filter(Boolean).join(" · ")} (não vai para o JEV).` : ""}
          {` Tempo total calculado: ${extraido.tempoTotal.texto}.`}
        </Aviso>
      ) : null}
      <Field label="Resumo profissional">
        <Textarea rows={3} placeholder="Cole aqui um resumo existente ou escreva em até três frases." {...campo("resumo")} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Escolaridade / formação">
          <Textarea rows={2} placeholder="Não informado" {...campo("escolaridade")} />
        </Field>
        <Field label="Experiências (uma por linha)">
          <Textarea rows={2} placeholder="Cargo — Empresa — tempo" {...campo("experiencias")} />
        </Field>
        <Field label="Último cargo">
          <Input placeholder="Não informado" {...campo("ultimoCargo")} />
        </Field>
        <Field label="Tempo total de experiência">
          <Input placeholder="Não informado" {...campo("tempoExperiencia")} />
        </Field>
        <Field label="Habilidades e conhecimentos">
          <Input placeholder="Separe por vírgula" {...campo("habilidades")} />
        </Field>
        <Field label="Cursos e certificações">
          <Input placeholder="Não informado" {...campo("cursos")} />
        </Field>
        <Field label="Objetivo profissional">
          <Input placeholder="Não informado" {...campo("objetivo")} />
        </Field>
        <Field label="Turno disponível">
          <Input placeholder="Ex.: manhã, tarde, noite" value={turno} onChange={(event) => onTurno(event.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">Turno, sexo e idade ficam fora do score profissional. O turno aparece ao lado do horário de cada vaga, para a sua decisão.</p>
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
              <p>Nível atribuído: <strong>{jev.nivel ?? "não informado"}</strong>{jev.descricaoNivel ? ` — régua: ${jev.descricaoNivel}` : ""}</p>
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
