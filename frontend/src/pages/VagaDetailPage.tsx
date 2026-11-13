import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Copy, FilePlus2, Lock, Pencil, RotateCcw, UserPlus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Empty, Skeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { copiarComFoto, fotoDoCargo } from "@/lib/foto-cargo";
import { dateBr, formatCpf, formatPhone, money, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";
import { ProcessosRelacionados } from "@/pages/ProcessosPage";

/** Mensagem para o candidato no formato do Notion (cargo, local, salário + benefícios e horário), com botão de copiar. Copia junto a foto do cargo, se houver. */
function MensagemVaga({ texto, cargo }: { texto: string; cargo: string }) {
  const [copiado, setCopiado] = useState(false);
  const foto = fotoDoCargo(cargo);
  async function copiar() {
    try {
      await copiarComFoto(texto, foto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <Card className="grid gap-3 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-navy-900">Mensagem para o candidato</h2>
          <p className="text-sm text-slate-500">Pronta para colar no WhatsApp{foto ? ", com a foto do cargo" : ""}.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void copiar()}>
          {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? "Copiada" : foto ? "Copiar foto e mensagem" : "Copiar mensagem"}
        </Button>
      </div>
      <div className="flex flex-wrap items-start gap-4 rounded-lg bg-slate-50 p-3">
        {foto ? <img src={foto} alt={`Foto ilustrativa: ${cargo}`} className="aspect-[3/2] w-48 rounded-lg object-cover" /> : null}
        <p className="min-w-0 flex-1 whitespace-pre-line text-sm text-slate-700">{texto}</p>
      </div>
    </Card>
  );
}

type Job = {
  mensagem?: string;
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

/** Card de seção da ficha: título, uma frase opcional e o conteúdo. */
function Secao({ titulo, texto, extra, children }: { titulo: string; texto?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <Card className="grid content-start gap-3 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold text-navy-900">{titulo}</h2>
          {texto ? <p className="text-sm text-slate-500">{texto}</p> : null}
        </div>
        {extra}
      </div>
      {children}
    </Card>
  );
}

/** Pares rótulo/valor. */
function Dados({ itens }: { itens: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-2 text-sm">
      {itens.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex items-baseline justify-between gap-3">
          <dt className="text-xs text-slate-500">{rotulo}</dt>
          <dd className="text-right tabular-nums text-slate-700">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  const [aviso, setAviso] = useState("");
  const desativar = useMutation({
    // Grava o código equivalente no Lightsail e no Postgres (ver lib/vaga-status.ts no backend).
    mutationFn: (situacao: "aberta" | "fechada") => api(`/api/v1/vagas/${id}`, { method: "PATCH", body: JSON.stringify({ situacao }) }),
    onSuccess: async () => {
      setAviso("");
      await job.refetch();
    },
    onError: (error) => setAviso(error instanceof ApiError ? error.message : "Não foi possível alterar o status da vaga."),
  });
  const contracts = useQuery({ queryKey: ["vaga-contratos", id], queryFn: () => api<Contract[]>(`/api/v1/vagas/${id}/contratacoes`) });
  const sugestoes = useQuery({ queryKey: ["vaga-sugeridos", id], queryFn: () => api<Sugestoes>(`/api/v1/vagas/${id}/sugeridos`) });
  if (job.isLoading) return <Skeleton className="h-64" />;
  if (!job.data) return (
    <div className="grid gap-4">
      <Link to="/vagas" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-cyan-700 hover:underline"><ArrowLeft size={16} /> Vagas</Link>
      <Alerta>Vaga não encontrada.</Alerta>
    </div>
  );
  const data = job.data.data;
  const lista = sugestoes.data?.data;
  const inscritos = lista?.total ?? data.inscritos;
  const quantidade = data.quantidade || data.quantidade_posicoes || 0;
  const status = situacaoLabel[data.situacao] ?? data.situacao;
  const modalidade = data.modalidade || regimeLabel[data.regime];
  const blocos = [
    ["Atividades da vaga", data.atribuicaoes],
    ["Atividades no contrato", data.atribu_contrato],
    ["Requisitos desejáveis", data.requisitos_desejaveis],
    ["Destaques", data.destaque],
  ].map(([titulo, texto]) => [titulo, textoPlano(texto)] as const).filter(([, texto]) => texto);
  const etapas: Array<[string, string, number]> = [["1ª etapa", "Candidatos", inscritos], ["2ª etapa", "Entrevistas com o agente", data.entrevistas_agente], ["3ª etapa", "Entrevistas na empresa", data.total], ["4ª etapa", "Contratados", data.contratados]];
  return (
    <div className="grid gap-5">
      <header className="grid gap-3">
        <Link to="/vagas" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-cyan-700"><ArrowLeft size={16} /> Vagas</Link>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="grid min-w-0 gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">{data.cargo}</h1>
              <Badge value={data.situacao}>{status}</Badge>
              <Badge value={data.regime}>{modalidade}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              <Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${data.id_empresa}`}>{data.nome_fantasia || data.razao_social}</Link>
              {" · "}<span className="tabular-nums">{money(data.salario)}</span>
              {data.codigo ? <>{" · "}Código <span className="tabular-nums">{data.codigo}</span></> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/vagas/${id}/editar`}><Button variant="secondary"><Pencil size={16} /> Editar vaga</Button></Link>
            <Link to={`/processos/novo?vaga=${id}&empresa=${data.id_empresa}`}><Button variant="secondary"><FilePlus2 size={16} /> Novo processo</Button></Link>
            {data.situacao === "fechada" ? (
              <Button type="button" variant="secondary" disabled={desativar.isPending} onClick={() => {
                if (window.confirm("Reabrir esta vaga? Ela volta a ficar aberta.")) desativar.mutate("aberta");
              }}><RotateCcw size={16} /> {desativar.isPending ? "Reabrindo…" : "Reabrir vaga"}</Button>
            ) : (
              <Button type="button" variant="danger" disabled={desativar.isPending} onClick={() => {
                if (window.confirm("Fechar esta vaga? O cadastro permanece e ela pode ser reaberta depois.")) desativar.mutate("fechada");
              }}><Lock size={16} /> {desativar.isPending ? "Fechando…" : "Fechar vaga"}</Button>
            )}
            <Link to={`/contratacoes/nova?vaga=${id}&empresa=${data.id_empresa}`}><Button><UserPlus size={16} /> Contratar</Button></Link>
          </div>
        </div>
      </header>
      {aviso ? <Alerta>{aviso}</Alerta> : null}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Funil da vaga">
        {etapas.map(([etapa, nome, valor]) => (
          <li key={etapa} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-cyan-700">{etapa}</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums text-navy-900">{valor.toLocaleString("pt-BR")}</p>
            <p className="text-sm text-slate-500">{nome}</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Secao titulo="Abertura">
          <Dados itens={[["Data", dateBr(data.dataabertura)], ["Modalidade", modalidade], ["Quantidade", quantidade || "—"]]} />
        </Secao>
        <Secao titulo="Inscritos">
          <Dados itens={[["Total", inscritos]]} />
        </Secao>
        <Secao titulo="Entrevistas">
          <Dados itens={[["Total", data.total], ["Confirmou presença", data.confirmou], ["Negou presença", data.negou], ["Não respondeu", data.sem_resposta], ["Recusados", data.recusados]]} />
        </Secao>
        <Secao titulo="Contrato">
          <Dados itens={[[data.regime === "clt" ? "Salário" : "Bolsa auxílio", money(data.salario)], ["Situação da vaga", status], ["Contratados", data.contratados], ["Código", data.codigo || "—"]]} />
        </Secao>
      </div>
      {data.mensagem ? <MensagemVaga texto={data.mensagem} cargo={data.cargo} /> : null}
      <Secao titulo="Informações gerais">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_auto_1fr] sm:items-baseline">
          <div className="flex items-baseline gap-2"><dt className="text-xs text-slate-500">Distância</dt><dd className="tabular-nums text-slate-700">{data.km ? `${data.km} km` : "—"}</dd></div>
          <div className="flex items-baseline gap-2"><dt className="text-xs text-slate-500">Carga horária</dt><dd className="text-slate-700">{data.carga_horaria ? `${data.carga_horaria} h por semana` : "não informada"}</dd></div>
        </dl>
        {blocos.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {blocos.map(([titulo, texto]) => (
              <div key={titulo}><p className="text-xs font-semibold text-slate-500">{titulo}</p><p className="mt-1 whitespace-pre-line text-sm text-slate-700">{texto}</p></div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">Esta vaga não tem atividades, requisitos ou destaques cadastrados.</p>}
      </Secao>
      <Secao titulo="Candidatos sugeridos" texto="Perto da vaga e com o perfil pedido. Quem já trabalhou na empresa aparece marcado." extra={<span className="text-sm text-slate-500"><span className="font-bold tabular-nums text-navy-900">{inscritos}</span> {inscritos === 1 ? "candidato" : "candidatos"}</span>}>
        {sugestoes.isLoading ? <Skeleton className="h-24" /> : null}
        {sugestoes.isError ? <Alerta>Não foi possível buscar os candidatos desta vaga.</Alerta> : null}
        {lista?.candidatos.length ? (
          <ul className="grid gap-2">{lista.candidatos.map((item) => {
            const anos = idade(item.datanascimento);
            return (
              <li key={item.id_candidato}>
                <Link to={`/candidatos/${item.id_candidato}`} className="group flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-cyan-700">{item.nome}</span>
                      {anos ? <span className="text-sm text-slate-500">{anos} anos</span> : null}
                      {item.ja_trabalhou ? <Badge value="pausada">Já trabalhou</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-500">{[formatPhone(item.celular), [item.escolaridade, item.periodo].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</p>
                    <p className="text-sm text-slate-500">{[item.bairro, item.cidade].filter(Boolean).join(" · ")}{item.km != null ? ` · ${item.km} km` : ""}</p>
                    {item.experiencias.length ? <p className="mt-0.5 text-xs text-slate-600">Experiência: {item.experiencias.slice(0, 3).join(" · ")}</p> : null}
                  </div>
                  <ChevronRight size={16} className="mt-1 shrink-0 text-slate-400" aria-hidden />
                </Link>
              </li>
            );
          })}</ul>
        ) : sugestoes.isSuccess ? <Empty title="Nenhum candidato sugerido" text="Ninguém no banco combina com a distância e o perfil desta vaga agora." /> : null}
      </Secao>
      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Quem já trabalhou" texto="Pessoas que já passaram por este cargo na empresa.">
          {lista?.jaTrabalhou.length ? (
            <ul className="grid gap-2">{lista.jaTrabalhou.map((item) => (
              <li key={item.id_candidato}>
                <Link to={`/candidatos/${item.id_candidato}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-semibold text-cyan-700">{item.nome}</span>
                    <span className="block text-sm text-slate-500">{[item.cargo, formatPhone(item.celular)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-sm tabular-nums text-slate-500">{dateBr(item.inicio)} até {dateBr(item.saida)}</span>
                </Link>
              </li>
            ))}</ul>
          ) : <p className="text-sm text-slate-500">Ninguém com passagem encerrada neste cargo na empresa.</p>}
        </Secao>
        <Secao titulo="Candidatos contratados" texto="Contratações feitas por esta vaga.">
          {contracts.data?.data.length ? (
            <ul className="grid gap-2">{contracts.data.data.map((item) => (
              <li key={item.id_contratacao}>
                <Link to={`/contratacoes/${item.id_contratacao}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block font-semibold text-cyan-700">{item.candidato_nome}</span>
                    <span className="block text-sm tabular-nums text-slate-500">{formatCpf(item.candidato_cpf)} · início {dateBr(item.data_inicio)}</span>
                  </span>
                  <Badge value={item.situacao}>{situacaoLabel[item.situacao]}</Badge>
                </Link>
              </li>
            ))}</ul>
          ) : <p className="text-sm text-slate-500">Nenhum candidato contratado nesta vaga.</p>}
        </Secao>
      </div>
      <ProcessosRelacionados filtro={`id_vaga=${id}`} />
    </div>
  );
}
