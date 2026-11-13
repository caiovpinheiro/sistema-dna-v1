import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, KeyRound, Pencil, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CobrancaEmpresa, type ValorEmpresa } from "@/components/cobranca-empresa";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dataHoraBr, dateBr, formatCnpj, formatPhone, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";

type Company = {
  id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string; email: string | null;
  telefone: string | null; celular: string | null; cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  matriz: string | null; ie: string | null; site: string | null; obs: string | null; status: number | null;
  acesso_portal?: boolean;
  portal?: { ativo: boolean; email: string | null; senha: string | null; nome: string | null };
  uso_portal?: { ultimo_login: string | null; ultimo_uso: string | null; logins: number; email: string | null } | null;
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
  if (!company.data) {
    return (
      <div className="grid gap-3">
        <Alerta>Empresa não encontrada. Ela pode ter sido removida ou o endereço está errado.</Alerta>
        <Link className="text-sm font-semibold text-cyan-700" to="/empresas">Voltar para as empresas</Link>
      </div>
    );
  }
  const data = company.data.data;
  const nome = textoPlano(data.nome_fantasia || data.razao_social);
  const endereco = [[data.logradouro, data.numero, data.complemento].filter(Boolean).join(", "), data.bairro, data.cep].filter(Boolean).join(" · ");
  const telefones = [data.telefone, data.celular].filter(Boolean).map((item) => formatPhone(item)).join(" · ");
  const listaVagas = jobs.data ? ordenarVagas(jobs.data.data) : [];
  const listaContratos = contracts.data?.data ?? [];
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo={nome}
        descricao={[data.nome_fantasia ? textoPlano(data.razao_social) : null, formatCnpj(data.cnpj)].filter(Boolean).join(" · ")}
        acoes={(
          <>
            <Link to={`/empresas/${id}/editar`}><Button variant="secondary"><Pencil size={16} /> Editar</Button></Link>
            <Link to="/grupos-empresas?aba=vaga"><Button><Plus size={16} /> Nova vaga</Button></Link>
          </>
        )}
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {data.status === 1 || data.status === 0 ? <Badge value={data.status === 1 ? "ativa" : "encerrada"}>{data.status === 1 ? "Ativa" : "Inativa"}</Badge> : null}
        </div>
      </CabecalhoPagina>
      <Card className="grid gap-3">
        <h2 className="text-[15px] font-bold text-navy-900">Dados da empresa</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dado rotulo="Cidade">{[data.cidade, data.uf].filter(Boolean).join(" / ") || "Não informada"}</Dado>
          <Dado rotulo="Endereço" largo>{endereco || "Não informado"}</Dado>
          <Dado rotulo="Responsável">{data.responsavel || "Não informado"}</Dado>
          <Dado rotulo="E-mail">{data.email || "Não informado"}</Dado>
          <Dado rotulo="Telefone">{telefones || "Não informado"}</Dado>
          <Dado rotulo="Matriz">{data.matriz || "Sem matriz"}</Dado>
          <Dado rotulo="IE / site">{[data.ie ? `IE ${data.ie}` : "", data.site || ""].filter(Boolean).join(" · ") || "Não informados"}</Dado>
        </dl>
      </Card>
      {cobranca.data?.data ? <CobrancaEmpresa valor={cobranca.data.data} aberto titulo={false} /> : null}
      <div className={data.obs ? "grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start" : "grid gap-5"}>
        <AcessoPortal empresaId={data.id_empresa} emailEmpresa={data.email} portal={data.portal} uso={data.uso_portal} />
        {data.obs ? (
          <Card className="grid gap-2">
            <h2 className="text-[15px] font-bold text-navy-900">Observações</h2>
            <p className="whitespace-pre-line text-sm text-slate-700">{data.obs}</p>
          </Card>
        ) : null}
      </div>
      <Card className="p-0">
        <TituloLista titulo="Vagas" total={jobs.data ? listaVagas.length : null} texto="Abertas primeiro, depois pausadas, contratadas e fechadas." />
        {jobs.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : jobs.isError ? <div className="p-4"><Alerta>Não foi possível carregar as vagas.</Alerta></div> : listaVagas.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Cargo</th>
                  <th>Modalidade</th>
                  <th>Situação</th>
                  <th>Código</th>
                  <th>Aberta em</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {listaVagas.map((job) => (
                  <tr key={job.id_vaga}>
                    <td className="max-w-80"><Link className="block truncate" to={`/vagas/${job.id_vaga}`}>{job.cargo}</Link></td>
                    <td className="whitespace-nowrap"><Badge value={job.regime}>{regimeLabel[job.regime] ?? job.regime}</Badge></td>
                    <td className="whitespace-nowrap"><Badge value={job.situacao}>{situacaoLabel[job.situacao] ?? job.situacao}</Badge></td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{job.codigo || "—"}</td>
                    <td className="whitespace-nowrap tabular-nums text-slate-600">{dateBr(job.dataabertura)}</td>
                    <td className="w-px whitespace-nowrap text-right">
                      <Link to={`/vagas/${job.id_vaga}`} aria-label={`Abrir ${job.cargo}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 pb-4 text-sm text-slate-500">Nenhuma vaga ligada a esta empresa. Use “Nova vaga” para abrir a primeira.</p>}
      </Card>
      <Card className="p-0">
        <TituloLista titulo="Contratações" total={contracts.data ? listaContratos.length : null} texto="Pessoas contratadas por esta empresa pela DNA Work." />
        {contracts.isLoading ? <div className="p-4"><Skeleton className="h-24" /></div> : contracts.isError ? <div className="p-4"><Alerta>Não foi possível carregar as contratações.</Alerta></div> : listaContratos.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Candidato</th>
                  <th>Cargo</th>
                  <th>Situação</th>
                  <th><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {listaContratos.map((item) => (
                  <tr key={item.id_contratacao}>
                    <td className="max-w-80"><Link className="block truncate" to={`/contratacoes/${item.id_contratacao}`}>{item.candidato_nome || "Sem nome"}</Link></td>
                    <td className="max-w-80 truncate text-slate-600">{item.cargo || "—"}</td>
                    <td className="whitespace-nowrap"><Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge></td>
                    <td className="w-px whitespace-nowrap text-right">
                      <Link to={`/contratacoes/${item.id_contratacao}`} aria-label={`Abrir contratação de ${item.candidato_nome ?? "candidato"}`} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">Abrir <ChevronRight size={14} /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="px-4 pb-4 text-sm text-slate-500">Nenhuma contratação desta empresa ainda.</p>}
      </Card>
    </div>
  );
}

/** Título das listas em card sem padding (tabela encostada nas bordas). */
function TituloLista({ titulo, total, texto }: { titulo: string; total: number | null; texto: string }) {
  return (
    <div className="px-4 pb-3 pt-4">
      <h2 className="text-[15px] font-bold text-navy-900">
        {titulo}{total != null ? <span className="ml-2 text-sm font-semibold tabular-nums text-slate-400">{total}</span> : null}
      </h2>
      <p className="text-sm text-slate-500">{texto}</p>
    </div>
  );
}

/** Par rótulo/valor da ficha. */
function Dado({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words text-sm text-slate-700">{children}</dd>
    </div>
  );
}

function resumoUso(uso: Company["uso_portal"]) {
  if (!uso?.ultimo_login) return "Ainda não entrou no portal.";
  const maisRecente = uso.ultimo_uso && uso.ultimo_uso > uso.ultimo_login ? uso.ultimo_uso : uso.ultimo_login;
  const acao = maisRecente === uso.ultimo_login ? "Última entrada" : "Último uso";
  const entradas = uso.logins === 1 ? "1 entrada" : `${uso.logins} entradas`;
  return `${acao} em ${dataHoraBr(maisRecente)} · ${entradas}.`;
}

function AcessoPortal({ empresaId, emailEmpresa, portal, uso }: { empresaId: string; emailEmpresa: string | null; portal?: Company["portal"]; uso?: Company["uso_portal"] }) {
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
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-navy-900">Portal de empresas</h2>
          <p className="text-sm text-slate-500">{resumoUso(uso)}</p>
        </div>
        <Badge value={acesso.ativo ? "ativa" : "encerrada"}>{acesso.ativo ? "Com acesso" : "Sem acesso"}</Badge>
      </div>
      {acesso.ativo ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">E-mail de acesso</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
              <span className="break-all">{acesso.email || "—"}</span>
              {acesso.email ? <button type="button" className="acao acao-cyan inline-flex items-center gap-1" onClick={() => void copiar(acesso.email!)}><Copy size={12} /> Copiar</button> : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-slate-500">Senha</dt>
            <dd className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide text-slate-700">
              <span>{acesso.senha || "Não registrada"}</span>
              {acesso.senha ? <button type="button" className="acao acao-cyan inline-flex items-center gap-1 tracking-normal" onClick={() => void copiar(acesso.senha!)}><Copy size={12} /> Copiar</button> : null}
            </dd>
            {acesso.senha ? null : <p className="mt-1 text-xs text-slate-500">A senha antiga não ficou salva para consulta. Gere uma nova para enviar à empresa.</p>}
          </div>
        </dl>
      ) : (
        <label className="grid gap-1.5 md:max-w-md">
          <span className="text-sm font-medium text-slate-700">E-mail de acesso</span>
          <Input aria-label="E-mail de acesso" type="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@empresa.com" />
          <span className="text-xs text-slate-500">Esta empresa ainda não entra no portal. Este e-mail vira o login.</span>
        </label>
      )}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {aviso ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p> : null}
      <div>
        {acesso.ativo ? (
          <Button type="button" variant="secondary" disabled={gerar.isPending} onClick={() => {
            if (!window.confirm("A senha atual deixa de funcionar. Gerar uma nova para enviar à empresa?")) return;
            setAviso("");
            gerar.mutate(true);
          }}><KeyRound size={16} /> {gerar.isPending ? "Gerando…" : "Gerar nova senha"}</Button>
        ) : (
          <Button type="button" disabled={gerar.isPending || !email.includes("@")} onClick={() => { setAviso(""); gerar.mutate(false); }}><KeyRound size={16} /> {gerar.isPending ? "Gerando…" : "Gerar acesso"}</Button>
        )}
      </div>
    </Card>
  );
}
