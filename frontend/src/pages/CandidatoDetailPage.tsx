import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";

type Experiencia = { cargo: string | null; empresa: string | null; atribuicoes: string | null };
type Curriculo = {
  objetivo: string | null; ultimo_cargo: string | null; ano_escolar: string | null; terminoestudo: string | null; origem: string | null; escolaridade: string | null;
  instituicao: { razao_social: string | null; nome_fantasia: string | null; parece: string | null; conveniada: string | null } | null;
  experiencias: Experiencia[]; conhecimentos: { descricao: string | null; nivel: string | null }[]; disc: string | null; entrevistas: number;
  vagas: { id_vaga: string; cargo: string | null; empresa: string | null }[];
};
type Candidate = {
  id_candidato: string; nome: string; cpf: string; email: string; celular: string | null; telefonefixo: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cep: string | null;
  cidade: string | null; estado: string | null; curso: string | null; nome_escola: string | null; periodo: string | null;
  ctps: string | null; datanascimento: string | null; ultimaalteracao: string | null; curriculo: Curriculo;
  vinculo?: "dna" | "empresa"; empresa_nome?: string | null;
  atendimento?: {
    captado_por?: string;
    resumo_cv?: string;
    resumo_entrevista?: string;
    teste_comportamental?: string;
    info_conducao?: string;
    descricao_vaga?: string;
    escolaridade?: string;
    idade?: string;
    tipo_de_vaga?: string;
  } | null;
};

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
  const escola = cv.instituicao?.nome_fantasia || cv.instituicao?.razao_social || data.nome_escola;
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
      {data.atendimento?.resumo_cv ? <Card><h2 className="mb-2 font-bold">Currículo do atendimento</h2><p className="whitespace-pre-wrap text-sm text-slate-600">{data.atendimento.resumo_cv}</p></Card> : null}
      {data.atendimento?.resumo_entrevista ? <Card><h2 className="mb-2 font-bold">Resumo da entrevista</h2><p className="whitespace-pre-wrap text-sm text-slate-600">{data.atendimento.resumo_entrevista}</p></Card> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Objetivo</p><p className="font-semibold">{cv.objetivo || "Não informado"}</p></Card>
        <Card><p className="text-xs text-slate-500">Último cargo</p><p className="font-semibold">{cv.ultimo_cargo || "Sem experiência"}</p></Card>
        <Card><p className="text-xs text-slate-500">Entrevistas</p><p className="font-semibold">{cv.entrevistas ? `${cv.entrevistas} encaminhamento(s)` : "Ainda não foi encaminhado para entrevista"}</p></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><h2 className="mb-2 font-bold">Perfil comportamental</h2><p className="text-sm text-slate-600">{cv.disc || "Não analisado. A avaliação DISC ainda não foi feita."}</p></Card>
        <Card><h2 className="mb-2 font-bold">Conhecimentos técnicos</h2>{cv.conhecimentos.length ? cv.conhecimentos.map((item) => <p key={`${item.descricao}-${item.nivel}`} className="text-sm">{item.descricao}{item.nivel ? ` · nível ${item.nivel}` : ""}</p>) : <p className="text-sm text-slate-500">O candidato não informou conhecimentos extracurriculares.</p>}</Card>
        <Card>
          <h2 className="mb-2 font-bold">Formação acadêmica</h2>
          <p className="text-sm">Modalidade: {cv.escolaridade || data.curso || "Não informada"}</p>
          <p className="text-sm">Escola: {escola || "Não informada"}</p>
          <p className="text-sm">Turno: {data.periodo || "Não informado"}</p>
          <p className="text-sm">Ano escolar: {cv.ano_escolar || "Não informado"}</p>
          <p className="text-sm">Término: {dateBr(cv.terminoestudo)}</p>
          <p className="text-sm">Conveniada: {cv.instituicao?.conveniada === "1" ? "Sim" : "Não"}</p>
          <p className="text-sm">Experiência da instituição: {cv.instituicao?.parece || "Não informada"}</p>
        </Card>
      </div>
      <Card>
        <h2 className="mb-3 font-bold">Experiência profissional</h2>
        {cv.experiencias.length ? cv.experiencias.map((item) => (
          <p key={`${item.cargo}-${item.empresa}`} className="text-sm"><strong>{item.cargo || "Cargo não informado"}</strong>{item.empresa ? ` na ${item.empresa}` : ""}{item.atribuicoes ? ` — ${item.atribuicoes}` : ""}</p>
        )) : <p className="text-sm text-slate-500">O candidato não informou experiência profissional.</p>}
      </Card>
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
