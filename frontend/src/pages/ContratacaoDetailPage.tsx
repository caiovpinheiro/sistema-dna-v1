import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, Field, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, efetivacaoLabel, formatCpf, money, regimeLabel, situacaoLabel } from "@/lib/format";

type Detail = {
  id_contratacao: number; id_candidato: string; id_empresa: string; id_vaga: string;
  candidato_nome: string | null; candidato_cpf: string | null; empresa_razao: string | null; empresa_fantasia: string | null;
  cargo: string | null; modalidade: string | null; regime: string; salario: number | null; situacao: string;
  data_inicio: string | null; data_encerramento: string | null; data_fim_prevista: string | null; carga_horaria: string | null;
  origem_efetivacao: string; efetivado_por: string | null;
};

export function ContratacaoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["contratacao", id], queryFn: () => api<Detail>(`/api/v1/contratacoes/${id}`) });
  const termo = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/termos", { method: "POST", body: JSON.stringify({ id_contratacao: Number(id) }) }),
    onSuccess: (result) => navigate(`/termos/${result.data.id}`),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "TERMO_JA_ENVIADO" && typeof error.details?.id === "string") {
        navigate(`/termos/${error.details.id}`);
        return;
      }
      setMessage(error instanceof ApiError ? error.message : "Não foi possível enviar o termo.");
    },
  });
  const close = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${id}/encerrar`, { method: "POST", body: JSON.stringify({ data_encerramento: date }) }),
    onSuccess: async () => {
      setMessage("Vínculo encerrado. O histórico foi mantido.");
      await client.invalidateQueries({ queryKey: ["contratacao", id] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : "Não foi possível encerrar."),
  });
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (!query.data) return <p className="text-rose-600">Contratação não encontrada.</p>;
  const data = query.data.data;
  const rows = [
    ["Candidato", data.candidato_nome],
    ["CPF", formatCpf(data.candidato_cpf)],
    ["Empresa", data.empresa_fantasia || data.empresa_razao],
    ["Vaga", data.cargo],
    ["Modalidade", data.modalidade],
    ["Regime", regimeLabel[data.regime]],
    ["Salário ou bolsa", money(data.salario)],
    ["Carga horária", data.carga_horaria || "—"],
    ["Início", dateBr(data.data_inicio)],
    ["Previsão de fim", dateBr(data.data_fim_prevista)],
    ["Encerramento", dateBr(data.data_encerramento)],
    ["Origem", efetivacaoLabel[data.origem_efetivacao] ?? data.origem_efetivacao],
    ["Efetivado por", data.efetivado_por],
  ];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contratação {data.id_contratacao}</p>
          <h1 className="text-2xl font-extrabold">{data.candidato_nome}</h1>
        </div>
        <Badge value={data.situacao}>{situacaoLabel[data.situacao]}</Badge>
      </div>
      <Card className="grid gap-4 md:grid-cols-2">
        {rows.map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="font-semibold">{value || "—"}</p></div>)}
        <div className="flex gap-4 text-sm md:col-span-2">
          <Link className="font-semibold text-cyan-800" to={`/candidatos/${data.id_candidato}`}>Abrir candidato</Link>
          <Link className="font-semibold text-cyan-800" to={`/empresas/${data.id_empresa}`}>Abrir empresa</Link>
          <Link className="font-semibold text-cyan-800" to={`/vagas/${data.id_vaga}`}>Abrir vaga</Link>
        </div>
      </Card>
      {data.regime === "estagio" ? (
        <Card className="grid gap-3 md:max-w-md">
          <h2 className="font-bold">Termo de estágio</h2>
          <p className="text-sm text-slate-500">Envia o termo para o estagiário e para a empresa assinarem na ZapSign.</p>
          <Button disabled={termo.isPending} onClick={() => termo.mutate()}>{termo.isPending ? "Enviando…" : "Gerar assinatura"}</Button>
          {message ? <p className="text-sm">{message}</p> : null}
        </Card>
      ) : null}
      {data.situacao === "ativa" ? (
        <Card className="grid gap-3 md:max-w-md">
          <h2 className="font-bold">Encerrar vínculo</h2>
          <Field label="Data de encerramento"><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Button variant="danger" disabled={close.isPending} onClick={() => close.mutate()}>Encerrar e manter histórico</Button>
          {message ? <p className="text-sm">{message}</p> : null}
        </Card>
      ) : null}
    </div>
  );
}
