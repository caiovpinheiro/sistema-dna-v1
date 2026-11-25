import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ArrowLeftRight, FileText, Search, UserMinus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentosContratacao } from "@/components/documentos-contratacao";
import { Alerta } from "@/components/pagina";
import { Badge, Button, Card, Input, Skeleton, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCnpj, formatCpf, money, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";
import { VoltarLink } from "../components/voltar";

type Detail = {
  id_contratacao: number; id_candidato: string; id_empresa: string; id_vaga: string;
  candidato_nome: string | null; candidato_cpf: string | null; empresa_razao: string | null; empresa_fantasia: string | null;
  cargo: string | null; modalidade: string | null; regime: string; salario: number | null; situacao: string;
  data_inicio: string | null; data_encerramento: string | null; data_fim_prevista: string | null; carga_horaria: string | null;
};

export function ContratacaoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["contratacao", id], queryFn: () => api<Detail>(`/api/v1/contratacoes/${id}`) });
  if (query.isLoading) return <Skeleton className="h-80" />;
  if (!query.data) {
    return (
      <div className="grid gap-3">
        <Voltar />
        <Alerta>Contratação não encontrada. Ela pode ter sido removida ou o endereço está incompleto.</Alerta>
      </div>
    );
  }
  const data = query.data.data;
  const candidato = textoPlano(data.candidato_nome) || "Sem nome";
  const empresa = textoPlano(data.empresa_fantasia) || textoPlano(data.empresa_razao);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Voltar />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-semibold text-slate-500">Contratação nº {data.id_contratacao}</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">{candidato}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge value={data.situacao}>{situacaoLabel[data.situacao] ?? data.situacao}</Badge>
            <Badge value={data.regime}>{regimeLabel[data.regime] ?? data.regime}</Badge>
            <span>{[textoPlano(data.cargo), empresa].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        {data.regime === "estagio" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button title="Abre o gerador de TCE já preenchido com o candidato, a escola, a empresa e a vaga desta contratação." onClick={() => navigate(`/termos/gerar?contratacao=${data.id_contratacao}`)}><FileText size={16} /> Gerar TCE</Button>
          </div>
        ) : null}
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Vínculo</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Par rotulo="Candidato"><Link className="font-semibold text-cyan-700 hover:underline" to={`/candidatos/${data.id_candidato}`}>{candidato}</Link></Par>
            <Par rotulo="CPF"><span className="tabular-nums">{formatCpf(data.candidato_cpf)}</span></Par>
            <Par rotulo="Empresa">{empresa ? <Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${data.id_empresa}`}>{empresa}</Link> : "—"}</Par>
            <Par rotulo="Vaga"><Link className="font-semibold text-cyan-700 hover:underline" to={`/vagas/${data.id_vaga}`}>{textoPlano(data.cargo) || "Abrir vaga"}</Link></Par>
            <Par rotulo="Modalidade">{textoPlano(data.modalidade) || "—"}</Par>
            <Par rotulo="Regime">{regimeLabel[data.regime] ?? "—"}</Par>
            <Par rotulo="Salário ou bolsa"><span className="tabular-nums">{money(data.salario)}</span></Par>
            <Par rotulo="Carga horária">{data.carga_horaria || "—"}</Par>
          </dl>
        </Card>
        <Card className="grid content-start gap-4">
          <h2 className="text-[15px] font-bold text-navy-900">Datas</h2>
          <dl className="grid gap-y-3">
            <Par rotulo="Início"><span className="tabular-nums">{dateBr(data.data_inicio)}</span></Par>
            <Par rotulo="Previsão de fim"><span className="tabular-nums">{dateBr(data.data_fim_prevista)}</span></Par>
            <Par rotulo="Encerramento"><span className="tabular-nums">{dateBr(data.data_encerramento)}</span></Par>
          </dl>
        </Card>
      </div>

      <DocumentosContratacao id={String(data.id_contratacao)} />

      {data.situacao === "ativa" ? <TrocarVaga data={data} /> : null}

      {data.situacao === "ativa" ? (
        <Card className="grid gap-4 md:max-w-2xl">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">Encerrar vínculo</h2>
            <p className="text-sm text-slate-500">
              O encerramento é feito pela rescisão: lá você informa a data, o motivo e a avaliação, confere a prévia e o documento de rescisão é gerado junto. O histórico da contratação é mantido.
            </p>
          </div>
          <Link to={`/contratacoes/rescisao/${data.id_contratacao}`} className="justify-self-start">
            <Button variant="danger" className="h-10"><UserMinus size={16} /> Fazer a rescisão</Button>
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

type EmpresaOpcao = { id_empresa: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null; cidade: string | null; uf: string | null };
type VagaOpcao = { id_vaga: string; cargo: string; regime: string; situacao: string; disponiveis: number | null; quantidade_posicoes: number | null; ocupadas: number; salario: number | null };

/** Corrige a vaga de uma contratação ativa (ex.: foi escolhida a vaga de outra unidade com o mesmo cargo). */
function TrocarVaga({ data }: { data: Detail }) {
  const client = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [empresa, setEmpresa] = useState<EmpresaOpcao | null>(null);
  const [vagaId, setVagaId] = useState("");
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");
  const empresas = useQuery({
    queryKey: ["trocar-vaga-empresas", busca],
    enabled: aberto && !empresa && busca.trim().length >= 2,
    queryFn: () => api<EmpresaOpcao[]>(`/api/v1/empresas?pageSize=8&q=${encodeURIComponent(busca.trim())}`),
  });
  const vagas = useQuery({
    queryKey: ["vagas-empresa", empresa?.id_empresa],
    enabled: Boolean(empresa),
    queryFn: () => api<VagaOpcao[]>(`/api/v1/empresas/${empresa!.id_empresa}/vagas?pageSize=100&situacao=aberta`),
  });
  const opcoes = (vagas.data?.data ?? []).filter((vaga) =>
    vaga.id_vaga !== data.id_vaga && vaga.situacao === "aberta" && (vaga.disponiveis ?? 0) > 0 && vaga.regime === data.regime);
  const escolhida = opcoes.find((vaga) => vaga.id_vaga === vagaId);
  const trocar = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${data.id_contratacao}/trocar-vaga`, { method: "POST", body: JSON.stringify({ id_vaga: vagaId }) }),
    onSuccess: async () => {
      const nome = empresa ? textoPlano(empresa.nome_fantasia) || textoPlano(empresa.razao_social) : "";
      setFeito(`Vaga trocada para ${textoPlano(escolhida?.cargo) || "a vaga escolhida"}${nome ? ` em ${nome}` : ""}.`);
      setAberto(false);
      setEmpresa(null);
      setBusca("");
      setVagaId("");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["contratacao", String(data.id_contratacao)] }),
        client.invalidateQueries({ queryKey: ["vagas-empresa"] }),
      ]);
    },
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível trocar a vaga."),
  });
  function fechar() {
    setAberto(false);
    setEmpresa(null);
    setBusca("");
    setVagaId("");
    setErro("");
  }
  return (
    <Card className="grid gap-4 md:max-w-2xl">
      <div>
        <h2 className="text-[15px] font-bold text-navy-900">Trocar vaga</h2>
        <p className="text-sm text-slate-500">
          Use quando a contratação foi registrada na vaga errada (por exemplo, a mesma vaga de outra unidade). A posição sai da vaga atual e passa a contar na nova; empresa, colaborador e processo seletivo seguem a nova vaga.
        </p>
      </div>
      {feito ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{feito}</p> : null}
      {!aberto ? (
        <Button variant="secondary" className="h-10 justify-self-start" onClick={() => { setAberto(true); setFeito(""); }}><ArrowLeftRight size={16} /> Trocar vaga</Button>
      ) : (
        <div className="grid gap-3">
          {!empresa ? (
            <>
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input aria-label="Buscar empresa da nova vaga" className="pl-9" placeholder="Empresa da vaga certa: nome, razão social ou CNPJ" value={busca} onChange={(event) => setBusca(event.target.value)} autoFocus />
              </label>
              {empresas.isFetching && !empresas.data ? <p className="text-sm text-slate-500">Buscando…</p> : null}
              {busca.trim().length >= 2 && empresas.data && empresas.data.data.length === 0 ? <p className="text-sm text-slate-500">Nenhuma empresa encontrada.</p> : null}
              {empresas.data?.data.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {empresas.data.data.map((item) => {
                    const nome = textoPlano(item.nome_fantasia) || textoPlano(item.razao_social);
                    const local = [item.cidade, item.uf].filter(Boolean).join(" / ");
                    return (
                      <button key={item.id_empresa} type="button" title={[nome, textoPlano(item.razao_social), local].filter(Boolean).join(" · ")}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-cyan-600"
                        onClick={() => { setEmpresa(item); setVagaId(""); setErro(""); }}>
                        <span className="block truncate font-semibold text-navy-900">{nome}</span>
                        <span className="block truncate text-xs tabular-nums text-slate-500">{[formatCnpj(item.cnpj), local].filter(Boolean).join(" · ")}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">Empresa:</span>
                <span className="font-semibold text-navy-900">{textoPlano(empresa.nome_fantasia) || textoPlano(empresa.razao_social)}</span>
                <span className="text-xs tabular-nums text-slate-500">{formatCnpj(empresa.cnpj)}</span>
                <button type="button" className="font-semibold text-cyan-700 hover:underline" onClick={() => { setEmpresa(null); setVagaId(""); }}>Trocar</button>
              </div>
              {vagas.isLoading ? <p className="text-sm text-slate-500">Carregando vagas…</p> : null}
              {vagas.data && opcoes.length === 0 ? (
                <p className="text-sm text-slate-500">Esta empresa não tem vaga aberta, com posição livre e do mesmo regime ({regimeLabel[data.regime] ?? data.regime}).</p>
              ) : null}
              {opcoes.length ? (
                <div className="grid gap-2">
                  {opcoes.map((vaga) => (
                    <button key={vaga.id_vaga} type="button" aria-pressed={vagaId === vaga.id_vaga}
                      className={cn("rounded-lg border px-3 py-2 text-left", vagaId === vaga.id_vaga ? "border-cyan-600 bg-cyan-50" : "border-slate-200 hover:border-cyan-600")}
                      onClick={() => { setVagaId(vaga.id_vaga); setErro(""); }}>
                      <span className="block font-semibold text-navy-900">{textoPlano(vaga.cargo)}</span>
                      <span className="block text-xs text-slate-500">
                        <span className="tabular-nums">{vaga.ocupadas}</span>/<span className="tabular-nums">{vaga.quantidade_posicoes ?? 1}</span> preenchidas · <span className="tabular-nums">{vaga.disponiveis}</span> disponíveis{vaga.salario != null ? ` · ${money(vaga.salario)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
          {erro ? <Alerta>{erro}</Alerta> : null}
          <div className="flex flex-wrap gap-2">
            <Button className="h-10" disabled={!escolhida || trocar.isPending} onClick={() => { setErro(""); trocar.mutate(); }}>
              <ArrowLeftRight size={16} /> {trocar.isPending ? "Trocando…" : "Confirmar troca"}
            </Button>
            <Button variant="secondary" className="h-10" onClick={fechar}>Cancelar</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Voltar() {
  return <VoltarLink to="/contratacoes" rotulo="Contratações" />;
}

function Par({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-slate-500">{rotulo}</dt>
      <dd className="break-words text-slate-700">{children}</dd>
    </div>
  );
}
