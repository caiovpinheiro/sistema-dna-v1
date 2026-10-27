import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, money, regimeLabel, situacaoLabel, statusVagaLabel, textoPlano } from "@/lib/format";
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
type Sugerido = {
  id_candidato: string; nome: string | null; datanascimento: string | null; celular: string | null; escolaridade: string | null;
  periodo: string | null; cidade: string | null; bairro: string | null; km: number | null; experiencias: string[]; ja_trabalhou: boolean;
};
type ExEmpregado = { id_candidato: string; nome: string | null; celular: string | null; cargo: string | null; inicio: string | null; saida: string | null };
type Sugestoes = { total: number; candidatos: Sugerido[]; jaTrabalhou: ExEmpregado[] };

function idade(data: string | null) {
  if (!data || data.length < 10) return null;
  const [ano, mes, dia] = data.slice(0, 10).replaceAll("-", "/").split("/").map(Number);
  if (!ano || !mes || !dia) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - ano;
  if (hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)) anos -= 1;
  return anos > 0 && anos < 100 ? anos : null;
}

export function VagaDetailPage() {
  const { id } = useParams();
  const job = useQuery({ queryKey: ["vaga", id], queryFn: () => api<Job>(`/api/v1/vagas/${id}`) });
  const contracts = useQuery({ queryKey: ["vaga-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/vagas/${id}/contratacoes`) });
  const sugestoes = useQuery({ queryKey: ["vaga-sugeridos", id], queryFn: () => api<Sugestoes>(`/api/v1/vagas/${id}/sugeridos`) });
  if (job.isLoading) return <Skeleton className="h-64" />;
  if (!job.data) return <p className="text-rose-600">Vaga não encontrada.</p>;
  const data = job.data.data;
  const lista = sugestoes.data?.data;
  const inscritos = lista?.total ?? data.inscritos;
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
          <p className="mt-2 text-sm">Total: {inscritos}</p>
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
        {[["1ª etapa", "Candidatos", inscritos], ["2ª etapa", "Entrevistas agente", data.entrevistas_agente], ["3ª etapa", "Entrevistas empresa", data.total], ["4ª etapa", "Contratados", data.contratados]].map(([etapa, nome, valor]) => (
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
      <Card className="grid gap-3">
        <div className="flex items-center justify-between"><h2 className="font-bold">Candidatos sugeridos</h2><span className="text-sm text-slate-500">{inscritos}</span></div>
        {sugestoes.isLoading ? <p className="text-sm text-slate-500">Buscando candidatos…</p> : null}
        {sugestoes.isError ? <p className="text-sm text-rose-600">Não foi possível buscar os candidatos desta vaga.</p> : null}
        <div className="grid gap-2">{lista?.candidatos.length ? lista.candidatos.map((item) => {
          const anos = idade(item.datanascimento);
          return (
            <Link key={item.id_candidato} to={`/candidatos/${item.id_candidato}`} className="rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong>{item.nome}</strong>
                  {anos ? <span className="ml-2 text-sm text-slate-500">{anos} anos</span> : null}
                  {item.ja_trabalhou ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Já trabalhou</span> : <span className="ml-2 text-xs text-slate-400">Sugerido</span>}
                  <p className="text-sm text-slate-500">{formatPhone(item.celular)} · {[item.escolaridade, item.periodo].filter(Boolean).join(" ")}</p>
                  <p className="text-sm text-slate-500">{[item.bairro, item.cidade].filter(Boolean).join(" · ")}{item.km != null ? ` · ${item.km} km` : ""}</p>
                </div>
              </div>
              {item.experiencias.length ? <p className="mt-1 text-sm text-slate-600">{item.experiencias.slice(0, 3).join(" · ")}</p> : null}
            </Link>
          );
        }) : sugestoes.isSuccess ? <p className="text-sm text-slate-500">Nenhum candidato sugerido para esta vaga.</p> : null}</div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="font-bold">Quem já trabalhou</h2>
        <div className="grid gap-2">{lista?.jaTrabalhou.length ? lista.jaTrabalhou.map((item) => (
          <Link key={item.id_candidato} to={`/candidatos/${item.id_candidato}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
            <span><strong>{item.nome}</strong><span className="ml-2 text-sm text-slate-500">{item.cargo} · {formatPhone(item.celular)}</span></span>
            <span className="text-sm text-slate-500">{dateBr(item.inicio)} até {dateBr(item.saida)}</span>
          </Link>
        )) : <p className="text-sm text-slate-500">Ninguém com passagem encerrada neste cargo na empresa.</p>}</div>
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
