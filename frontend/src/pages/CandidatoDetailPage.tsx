import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Card, Input, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, regimeLabel, situacaoLabel } from "@/lib/format";
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
      <AcessoCursos id={data.id_candidato} nome={data.nome} email={data.email} />
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
      <DocumentosCandidato idCandidato={data.id_candidato} />
    </div>
  );
}

type AcessoCriado = {
  name: string;
  email: string;
  trails: string[];
  password: string | null;
  contaNova: boolean | null;
  loginUrl: string;
};

function AcessoCursos({ id, nome, email }: { id: string; nome: string; email: string }) {
  const [trilha, setTrilha] = useState("primeiro-emprego");
  const [senha, setSenha] = useState("");
  const [trocarSenha, setTrocarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [acesso, setAcesso] = useState<AcessoCriado | null>(null);
  const temEmail = email.includes("@");
  const criar = useMutation({
    mutationFn: () => {
      const trails = trilha.split(",").map((item) => item.trim()).filter(Boolean);
      const password = senha.trim();
      return api<AcessoCriado>(`/api/v1/candidatos/${id}/acesso-lms`, {
        method: "POST",
        body: JSON.stringify({
          ...(trails.length ? { trails } : {}),
          ...(password ? { password } : {}),
          ...(trocarSenha ? { resetPassword: true } : {}),
        }),
      });
    },
    onSuccess: (resposta) => {
      setErro("");
      setSenha("");
      setAcesso(resposta.data);
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível criar o acesso."),
  });
  async function copiar(valor: string) {
    await navigator.clipboard.writeText(valor);
  }
  return (
    <Card>
      <h2 className="font-bold">Acesso aos cursos</h2>
      <p className="mt-1 text-sm text-slate-600">
        Cria o aluno de {nome || "este candidato"} no LMS. O mesmo e-mail não gera outra conta.
        O login fica em <a className="font-semibold text-cyan-800" href="https://cursos.dnawork.ai/login" target="_blank" rel="noreferrer">cursos.dnawork.ai/login</a>.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Trilha
          <Input aria-label="Trilha" value={trilha} onChange={(event) => setTrilha(event.target.value)} placeholder="primeiro-emprego" />
          <span className="font-normal text-slate-500">Nome ou chave. Use * para todos os cursos publicados. Vazio só cria o aluno. Várias trilhas se separam por vírgula.</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Senha
          <Input aria-label="Senha do LMS" type="text" autoComplete="off" value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Opcional, mínimo 8" />
          <span className="font-normal text-slate-500">Se ficar vazia, o LMS gera. Ela só aparece uma vez, quando for definida nesta chamada.</span>
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={trocarSenha} onChange={(event) => setTrocarSenha(event.target.checked)} />
        Se a conta já existir, trocar a senha
      </label>
      {!temEmail ? <p className="mt-3 text-sm text-rose-600">Este candidato não tem e-mail. Edite a ficha antes de criar o acesso.</p> : null}
      {erro ? <p className="mt-3 text-sm text-rose-600" role="alert">{erro}</p> : null}
      {acesso ? (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p>{acesso.contaNova === false ? "A conta já existia e foi reaproveitada." : "Acesso registrado."} {acesso.trails.length ? `Trilhas: ${acesso.trails.join(", ")}.` : "Nenhuma trilha foi enviada."}</p>
          <p className="mt-1">E-mail: <strong>{acesso.email}</strong></p>
          {acesso.password ? (
            <p className="mt-2">
              Senha: <strong className="tracking-wide">{acesso.password}</strong>
              <button type="button" className="ml-2 font-semibold text-cyan-800" onClick={() => void copiar(acesso.password!)}>Copiar</button>
              <span className="mt-1 block">Copie agora. Esta senha não fica salva no sistema e não volta em outra consulta.</span>
            </p>
          ) : <p className="mt-1">Nenhuma senha nova veio nesta resposta. Quem já tinha acesso continua com a senha anterior.</p>}
        </div>
      ) : null}
      <div className="mt-4">
        <Button type="button" disabled={!temEmail || criar.isPending || (senha.trim().length > 0 && senha.trim().length < 8)} onClick={() => criar.mutate()}>
          {criar.isPending ? "Criando…" : "Criar acesso no LMS"}
        </Button>
      </div>
    </Card>
  );
}
