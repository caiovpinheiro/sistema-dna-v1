import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Button, Card, Skeleton } from "@/components/ui";
import { FichaCandidato, type FichaCandidatoDados } from "@/components/ficha-candidato";
import { ApiError, api } from "@/lib/api";
import { dateBr, etapaLabel, formatPhone, origemLabel } from "@/lib/format";

const trilha = ["recebido", "encaminhado", "entrevista_agendada", "entrevista_realizada", "contratado"] as const;
const finais = new Set(["contratado", "reprovado", "desistente"]);

type Processo = {
  id: string;
  id_candidato: string;
  candidato_nome: string | null;
  id_empresa: string;
  empresa_nome: string | null;
  id_vaga: string;
  cargo: string | null;
  origem: string;
  etapa: string;
  data_recebimento: string;
  data_encaminhamento: string | null;
  id_contratacao: number | null;
  atendimento: {
    resumo_cv?: string;
    resumo_entrevista?: string;
    descricao_vaga?: string;
    teste_comportamental?: string;
    info_conducao?: string;
    escolaridade?: string;
    idade?: string;
    tipo_de_vaga?: string;
  } | null;
  historico: Array<{ id: string; etapa: string; observacao: string | null; criado_em: string }>;
  /** A mesma ficha da página do candidato. */
  candidato: FichaCandidatoDados | null;
};

export function ProcessoDetailPage() {
  const { id } = useParams();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["processo", id], queryFn: () => api<Processo>(`/api/v1/processos/${id}`) });
  const mover = useMutation({
    mutationFn: (etapa: string) => api(`/api/v1/processos/${id}/etapa`, { method: "POST", body: JSON.stringify({ etapa }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["processo", id] }); },
  });
  if (query.isLoading) return <Skeleton className="h-64 bg-[#12141a]" />;
  if (query.isError || !query.data) return <p className="text-sm text-rose-300">Processo não encontrado.</p>;
  const data = query.data.data;
  const atual = trilha.indexOf(data.etapa as (typeof trilha)[number]);
  const aberto = !finais.has(data.etapa);
  const proximas = trilha.filter((etapa, index) => index > atual && etapa !== "contratado");
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            <Link className="hover:underline" to={`/candidatos/${data.id_candidato}`}>{data.candidato_nome}</Link>
          </h1>
          {data.candidato ? (
            <p className="text-sm text-slate-400">{[data.candidato.email, formatPhone(data.candidato.celular || data.candidato.telefonefixo)].filter((item) => item && item !== "—").join(" · ")}</p>
          ) : null}
          <p className="text-sm text-slate-400">
            <Link className="text-cyan-300" to={`/empresas/${data.id_empresa}`}>{data.empresa_nome}</Link>
            {" · "}
            <Link className="text-cyan-300" to={`/vagas/${data.id_vaga}`}>{data.cargo}</Link>
            {" · "}<span className={data.origem === "dnawork" ? "text-cyan-300" : ""}>{origemLabel[data.origem]}</span>
          </p>
        </div>
        {aberto ? <Link to={`/contratacoes/nova?empresa=${data.id_empresa}&vaga=${data.id_vaga}&candidato=${data.id_candidato}&processo=${data.id}`}><Button>Contratar</Button></Link> : null}
      </div>
      {mover.error instanceof ApiError ? <p className="text-sm text-rose-300">{mover.error.message}</p> : null}
      <ol className="grid gap-2 rounded-xl bg-[#12141a] p-4 ring-1 ring-white/10 sm:grid-cols-5">
        {trilha.map((etapa, index) => {
          const estado = data.etapa === etapa ? "atual" : atual > index ? "feita" : "futura";
          return (
            <li key={etapa} className="grid gap-2">
              <span className={`h-1 rounded-full ${estado === "futura" ? "bg-white/10" : "bg-cyan-300"}`} />
              <span className={`text-sm ${estado === "atual" ? "font-semibold text-white" : "text-slate-400"}`}>{etapaLabel[etapa]}</span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        {aberto ? proximas.map((etapa) => (
          <Button key={etapa} type="button" variant="secondary" disabled={mover.isPending} onClick={() => mover.mutate(etapa)}>{etapaLabel[etapa]}</Button>
        )) : null}
        {aberto ? <Button type="button" variant="secondary" disabled={mover.isPending} onClick={() => mover.mutate("reprovado")}>Reprovado</Button> : null}
        {aberto ? <Button type="button" variant="secondary" disabled={mover.isPending} onClick={() => mover.mutate("desistente")}>Desistente</Button> : null}
        {!aberto && data.etapa !== "contratado" ? <p className="text-sm text-slate-400">Processo encerrado como {etapaLabel[data.etapa].toLowerCase()}.</p> : null}
        {data.id_contratacao ? <Link className="text-sm font-semibold text-cyan-300" to={`/contratacoes/${data.id_contratacao}`}>Abrir contratação {data.id_contratacao}</Link> : null}
      </div>
      {data.candidato ? <FichaCandidato data={data.candidato} /> : null}
      {data.atendimento?.resumo_entrevista ? <Texto titulo="Resumo da entrevista" texto={data.atendimento.resumo_entrevista} /> : null}
      {data.atendimento?.info_conducao ? <Texto titulo="Condução" texto={data.atendimento.info_conducao} /> : null}
      {data.atendimento?.descricao_vaga ? <Texto titulo="Dados da vaga no atendimento" texto={data.atendimento.descricao_vaga} /> : null}
      <Card>
        <h2 className="mb-2 font-bold">Datas</h2>
        <p className="text-sm text-slate-600">Recebido em {dateBr(data.data_recebimento)}. Encaminhado em {dateBr(data.data_encaminhamento)}.</p>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Histórico</h2>
        <ol className="grid gap-3">
          {data.historico.map((item) => (
            <li key={item.id} className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
              <span className="tabular-nums text-slate-500">{item.criado_em.replace("T", " ")}</span>
              <span className="text-slate-200">{etapaLabel[item.etapa]}{item.observacao ? ` · ${item.observacao}` : ""}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

function Texto({ titulo, texto }: { titulo: string; texto: string }) {
  return <Card><h2 className="mb-2 font-bold">{titulo}</h2><p className="whitespace-pre-wrap text-sm text-slate-600">{texto}</p></Card>;
}
