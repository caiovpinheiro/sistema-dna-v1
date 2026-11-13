import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, UserCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Skeleton, cn } from "@/components/ui";
import { FichaCandidato, type FichaCandidatoDados } from "@/components/ficha-candidato";
import { ApiError, api } from "@/lib/api";
import { dateBr, etapaLabel, formatPhone, origemLabel, textoPlano } from "@/lib/format";
import { EtapaBadge } from "./ProcessosPage";

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
  if (query.isLoading) return <Skeleton className="h-64" />;
  if (query.isError || !query.data) {
    return (
      <div className="grid gap-3">
        <Voltar />
        <Alerta>Processo não encontrado. Ele pode ter sido removido ou o endereço está incompleto.</Alerta>
      </div>
    );
  }
  const data = query.data.data;
  const atual = trilha.indexOf(data.etapa as (typeof trilha)[number]);
  const aberto = !finais.has(data.etapa);
  const proximas = trilha.filter((etapa, index) => index > atual && etapa !== "contratado");
  const contato = data.candidato ? [data.candidato.email, formatPhone(data.candidato.celular || data.candidato.telefonefixo)].filter((item) => item && item !== "—").join(" · ") : "";
  const nome = textoPlano(data.candidato_nome) || "Sem nome";
  return (
    <div className="grid gap-5">
      <Voltar />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-semibold text-slate-500">Processo seletivo</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">
            <Link className="hover:underline" to={`/candidatos/${data.id_candidato}`}>{nome}</Link>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <EtapaBadge etapa={data.etapa} />
            <Badge value={data.origem === "dnawork" ? "aberta" : ""}>{origemLabel[data.origem] ?? data.origem}</Badge>
            {contato ? <span>{contato}</span> : null}
          </div>
          <p className="text-sm text-slate-500">
            <Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${data.id_empresa}`}>{textoPlano(data.empresa_nome) || "Empresa"}</Link>
            {" · "}
            <Link className="font-semibold text-cyan-700 hover:underline" to={`/vagas/${data.id_vaga}`}>{textoPlano(data.cargo) || "Vaga"}</Link>
          </p>
        </div>
        {aberto ? (
          <Link to={`/contratacoes/nova?empresa=${data.id_empresa}&vaga=${data.id_vaga}&candidato=${data.id_candidato}&processo=${data.id}`}>
            <Button><UserCheck size={16} /> Contratar</Button>
          </Link>
        ) : null}
      </header>

      <Card className="grid gap-4">
        <div>
          <h2 className="text-[15px] font-bold text-navy-900">Andamento</h2>
          <p className="text-sm text-slate-500">
            {aberto ? "Avance o processo pela próxima etapa ou encerre como reprovado ou desistente. “Contratado” é marcado pela contratação." : data.etapa === "contratado" ? "Processo concluído com a contratação." : `Processo encerrado como ${(etapaLabel[data.etapa] ?? data.etapa).toLowerCase()}.`}
          </p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-5">
          {trilha.map((etapa, index) => {
            const estado = data.etapa === etapa ? "atual" : atual > index ? "feita" : "futura";
            return (
              <li key={etapa} className="grid gap-2">
                <span className={cn("h-1.5 rounded-full", estado === "futura" ? "bg-slate-200" : "bg-cyan-700")} />
                <span className={cn("flex items-center gap-1.5 text-sm", estado === "atual" ? "font-semibold text-navy-900" : estado === "feita" ? "text-slate-600" : "text-slate-400")}>
                  {estado === "feita" ? <Check size={14} className="text-cyan-700" /> : null}
                  {etapaLabel[etapa]}
                </span>
              </li>
            );
          })}
        </ol>
        {mover.error instanceof ApiError ? <Alerta>{mover.error.message}</Alerta> : null}
        {aberto || data.id_contratacao ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {aberto ? proximas.map((etapa) => (
              <Button key={etapa} type="button" variant="secondary" disabled={mover.isPending} onClick={() => mover.mutate(etapa)}>
                <ArrowRight size={16} /> {etapaLabel[etapa]}
              </Button>
            )) : null}
            {aberto ? <button type="button" className="acao acao-rose h-9 px-3 text-sm" disabled={mover.isPending} onClick={() => mover.mutate("reprovado")}>Reprovado</button> : null}
            {aberto ? <button type="button" className="acao acao-rose h-9 px-3 text-sm" disabled={mover.isPending} onClick={() => mover.mutate("desistente")}>Desistente</button> : null}
            {data.id_contratacao ? (
              <Link className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:underline" to={`/contratacoes/${data.id_contratacao}`}>
                Abrir contratação nº {data.id_contratacao} <ChevronRight size={14} />
              </Link>
            ) : null}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Datas</h2>
          <dl className="grid gap-y-3">
            <Par rotulo="Recebido em">{dateBr(data.data_recebimento)}</Par>
            <Par rotulo="Encaminhado em">{dateBr(data.data_encaminhamento)}</Par>
          </dl>
        </Card>
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Histórico</h2>
          {data.historico.length ? (
            <ol className="grid gap-3">
              {data.historico.map((item) => (
                <li key={item.id} className="grid gap-1 border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
                  <span className="tabular-nums text-slate-500">{horaLocal(item.criado_em)}</span>
                  <span className="text-slate-700">
                    <span className="font-semibold">{etapaLabel[item.etapa] ?? item.etapa}</span>
                    {item.observacao ? <span className="text-slate-500"> · {item.observacao}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-slate-500">Nenhum movimento registrado.</p>}
        </Card>
      </div>

      {data.candidato ? <FichaCandidato data={data.candidato} /> : null}
      {data.atendimento?.resumo_entrevista ? <Texto titulo="Resumo da entrevista" texto={data.atendimento.resumo_entrevista} /> : null}
      {data.atendimento?.info_conducao ? <Texto titulo="Condução" texto={data.atendimento.info_conducao} /> : null}
      {data.atendimento?.descricao_vaga ? <Texto titulo="Dados da vaga no atendimento" texto={data.atendimento.descricao_vaga} /> : null}
    </div>
  );
}

/** O servidor já manda a hora de São Paulo sem fuso ("AAAA-MM-DDTHH:MM"); só reordena para o formato brasileiro. */
function horaLocal(valor: string) {
  const hora = valor.slice(11, 16);
  return hora ? `${dateBr(valor)} ${hora}` : dateBr(valor);
}

function Voltar() {
  return (
    <Link to="/processos" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900">
      <ArrowLeft size={16} /> Processos
    </Link>
  );
}

function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="tabular-nums text-slate-700">{children}</dd>
    </div>
  );
}

function Texto({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <Card className="grid gap-2">
      <h2 className="text-[15px] font-bold text-navy-900">{titulo}</h2>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{texto}</p>
    </Card>
  );
}
