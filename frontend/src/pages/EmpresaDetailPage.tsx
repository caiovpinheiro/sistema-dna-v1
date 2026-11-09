import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CobrancaEmpresa, type ValorEmpresa } from "@/components/cobranca-empresa";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateBr, formatCnpj, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";

type Company = {
  id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string; email: string | null;
  telefone: string | null; celular: string | null; cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  matriz: string | null; ie: string | null; site: string | null; obs: string | null; status: number | null;
};
type Job = { id_vaga: string; cargo: string; regime: string; situacao: string; quantidade_posicoes: number | null; ocupadas: number; disponiveis: number | null; codigo: string | null; dataabertura: string | null };

const ORDEM_SITUACAO = ["aberta", "pausada", "contratada", "fechada"];

/** Abertas primeiro, depois pausadas, contratadas e fechadas; dentro de cada uma, a mais recente primeiro. */
function ordenarVagas(lista: Job[]) {
  const posicao = (situacao: string) => {
    const indice = ORDEM_SITUACAO.indexOf(situacao);
    return indice < 0 ? ORDEM_SITUACAO.length : indice;
  };
  return [...lista].sort((a, b) => posicao(a.situacao) - posicao(b.situacao) || (b.dataabertura ?? "").localeCompare(a.dataabertura ?? ""));
}

type Contract = { id_contratacao: number; candidato_nome: string | null; cargo: string | null; situacao: string };

export function EmpresaDetailPage() {
  const { id } = useParams();
  const company = useQuery({ queryKey: ["empresa", id], queryFn: () => api<Company>(`/api/v1/empresas/${id}`) });
  // Todas as vagas da empresa (a API devolve 20 por página por padrão): de 100 em 100, até 1.000.
  const jobs = useQuery({
    queryKey: ["empresa-vagas", id],
    queryFn: async () => {
      const todas: Job[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const resposta = await api<Job[]>(`/api/v1/empresas/${id}/vagas?page=${page}&pageSize=100`);
        todas.push(...resposta.data);
        if (resposta.data.length < 100) break;
      }
      return { data: todas };
    },
  });
  const contracts = useQuery({ queryKey: ["empresa-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/empresas/${id}/contratacoes`) });
  const cobranca = useQuery({ queryKey: ["empresa-cobranca", id], queryFn: () => api<ValorEmpresa | null>(`/api/v1/empresas/${id}/cobranca`) });
  if (company.isLoading) return <Skeleton className="h-64" />;
  if (!company.data) return <p className="text-rose-600">Empresa não encontrada.</p>;
  const data = company.data.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-extrabold">{data.nome_fantasia || data.razao_social}</h1><p className="text-sm text-slate-500">{data.razao_social} · {formatCnpj(data.cnpj)}</p></div>
        <div className="flex gap-2"><Link to="/grupos-empresas?aba=vaga"><Button>Nova vaga</Button></Link><Link to={`/empresas/${id}/editar`}><Button variant="secondary">Editar</Button></Link></div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><p className="text-xs text-slate-500">Cidade</p><p className="font-semibold">{[data.cidade, data.uf].filter(Boolean).join(" / ") || "—"}</p><p className="text-sm text-slate-500">{[data.logradouro, data.numero, data.bairro, data.cep].filter(Boolean).join(", ") || "Endereço não informado"}</p></Card>
        <Card><p className="text-xs text-slate-500">Contato</p><p className="font-semibold">{data.responsavel || "—"}</p><p className="text-sm text-slate-500">{[formatPhone(data.telefone), formatPhone(data.celular), data.email].filter((item) => item && item !== "—").join(" · ") || "Sem telefone ou e-mail"}</p></Card>
        <Card><p className="text-xs text-slate-500">Cadastro</p><p className="font-semibold">{data.matriz || "Sem matriz"}</p><p className="text-sm text-slate-500">{[data.ie ? `IE ${data.ie}` : "", data.site || ""].filter(Boolean).join(" · ") || "IE e site não informados"}</p></Card>
      </div>
      {cobranca.data?.data ? <CobrancaEmpresa valor={cobranca.data.data} aberto titulo={false} /> : null}
      {data.obs ? <Card><h2 className="mb-2 font-bold">Observações</h2><p className="whitespace-pre-line text-sm text-slate-600">{data.obs}</p></Card> : null}
      <Card>
        <h2 className="mb-3 font-bold">Vagas</h2>
        <div className="grid gap-2">{jobs.data?.data.length ? ordenarVagas(jobs.data.data).map((job) => {
          return (
            <Link key={job.id_vaga} to={`/vagas/${job.id_vaga}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
              <span className="flex flex-wrap items-center gap-2">
                <strong>{job.cargo}</strong>
                <span className="text-sm text-slate-500">{regimeLabel[job.regime]}</span>
                <Badge value={job.situacao}>{situacaoLabel[job.situacao] ?? job.situacao}</Badge>
                <span className="text-xs text-slate-500">{[job.codigo, job.dataabertura ? `aberta em ${dateBr(job.dataabertura)}` : ""].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          );
        }) : <p className="text-sm text-slate-500">Nenhuma vaga vinculada.</p>}</div>
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Contratações</h2>
        <div className="grid gap-2">{contracts.data?.data.length ? contracts.data.data.map((item) => (
          <Link key={item.id_contratacao} to={`/contratacoes/${item.id_contratacao}`} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-3 hover:bg-slate-50">
            <span>{item.candidato_nome} · {item.cargo}</span><Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
          </Link>
        )) : <p className="text-sm text-slate-500">Nenhuma contratação vinculada.</p>}</div>
      </Card>
    </div>
  );
}
