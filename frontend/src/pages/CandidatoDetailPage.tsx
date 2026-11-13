import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Copy, GraduationCap, Pencil, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Alerta, CabecalhoPagina } from "@/components/pagina";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";
import { FichaCandidato, type FichaCandidatoDados } from "@/components/ficha-candidato";
import { DocumentosCandidato } from "@/components/documentos-candidato";

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
  if (!person.data) {
    return (
      <div className="grid gap-3">
        <Alerta>Candidato não encontrado. Ele pode ter sido removido ou o endereço está errado.</Alerta>
        <Link className="text-sm font-semibold text-cyan-700" to="/candidatos">Voltar para os candidatos</Link>
      </div>
    );
  }
  const data = person.data.data;
  const cv = data.curriculo;
  const endereco = [data.logradouro, data.numero, data.bairro, data.cidade, data.estado, data.cep].filter(Boolean).join(", ");
  const telefones = [data.celular, data.telefonefixo].filter(Boolean).map((item) => formatPhone(item)).join(" · ");
  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo={data.nome}
        descricao={[idade(data.datanascimento), formatCpf(data.cpf)].filter(Boolean).join(" · ")}
        acoes={(
          <>
            <Link to={`/processos/novo?candidato=${id}`}><Button variant="secondary"><Plus size={16} /> Novo processo</Button></Link>
            <Link to={`/candidatos/${id}/editar`}><Button><Pencil size={16} /> Editar</Button></Link>
          </>
        )}
      >
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge value={data.vinculo === "empresa" ? "encerrada" : "aberta"}>{data.vinculo === "empresa" ? `Cadastrado por ${data.empresa_nome ? textoPlano(data.empresa_nome) : "outra empresa"}` : "Candidato DNA"}</Badge>
          {data.atendimento?.captado_por === "dnawork" ? <Badge value="ativa">Captado pela DNAWORK</Badge> : null}
        </div>
      </CabecalhoPagina>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        <Card className="grid gap-3">
          <h2 className="text-[15px] font-bold text-navy-900">Contato e cadastro</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Dado rotulo="E-mail">{data.email || "Não informado"}</Dado>
            <Dado rotulo="Telefone">{telefones || "Não informado"}</Dado>
            <Dado rotulo="Endereço" largo>{endereco || "Não informado"}</Dado>
            <Dado rotulo="Nascimento">{data.datanascimento ? dateBr(data.datanascimento) : "Não informado"}</Dado>
            <Dado rotulo="Origem do currículo">{cv.origem || "Não informada"}</Dado>
            <Dado rotulo="Última atualização">{dateBr(data.ultimaalteracao)}</Dado>
          </dl>
        </Card>
        <AcessoCursos id={data.id_candidato} nome={data.nome} email={data.email} />
      </div>
      <FichaCandidato data={data} />
      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card className="grid gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Vagas sugeridas</h2>
            <p className="text-sm text-slate-500">Vagas abertas na cidade do candidato.</p>
          </div>
          {cv.vagas.length ? (
            <ul className="grid">
              {cv.vagas.map((item) => (
                <li key={item.id_vaga} className="border-t border-slate-100 first:border-0">
                  <Link to={`/vagas/${item.id_vaga}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-cyan-700">{item.cargo}</span>
                      <span className="block truncate text-xs text-slate-500">{item.empresa ? textoPlano(item.empresa) : "Sem empresa"}</span>
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-slate-400" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Nenhuma vaga aberta combina com a cidade deste candidato.</p>}
        </Card>
        <Card className="grid gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Histórico de contratações</h2>
            <p className="text-sm text-slate-500">Onde o candidato foi contratado pela DNA Work.</p>
          </div>
          {history.isLoading ? <Skeleton className="h-20" /> : history.isError ? <Alerta>Não foi possível carregar as contratações.</Alerta> : history.data?.data.length ? (
            <ul className="grid">
              {history.data.data.map((item) => (
                <li key={item.id_contratacao} className="border-t border-slate-100 first:border-0">
                  <Link to={`/contratacoes/${item.id_contratacao}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-cyan-700">{item.cargo || "Cargo não informado"}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[textoPlano(item.empresa_fantasia || item.empresa_razao) || null, regimeLabel[item.regime], item.data_inicio ? `desde ${dateBr(item.data_inicio)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge value={item.situacao}>{situacaoLabel[item.situacao] ?? item.situacao}</Badge>
                      <ChevronRight size={16} className="text-slate-400" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-500">Este candidato ainda não tem contratações.</p>}
        </Card>
      </div>
      <ProcessosRelacionados filtro={`id_candidato=${id}`} />
      <DocumentosCandidato idCandidato={data.id_candidato} />
    </div>
  );
}

/** Par rótulo/valor das fichas. */
function Dado({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: ReactNode }) {
  return (
    <div className={largo ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words text-sm text-slate-700">{children}</dd>
    </div>
  );
}

type AcessoCriado = { email: string; password: string | null; contaNova: boolean | null; loginUrl: string };

function AcessoCursos({ id, nome, email }: { id: string; nome: string; email: string }) {
  const [senha, setSenha] = useState("");
  const [trocar, setTrocar] = useState(false);
  const [erro, setErro] = useState("");
  const [criado, setCriado] = useState<AcessoCriado | null>(null);
  const temEmail = email.includes("@");
  const gerar = useMutation({
    mutationFn: () => api<AcessoCriado>(`/api/v1/candidatos/${id}/acesso-lms`, {
      method: "POST",
      body: JSON.stringify({
        ...(senha.trim() ? { password: senha.trim() } : {}),
        ...(trocar ? { resetPassword: true } : {}),
      }),
    }),
    onSuccess: (resposta) => {
      setErro("");
      setSenha("");
      setCriado(resposta.data);
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível criar o acesso."),
  });
  async function copiar(valor: string) {
    await navigator.clipboard.writeText(valor);
  }
  return (
    <Card className="grid gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-navy-900">Acesso aos cursos</h2>
        <p className="text-sm text-slate-500">
          Cria o aluno de {nome || "este candidato"} no LMS, com todos os cursos publicados. O mesmo e-mail não gera outra conta. Login em{" "}
          <a className="font-semibold text-cyan-700" href="https://cursos.dnawork.ai/login" target="_blank" rel="noreferrer">cursos.dnawork.ai/login</a>.
        </p>
      </div>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-slate-700">Senha</span>
        <Input aria-label="Senha do LMS" type="text" autoComplete="off" value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Opcional, mínimo 8 caracteres" />
        <span className="text-xs text-slate-500">Vazia, o LMS gera uma. Ela só aparece uma vez, quando for definida agora.</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="size-4 accent-cyan-700" checked={trocar} onChange={(event) => setTrocar(event.target.checked)} />
        Se a conta já existir, trocar a senha
      </label>
      {temEmail ? null : <Alerta tom="aviso">Este candidato não tem e-mail. Edite a ficha antes de criar o acesso.</Alerta>}
      {erro ? <Alerta>{erro}</Alerta> : null}
      {criado ? (
        <div className="grid gap-1 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800" role="status">
          <p>{criado.contaNova === false ? "A conta já existia e foi reaproveitada." : "Acesso registrado."} Todos os cursos publicados ficam liberados.</p>
          <p>E-mail: <strong>{criado.email}</strong></p>
          {criado.password ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                Senha: <strong className="tracking-wide">{criado.password}</strong>
                <button type="button" className="acao acao-cyan inline-flex items-center gap-1" onClick={() => void copiar(criado.password!)}><Copy size={12} /> Copiar</button>
              </p>
              <p>Copie agora. Esta senha não fica salva no sistema e não volta em outra consulta.</p>
            </>
          ) : <p>Nenhuma senha nova veio nesta resposta. Quem já tinha acesso continua com a senha anterior.</p>}
        </div>
      ) : null}
      <div>
        <Button type="button" disabled={!temEmail || gerar.isPending || (senha.trim().length > 0 && senha.trim().length < 8)} onClick={() => gerar.mutate()}>
          <GraduationCap size={16} /> {gerar.isPending ? "Criando…" : "Criar acesso no LMS"}
        </Button>
      </div>
    </Card>
  );
}
