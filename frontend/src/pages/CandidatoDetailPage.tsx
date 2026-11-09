import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";
import { FichaCandidato, type FichaCandidatoDados } from "@/components/ficha-candidato";

type Candidate = FichaCandidatoDados;

function idade(data: string | null) {
  if (!data) return null;
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - ano;
  if (hoje.getMonth() + 1 < mes || (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)) anos -= 1;
  return anos > 0 && anos < 100 ? `${anos} anos` : null;
}
type Contract = { id_contratacao: number; cargo: string | null; empresa_fantasia: string | null; empresa_razao: string | null; regime: string; situacao: string; data_inicio: string | null; data_encerramento: string | null };

export function CandidatoDetailPage() {
  const { id } = useParams();
  const person = useQuery({ queryKey: ["candidato", id], queryFn: () => api<Candidate>(`/api/v1/candidatos/${id}`) });
  const history = useQuery({ queryKey: ["candidato-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/candidatos/${id}/contratacoes`) });
  if (person.isLoading) return <Skeleton className="h-64" />;
  if (!person.data) return <p className="text-rose-600">Candidato não encontrado.</p>;
  const data = person.data.data;
  const cv = data.curriculo;
  const endereco = [data.logradouro, data.numero, data.bairro, data.cidade, data.estado, data.cep].filter(Boolean).join(", ");
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{data.nome}</h1>
          <p className="text-sm text-slate-500">{[idade(data.datanascimento), formatCpf(data.cpf)].filter(Boolean).join(" · ")}</p>
          <p className="text-sm text-slate-500">{data.email} · {formatPhone(data.celular || data.telefonefixo)}</p>
          <p className="text-sm text-slate-500">{endereco || "Endereço não informado"}</p>
          <p className="text-xs text-slate-400">Atualização {dateBr(data.ultimaalteracao)}{cv.origem ? ` · Origem: ${cv.origem}` : ""} · {data.vinculo === "empresa" ? `Empresa ${data.empresa_nome || "outra"}` : "Candidato DNA"}</p>
          {data.atendimento?.captado_por === "dnawork" ? <p className="mt-1 text-sm font-semibold text-cyan-700">Captado pela DNAWORK</p> : null}
        </div>
        <div className="flex gap-2"><Link to={`/processos/novo?candidato=${id}`}><Button variant="secondary">Novo processo</Button></Link><Link to={`/candidatos/${id}/editar`}><Button variant="secondary">Editar</Button></Link></div>
      </div>
      <FichaCandidato data={data} />
      <Card>
        <h2 className="mb-3 font-bold">Vagas sugeridas</h2>
        <div className="grid gap-2">{cv.vagas.length ? cv.vagas.map((item) => (
          <Link key={item.id_vaga} to={`/vagas/${item.id_vaga}`} className="rounded-xl border border-slate-100 px-3 py-3 text-sm hover:bg-slate-50"><strong>{item.cargo}</strong><span className="ml-2 text-slate-500">{item.empresa}</span></Link>
        )) : <p className="text-sm text-slate-500">Nenhuma vaga aberta combina com a cidade deste candidato.</p>}</div>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Histórico de contratações</h2>
        {history.isLoading ? <Skeleton className="h-20" /> : history.data?.data.length ? (
          <div className="grid gap-3">
            {history.data.data.map((item) => (
              <Link key={item.id_contratacao} to={`/contratacoes/${item.id_contratacao}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
                <span><strong>{item.cargo}</strong><span className="block text-sm text-slate-500">{item.empresa_fantasia || item.empresa_razao} · {regimeLabel[item.regime]}</span></span>
                <Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge>
              </Link>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">Este candidato ainda não tem contratações.</p>}
      </Card>
      <ProcessosRelacionados filtro={`id_candidato=${id}`} />
    </div>
  );
}
