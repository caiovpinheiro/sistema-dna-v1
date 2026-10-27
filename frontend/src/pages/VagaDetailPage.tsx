import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, money, regimeLabel, situacaoLabel, statusVagaLabel, textoPlano } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";

type Job = {
  id_vaga: string; cargo: string; id_empresa: string; nome_fantasia: string | null; razao_social: string | null;
  regime: string; situacao: string; modalidade: string | null; quantidade_posicoes: number | null; ocupadas: number;
  disponiveis: number | null; salario: number | null; dataabertura: string | null; carga_horaria: string | null; status: number | null;
  codigo: string | null; km: string | null; atribuicaoes: string | null; atribu_contrato: string | null;
  requisitos_desejaveis: string | null; destaque: string | null; quantidade: number; inscritos: number;
  entrevistas_agente: number; contratados: number; total: number; confirmou: number; negou: number; sem_resposta: number; recusados: number;
};
type Contract = { id_contratacao: number; candidato_nome: string | null; candidato_cpf: string | null; situacao: string; data_inicio: string | null };

export function VagaDetailPage() {
  const { id } = useParams();
  const job = useQuery({ queryKey: ["vaga", id], queryFn: () => api<Job>(`/api/v1/vagas/${id}`) });
  const contracts = useQuery({ queryKey: ["vaga-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/vagas/${id}/contratacoes`) });
  if (job.isLoading) return <Skeleton className="h-64" />;
  if (!job.data) return <p className="text-rose-600">Vaga não encontrada.</p>;
  const data = job.data.data;
  const quantidade = data.quantidade || data.quantidade_posicoes || 0;
  const status = data.status == null ? situacaoLabel[data.situacao] : (statusVagaLabel[data.status] ?? situacaoLabel[data.situacao]);
  const blocos = [
    ["Atividades da vaga", data.atribuicaoes],
    ["Atividades no contrato", data.atribu_contrato],
    ["Requisitos desejáveis", data.requisitos_desejaveis],
    ["Destaques", data.destaque],
  ].map(([titulo, texto]) => [titulo, textoPlano(texto)] as const).filter(([, texto]) => texto);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{data.cargo}</h1>
          <p className="text-sm text-slate-500"><Link className="text-cyan-800" to={`/empresas/${data.id_empresa}`}>{data.nome_fantasia || data.razao_social}</Link> · {data.modalidade || regimeLabel[data.regime]} · {money(data.salario)}</p>
        </div>
        <div className="flex gap-2"><Link to={`/processos/novo?vaga=${id}&empresa=${data.id_empresa}`}><Button variant="secondary">Novo processo</Button></Link><Link to={`/contratacoes/nova?vaga=${id}&empresa=${data.id_empresa}`}><Button>Contratar</Button></Link><Link to={`/vagas/${id}/editar`}><Button variant="secondary">Editar vaga</Button></Link></div>
      </div>
      <Card className="grid gap-3 md:grid-cols-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Abertura da vaga</p>
          <p className="mt-2 text-sm">Data: {dateBr(data.dataabertura)}</p>
          <p className="text-sm">Modalidade: {data.modalidade || regimeLabel[data.regime]}</p>
          <p className="text-sm">Quantidade: {quantidade || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Inscritos</p>
          <p className="mt-2 text-sm">Total: {data.inscritos}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Entrevista</p>
          <p className="mt-2 text-sm">Total: {data.total}</p>
          <p className="text-sm">Confirmou presença: {data.confirmou}</p>
          <p className="text-sm">Negou presença: {data.negou}</p>
          <p className="text-sm">Não respondeu: {data.sem_resposta}</p>
          <p className="text-sm">Recusados: {data.recusados}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">Contrato gerado</p>
          <p className="mt-2 text-sm">{data.regime === "clt" ? "Salário" : "Bolsa auxílio"}: {money(data.salario)}</p>
          <p className="text-sm">Vaga: {status}</p>
          <p className="text-sm">Contratados: {data.contratados}</p>
          <p className="text-sm">Código: {data.codigo || "—"}</p>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-4">
        {[["1ª etapa", "Candidatos", data.inscritos], ["2ª etapa", "Entrevistas agente", data.entrevistas_agente], ["3ª etapa", "Entrevistas empresa", data.total], ["4ª etapa", "Contratados", data.contratados]].map(([etapa, nome, valor]) => (
          <Card key={String(etapa)} className="bg-cyan-800 text-white"><p className="text-xs uppercase">{etapa}</p><p className="mt-2 font-bold">{nome} {valor}</p></Card>
        ))}
      </div>
      <Card className="grid gap-4">
        <h2 className="font-bold">Informações gerais</h2>
        <p className="text-sm text-slate-600">Distância: {data.km || "—"} km · Carga horária: {data.carga_horaria || "não informada"}</p>
        {blocos.length ? blocos.map(([titulo, texto]) => (
          <div key={titulo}><p className="text-sm font-semibold">{titulo}</p><p className="mt-1 whitespace-pre-line text-sm text-slate-600">{texto}</p></div>
        )) : <p className="text-sm text-slate-500">Esta vaga não tem atividades, requisitos ou destaques cadastrados.</p>}
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Candidatos contratados</h2>
        <div className="grid gap-2">{contracts.data?.data.length ? contracts.data.data.map((item) => (
          <Link key={item.id_contratacao} to={`/contratacoes/${item.id_contratacao}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
            <span><strong>{item.candidato_nome}</strong><span className="ml-2 text-sm text-slate-500">{formatCpf(item.candidato_cpf)} · {dateBr(item.data_inicio)}</span></span>
            <Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
          </Link>
        )) : <p className="text-sm text-slate-500">Nenhum candidato contratado nesta vaga.</p>}</div>
      </Card>
      <ProcessosRelacionados filtro={`id_vaga=${id}`} />
    </div>
  );
}
