import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentosContratacao } from "@/components/documentos-contratacao";
import { Badge, Button, Card, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, money, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";

type Detail = {
  id_contratacao: number;
  id_candidato: string;
  id_empresa: string;
  id_vaga: string;
  candidato_nome: string | null;
  candidato_cpf: string | null;
  empresa_razao: string | null;
  empresa_fantasia: string | null;
  cargo: string | null;
  modalidade: string | null;
  regime: string;
  salario: number | null;
  situacao: string;
  data_inicio: string | null;
  data_encerramento: string | null;
  data_fim_prevista: string | null;
  carga_horaria: string | null;
};

type Candidato = {
  nome: string | null;
  idade: number | null;
  cpf: string | null;
  email: string | null;
  celular: string | null;
  telefone: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  curriculo?: {
    escolaridade: string | null;
    instituicao: { nome_fantasia: string | null; razao_social: string | null } | null;
    terminoestudo: string | null;
  };
};

type Vaga = {
  atribu_contrato: string | null;
  atribuicaoes: string | null;
};

const MOTIVOS = [
  "Candidato solicitou o desligamento",
  "Empresa solicitou o desligamento",
] as const;

const AVALIACOES = ["Excelente", "Muito bom", "Bom", "Regular", "Insuficiente"] as const;

export function RescisaoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [dataDemissao, setDataDemissao] = useState("");
  const [avaliacao, setAvaliacao] = useState<(typeof AVALIACOES)[number] | "">("");
  const [resumo, setResumo] = useState("");
  const [motivoInterno, setMotivoInterno] = useState("");
  const [previa, setPrevia] = useState(false);
  const [message, setMessage] = useState("");
  const [resumoPronto, setResumoPronto] = useState(false);

  const query = useQuery({
    queryKey: ["rescisao-contratacao", id],
    queryFn: () => api<Detail>(`/api/v1/contratacoes/${id}`),
  });
  const data = query.data?.data;

  const candidato = useQuery({
    queryKey: ["rescisao-candidato", data?.id_candidato],
    queryFn: () => api<Candidato>(`/api/v1/candidatos/${data!.id_candidato}`),
    enabled: Boolean(data?.id_candidato),
  });

  const vaga = useQuery({
    queryKey: ["rescisao-vaga", data?.id_vaga],
    queryFn: () => api<Vaga>(`/api/v1/vagas/${data!.id_vaga}`),
    enabled: Boolean(data?.id_vaga),
    retry: false,
  });

  useEffect(() => {
    if (resumoPronto || !vaga.data) return;
    const texto = textoPlano(vaga.data.data.atribu_contrato || vaga.data.data.atribuicaoes);
    if (texto) setResumo(texto);
    setResumoPronto(true);
  }, [vaga.data, resumoPronto]);

  const demitir = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${id}/encerrar`, {
      method: "POST",
      body: JSON.stringify({
        data_encerramento: dataDemissao,
        motivo,
        motivo_interno: motivoInterno,
        avaliacao: avaliacao || undefined,
        resumo,
      }),
    }),
    onSuccess: async () => {
      setMessage("Rescisão gerada. O documento ficou nas informações desta contratação.");
      setPrevia(false);
      await client.invalidateQueries({ queryKey: ["rescisao-contratacao", id] });
      await client.invalidateQueries({ queryKey: ["rescisao"] });
      await client.invalidateQueries({ queryKey: ["contratacoes"] });
      await client.invalidateQueries({ queryKey: ["contratacao", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : "Não foi possível demitir."),
  });

  const cand = candidato.data?.data;
  const empresa = data?.empresa_fantasia || data?.empresa_razao || "—";
  const periodo = useMemo(() => {
    if (!data) return "—";
    return `${dateBr(data.data_inicio)} a ${dateBr(data.data_fim_prevista)}`;
  }, [data]);

  function gerarPrevia() {
    setMessage("");
    if (!motivo || !dataDemissao) {
      setMessage("Selecione o motivo e a data de demissão para gerar a prévia.");
      setPrevia(false);
      return;
    }
    setPrevia(true);
  }

  function confirmarDemissao() {
    setMessage("");
    if (!motivo || !dataDemissao) {
      setMessage("Preencha o motivo e a data de demissão.");
      return;
    }
    demitir.mutate();
  }

  if (query.isLoading) return <Skeleton className="h-80" />;
  if (!data) return <p className="text-rose-600">Contratação não encontrada.</p>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" className="mb-2 text-sm font-semibold text-orange-500 hover:text-orange-400" onClick={() => navigate("/contratacoes/rescisao")}>
            ← Voltar à lista
          </button>
          <h1 className="text-2xl font-extrabold">{data.candidato_nome}</h1>
          <p className="text-sm text-slate-500">
            Contratado em {data.cargo || "—"} · {empresa} · {periodo}
          </p>
        </div>
        <Badge value={data.situacao}>{situacaoLabel[data.situacao]}</Badge>
      </div>

      <Card className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Info label="Nome" value={cand?.nome || data.candidato_nome || "—"} />
        <Info label="Idade" value={cand?.idade != null ? String(cand.idade) : "—"} />
        <Info label="CPF" value={formatCpf(cand?.cpf || data.candidato_cpf)} />
        <Info label="E-mail" value={cand?.email || "—"} />
        <Info label="Celular" value={formatPhone(cand?.celular || cand?.telefone)} />
        <Info label="Regime" value={regimeLabel[data.regime] || "—"} />
        <Info label="Modalidade" value={data.modalidade || "—"} />
        <Info label="Salário ou bolsa" value={money(data.salario)} />
        <Info label="Carga horária" value={data.carga_horaria || "—"} />
        <Info label="Formação" value={cand?.curriculo?.escolaridade || "—"} />
        <Info label="Instituição" value={cand?.curriculo?.instituicao?.nome_fantasia || cand?.curriculo?.instituicao?.razao_social || "—"} />
        <Info label="Término de estudo" value={dateBr(cand?.curriculo?.terminoestudo)} />
        <Info label="Bairro" value={cand?.bairro || "—"} />
        <Info label="Cidade / UF" value={[cand?.cidade, cand?.uf].filter(Boolean).join(" / ") || "—"} />
        <div className="flex flex-wrap gap-4 text-sm md:col-span-2 xl:col-span-3">
          <Link className="font-semibold text-cyan-800" to={`/candidatos/${data.id_candidato}`}>Abrir candidato</Link>
          <Link className="font-semibold text-cyan-800" to={`/empresas/${data.id_empresa}`}>Abrir empresa</Link>
          <Link className="font-semibold text-cyan-800" to={`/vagas/${data.id_vaga}`}>Abrir vaga</Link>
          <Link className="font-semibold text-cyan-800" to={`/contratacoes/${data.id_contratacao}`}>Abrir contratação</Link>
        </div>
      </Card>

      {data.situacao === "ativa" ? (
        <Card className="grid max-w-3xl gap-4">
          <h2 className="text-xl font-extrabold">Demitir</h2>

          <Field label="Motivo da demissão (em contrato)">
            <Select aria-label="Motivo da demissão" value={motivo} onChange={(event) => setMotivo(event.target.value)}>
              <option value="">Selecione</option>
              {MOTIVOS.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>

          <Field label="Data de demissão">
            <Input type="date" aria-label="Data de demissão" value={dataDemissao} onChange={(event) => setDataDemissao(event.target.value)} />
          </Field>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Avaliação de desempenho</span>
            <div className="flex flex-wrap gap-2">
              {AVALIACOES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAvaliacao(item)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition",
                    avaliacao === item ? "bg-orange-500 text-navy-950 ring-orange-400" : "bg-slate-100 text-slate-600 ring-slate-200 hover:bg-slate-200",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <Field label="Resumo das atividades">
            <Textarea aria-label="Resumo das atividades" value={resumo} onChange={(event) => setResumo(event.target.value)} rows={6} />
          </Field>

          <Field label="Motivo interno">
            <Textarea aria-label="Motivo interno" value={motivoInterno} onChange={(event) => setMotivoInterno(event.target.value)} rows={4} placeholder="Anotação interna (não vai no contrato)" />
          </Field>

          <button type="button" className="justify-self-start text-sm font-semibold text-slate-600 underline-offset-2 hover:text-navy-900 hover:underline" onClick={gerarPrevia}>
            Gerar prévia
          </button>

          <Button
            className="justify-self-start bg-orange-500 text-navy-950 hover:bg-orange-400"
            disabled={demitir.isPending}
            onClick={confirmarDemissao}
          >
            {demitir.isPending ? "Gerando…" : "Gerar rescisão e demitir"}
          </Button>

          {message ? <p className="text-sm text-slate-600">{message}</p> : null}

          {previa ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <h3 className="mb-2 font-bold text-navy-900">Prévia da rescisão</h3>
              <p><span className="text-slate-500">Candidato:</span> {data.candidato_nome}</p>
              <p><span className="text-slate-500">Empresa:</span> {empresa}</p>
              <p><span className="text-slate-500">Cargo:</span> {data.cargo}</p>
              <p><span className="text-slate-500">Motivo:</span> {motivo}</p>
              <p><span className="text-slate-500">Data:</span> {dateBr(dataDemissao)}</p>
              <p><span className="text-slate-500">Avaliação:</span> {avaliacao || "—"}</p>
              <p className="mt-2 whitespace-pre-line"><span className="text-slate-500">Atividades:</span>{"\n"}{resumo || "—"}</p>
              {motivoInterno ? <p className="mt-2 whitespace-pre-line"><span className="text-slate-500">Motivo interno:</span>{"\n"}{motivoInterno}</p> : null}
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <h2 className="mb-2 font-bold">Demissão</h2>
          <p className="text-sm text-slate-500">Este vínculo já está encerrado em {dateBr(data.data_encerramento)}.</p>
        </Card>
      )}

      <DocumentosContratacao id={String(data.id_contratacao)} />
      {data.situacao === "encerrada" ? (
        <p className="text-sm">
          <Link className="font-semibold text-cyan-800" to={`/contratacoes/${data.id_contratacao}`}>Abrir nas informações da contratação</Link>
        </p>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold">{value || "—"}</p>
    </div>
  );
}
