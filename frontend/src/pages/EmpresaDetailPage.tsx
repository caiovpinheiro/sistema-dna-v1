import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CobrancaEmpresa, type ValorEmpresa } from "@/components/cobranca-empresa";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCnpj, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";

type Company = {
  id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string; email: string | null;
  telefone: string | null; celular: string | null; cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  matriz: string | null; ie: string | null; site: string | null; obs: string | null; status: number | null;
  acesso_portal?: boolean;
  portal?: { ativo: boolean; email: string | null; senha: string | null; nome: string | null };
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
      <AcessoPortal empresaId={data.id_empresa} emailEmpresa={data.email} portal={data.portal} />
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

function AcessoPortal({ empresaId, emailEmpresa, portal }: { empresaId: string; emailEmpresa: string | null; portal?: Company["portal"] }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(emailEmpresa ?? "");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const acesso = portal ?? { ativo: false, email: null, senha: null, nome: null };
  const gerar = useMutation({
    mutationFn: (redefinir: boolean) => api<Company["portal"] & { criado: boolean }>(`/api/v1/empresas/${empresaId}/acesso-portal`, {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), redefinir }),
    }),
    onSuccess: async (resposta) => {
      setErro("");
      setAviso(resposta.data?.criado ? "Acesso criado. Envie o e-mail e a senha para a empresa." : "Nova senha gerada. A anterior deixa de funcionar.");
      await queryClient.invalidateQueries({ queryKey: ["empresa", empresaId] });
      await queryClient.invalidateQueries({ queryKey: ["empresas"] });
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível gerar o acesso."),
  });
  async function copiar(valor: string) {
    await navigator.clipboard.writeText(valor);
    setAviso("Copiado.");
  }
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Portal de empresas</h2>
        <Badge value={acesso.ativo ? "ativa" : "encerrada"}>{acesso.ativo ? "Com acesso" : "Sem acesso"}</Badge>
      </div>
      {acesso.ativo ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">E-mail de acesso</p>
            <p className="font-semibold">{acesso.email || "—"}</p>
            {acesso.email ? <button type="button" className="mt-1 text-sm font-semibold text-cyan-800" onClick={() => void copiar(acesso.email!)}>Copiar e-mail</button> : null}
          </div>
          <div>
            <p className="text-xs text-slate-500">Senha</p>
            <p className="font-semibold tracking-wide">{acesso.senha || "Não registrada"}</p>
            {acesso.senha ? <button type="button" className="mt-1 text-sm font-semibold text-cyan-800" onClick={() => void copiar(acesso.senha!)}>Copiar senha</button> : <p className="mt-1 text-sm text-slate-500">A senha antiga não ficou salva para consulta. Gere uma nova para enviar à empresa.</p>}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:max-w-md">
          <p className="text-sm text-slate-500">Esta empresa ainda não entra no portal. O e-mail abaixo vira o login.</p>
          <Input aria-label="E-mail de acesso" type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@empresa.com" />
        </div>
      )}
      {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
      {aviso ? <p className="mt-3 text-sm text-emerald-700">{aviso}</p> : null}
      <div className="mt-4">
        {acesso.ativo ? (
          <Button type="button" variant="secondary" disabled={gerar.isPending} onClick={() => {
            if (!window.confirm("A senha atual deixa de funcionar. Gerar uma nova para enviar à empresa?")) return;
            setAviso("");
            gerar.mutate(true);
          }}>{gerar.isPending ? "Gerando…" : "Gerar nova senha"}</Button>
        ) : (
          <Button type="button" disabled={gerar.isPending || !email.includes("@")} onClick={() => { setAviso(""); gerar.mutate(false); }}>{gerar.isPending ? "Gerando…" : "Gerar acesso"}</Button>
        )}
      </div>
    </Card>
  );
}
