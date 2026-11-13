import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ArrowLeft, FileText, UserMinus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentosContratacao } from "@/components/documentos-contratacao";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Field, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCpf, money, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";

type Detail = {
  id_contratacao: number; id_candidato: string; id_empresa: string; id_vaga: string;
  candidato_nome: string | null; candidato_cpf: string | null; empresa_razao: string | null; empresa_fantasia: string | null;
  cargo: string | null; modalidade: string | null; regime: string; salario: number | null; situacao: string;
  data_inicio: string | null; data_encerramento: string | null; data_fim_prevista: string | null; carga_horaria: string | null;
};

export function ContratacaoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [falhou, setFalhou] = useState(false);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contratacao", id], queryFn: () => api<Detail>(`/api/v1/contratacoes/${id}`) });
  const close = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${id}/encerrar`, { method: "POST", body: JSON.stringify({ data_encerramento: date }) }),
    onSuccess: async () => {
      setFalhou(false);
      setMessage("Vínculo encerrado. O histórico foi mantido.");
      await client.invalidateQueries({ queryKey: ["contratacao", id] });
    },
    onError: (error) => { setFalhou(true); setMessage(error instanceof ApiError ? error.message : "Não foi possível encerrar."); },
  });
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (!query.data) {
    return (
      <div className="grid gap-3">
        <Voltar />
        <Alerta>Contratação não encontrada. Ela pode ter sido removida ou o endereço está incompleto.</Alerta>
      </div>
    );
  }
  const data = query.data.data;
  const candidato = textoPlano(data.candidato_nome) || "Sem nome";
  const empresa = textoPlano(data.empresa_fantasia) || textoPlano(data.empresa_razao);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Voltar />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-semibold text-slate-500">Contratação nº {data.id_contratacao}</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">{candidato}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge value={data.situacao}>{situacaoLabel[data.situacao] ?? data.situacao}</Badge>
            <Badge value={data.regime}>{regimeLabel[data.regime] ?? data.regime}</Badge>
            <span>{[textoPlano(data.cargo), empresa].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        {data.regime === "estagio" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button title="Abre o gerador de TCE já preenchido com o candidato, a escola, a empresa e a vaga desta contratação." onClick={() => navigate(`/termos/gerar?contratacao=${data.id_contratacao}`)}><FileText size={16} /> Gerar TCE</Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Vínculo</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Par rotulo="Candidato"><Link className="font-semibold text-cyan-700 hover:underline" to={`/candidatos/${data.id_candidato}`}>{candidato}</Link></Par>
            <Par rotulo="CPF"><span className="tabular-nums">{formatCpf(data.candidato_cpf)}</span></Par>
            <Par rotulo="Empresa">{empresa ? <Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${data.id_empresa}`}>{empresa}</Link> : "—"}</Par>
            <Par rotulo="Vaga"><Link className="font-semibold text-cyan-700 hover:underline" to={`/vagas/${data.id_vaga}`}>{textoPlano(data.cargo) || "Abrir vaga"}</Link></Par>
            <Par rotulo="Modalidade">{textoPlano(data.modalidade) || "—"}</Par>
            <Par rotulo="Regime">{regimeLabel[data.regime] ?? "—"}</Par>
            <Par rotulo="Salário ou bolsa"><span className="tabular-nums">{money(data.salario)}</span></Par>
            <Par rotulo="Carga horária">{data.carga_horaria || "—"}</Par>
          </dl>
        </Card>
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Datas</h2>
          <dl className="grid gap-y-3">
            <Par rotulo="Início"><span className="tabular-nums">{dateBr(data.data_inicio)}</span></Par>
            <Par rotulo="Previsão de fim"><span className="tabular-nums">{dateBr(data.data_fim_prevista)}</span></Par>
            <Par rotulo="Encerramento"><span className="tabular-nums">{dateBr(data.data_encerramento)}</span></Par>
          </dl>
        </Card>
      </div>

      <DocumentosContratacao id={String(data.id_contratacao)} />

      {data.situacao === "ativa" ? (
        <Card className="grid gap-4 md:max-w-2xl">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Encerrar vínculo</h2>
            <p className="text-sm text-slate-500">Encerra sem gerar documento de rescisão. O histórico da contratação é mantido.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
            <Field label="Data de encerramento"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
            <Button variant="danger" className="h-10 justify-self-start" disabled={close.isPending} onClick={() => close.mutate()}>
              <UserMinus size={16} /> {close.isPending ? "Encerrando…" : "Encerrar e manter histórico"}
            </Button>
          </div>
          {message ? <Alerta tom={falhou ? "erro" : "info"}>{message}</Alerta> : null}
        </Card>
      ) : message ? <Alerta tom={falhou ? "erro" : "info"}>{message}</Alerta> : null}
    </div>
  );
}

function Voltar() {
  return (
    <Link to="/contratacoes" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-slate-500 hover:text-navy-900">
      <ArrowLeft size={16} /> Contratações
    </Link>
  );
}

function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words text-slate-700">{children}</dd>
    </div>
  );
}
