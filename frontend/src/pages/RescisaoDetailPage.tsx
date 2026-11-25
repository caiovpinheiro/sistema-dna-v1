import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, ExternalLink, Eye, FileX, Pencil, Save, Send } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DocumentosContratacao } from "@/components/documentos-contratacao";
import { Alerta, FiltroChips } from "@/components/pagina";
import { Badge, Button, Card, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateBr, formatCpf, formatPhone, money, regimeLabel, situacaoLabel, textoPlano } from "@/lib/format";
import { VoltarLink } from "../components/voltar";

type Detail = {
  id_contratacao: number;
  id_candidato: string;
  id_empresa: string;
  id_vaga: string;
  candidato_nome: string | null;
  candidato_cpf: string | null;
  empresa_razao: string | null;
  empresa_fantasia: string | null;
  cargo: string | null;
  modalidade: string | null;
  regime: string;
  salario: number | null;
  situacao: string;
  data_inicio: string | null;
  data_encerramento: string | null;
  data_fim_prevista: string | null;
  carga_horaria: string | null;
};

type Candidato = {
  nome: string | null;
  idade: number | null;
  cpf: string | null;
  email: string | null;
  celular: string | null;
  telefone: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  curriculo?: {
    escolaridade: string | null;
    instituicao: { nome_fantasia: string | null; razao_social: string | null } | null;
    terminoestudo: string | null;
  };
};

type Vaga = {
  atribu_contrato: string | null;
  atribuicaoes: string | null;
};

type RescisaoSalva = {
  motivo: string;
  motivo_interno: string | null;
  avaliacao: string | null;
  resumo: string | null;
  data_demissao: string | null;
  assinatura: string;
  editavel: boolean;
};

type ContratoFaltante = {
  id: string;
  origem: "historico" | "termo";
  nome: string;
  data: string | null;
  situacao: string;
  texto: string | null;
};

const MOTIVOS = [
  "Candidato solicitou o desligamento",
  "Empresa solicitou o desligamento",
] as const;

const AVALIACOES = ["Excelente", "Muito bom", "Bom", "Regular", "Insuficiente"] as const;

export function RescisaoDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [dataDemissao, setDataDemissao] = useState("");
  const [avaliacao, setAvaliacao] = useState<(typeof AVALIACOES)[number] | "">("");
  const [resumo, setResumo] = useState("");
  const [motivoInterno, setMotivoInterno] = useState("");
  const [previa, setPrevia] = useState(false);
  const [message, setMessage] = useState("");
  const [resumoPronto, setResumoPronto] = useState(false);
  const [pedido, setPedido] = useState<"" | "perguntar" | "enviado">("");
  const [faltantes, setFaltantes] = useState<ContratoFaltante[] | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [salvo, setSalvo] = useState("");

  const query = useQuery({
    queryKey: ["rescisao-contratacao", id],
    queryFn: () => api<Detail>(`/api/v1/contratacoes/${id}`),
  });
  const data = query.data?.data;

  const candidato = useQuery({
    queryKey: ["rescisao-candidato", data?.id_candidato],
    queryFn: () => api<Candidato>(`/api/v1/candidatos/${data!.id_candidato}`),
    enabled: Boolean(data?.id_candidato),
  });

  const vaga = useQuery({
    queryKey: ["rescisao-vaga", data?.id_vaga],
    queryFn: () => api<Vaga>(`/api/v1/vagas/${data!.id_vaga}`),
    enabled: Boolean(data?.id_vaga),
    retry: false,
  });

  // Vínculo encerrado: a rescisão gravada (404 quando foi encerrado sem rescisão).
  const rescisao = useQuery({
    queryKey: ["rescisao-documento", id],
    queryFn: () => api<RescisaoSalva>(`/api/v1/contratacoes/${id}/rescisao`),
    enabled: Boolean(data && data.situacao !== "ativa"),
    retry: false,
  });
  const salva = rescisao.data?.data;

  useEffect(() => {
    if (resumoPronto || !vaga.data || data?.situacao !== "ativa") return;
    const texto = textoPlano(vaga.data.data.atribu_contrato || vaga.data.data.atribuicaoes);
    if (texto) setResumo(texto);
    setResumoPronto(true);
  }, [vaga.data, resumoPronto]);

  const demitir = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${id}/encerrar`, {
      method: "POST",
      body: JSON.stringify({
        data_encerramento: dataDemissao,
        motivo,
        motivo_interno: motivoInterno,
        avaliacao: avaliacao || undefined,
        resumo,
      }),
    }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["rescisao"] });
      await client.invalidateQueries({ queryKey: ["contratacoes"] });
      await client.invalidateQueries({ queryKey: ["contratacao", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
      setPedido("perguntar");
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : "Não foi possível demitir."),
  });

  const salvarEdicao = useMutation({
    mutationFn: () => api<RescisaoSalva>(`/api/v1/contratacoes/${id}/rescisao`, {
      method: "PATCH",
      body: JSON.stringify({
        data_encerramento: dataDemissao,
        motivo,
        motivo_interno: motivoInterno,
        avaliacao: avaliacao || undefined,
        resumo,
      }),
    }),
    onSuccess: async () => {
      setEditando(false);
      setPrevia(false);
      setMessage("");
      setSalvo("Rescisão atualizada. O documento foi refeito: envie para assinatura de novo no quadro abaixo.");
      await client.invalidateQueries({ queryKey: ["rescisao"] });
      await client.invalidateQueries({ queryKey: ["contratacoes"] });
      await client.invalidateQueries({ queryKey: ["rescisao-contratacao", id] });
      await client.invalidateQueries({ queryKey: ["rescisao-documento", id] });
      await client.invalidateQueries({ queryKey: ["contratacao", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-assinatura", id] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : "Não foi possível salvar a rescisão."),
  });

  function abrirEdicao() {
    if (!salva) return;
    setMotivo(salva.motivo);
    setDataDemissao(salva.data_demissao ?? "");
    setAvaliacao(AVALIACOES.find((item) => item === salva.avaliacao) ?? "");
    setResumo(salva.resumo ?? "");
    setMotivoInterno(salva.motivo_interno ?? "");
    setMessage("");
    setSalvo("");
    setPrevia(false);
    setEditando(true);
  }

  function salvarAlteracoes() {
    setMessage("");
    if (!motivo || !dataDemissao) {
      setMessage("Preencha o motivo e a data de demissão.");
      return;
    }
    salvarEdicao.mutate();
  }

  const enviarAssinatura = useMutation({
    mutationFn: () => api(`/api/v1/contratacoes/${id}/assinatura`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("");
      setPedido("enviado");
      await client.invalidateQueries({ queryKey: ["contratacao-documentos", id] });
      await client.invalidateQueries({ queryKey: ["contratacao-assinatura", id] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : "A ZapSign não enviou a assinatura."),
  });

  const cand = candidato.data?.data;
  const empresa = textoPlano(data?.empresa_fantasia) || textoPlano(data?.empresa_razao) || "—";
  const periodo = useMemo(() => {
    if (!data) return "—";
    return `${dateBr(data.data_inicio)} a ${dateBr(data.data_fim_prevista)}`;
  }, [data]);

  function gerarPrevia() {
    setMessage("");
    if (!motivo || !dataDemissao) {
      setMessage("Selecione o motivo e a data de demissão para gerar a prévia.");
      setPrevia(false);
      return;
    }
    setPrevia(true);
  }

  async function confirmarDemissao() {
    setMessage("");
    if (!motivo || !dataDemissao) {
      setMessage("Preencha o motivo e a data de demissão.");
      return;
    }
    // Contrato da entrada sem assinatura não impede a rescisão: só avisa e deixa seguir.
    setConferindo(true);
    try {
      const resposta = await api<ContratoFaltante[]>(`/api/v1/contratacoes/${id}/contratos-faltantes`);
      if (resposta.data.length) {
        setVendo(null);
        setFaltantes(resposta.data);
        return;
      }
    } catch {
      // Se a conferência falhar, a rescisão segue como antes.
    } finally {
      setConferindo(false);
    }
    demitir.mutate();
  }

  function seguirComRescisao() {
    setFaltantes(null);
    demitir.mutate();
  }

  if (query.isLoading) return <Skeleton className="h-80" />;
  if (!data) {
    return (
      <div className="grid gap-3">
        <Voltar />
        <Alerta>Contratação não encontrada. Ela pode ter sido removida ou o endereço está incompleto.</Alerta>
      </div>
    );
  }

  const nome = textoPlano(data.candidato_nome) || "Sem nome";
  const erroForm = message && !pedido;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Voltar />
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <p className="text-xs font-semibold text-slate-500">Rescisão · contratação nº {data.id_contratacao}</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">{nome}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Badge value={data.situacao}>{situacaoLabel[data.situacao] ?? data.situacao}</Badge>
            <Badge value={data.regime}>{regimeLabel[data.regime] ?? data.regime}</Badge>
            <span>{[textoPlano(data.cargo), empresa].filter((item) => item && item !== "—").join(" · ")} · {periodo}</span>
          </div>
        </div>
        <Link to={`/contratacoes/${data.id_contratacao}`}><Button variant="secondary">Abrir contratação <ChevronRight size={16} /></Button></Link>
      </header>

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-bold text-navy-900">Dados do contratado</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="font-semibold text-cyan-700 hover:underline" to={`/candidatos/${data.id_candidato}`}>Abrir candidato</Link>
            <Link className="font-semibold text-cyan-700 hover:underline" to={`/empresas/${data.id_empresa}`}>Abrir empresa</Link>
            <Link className="font-semibold text-cyan-700 hover:underline" to={`/vagas/${data.id_vaga}`}>Abrir vaga</Link>
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Nome" value={textoPlano(cand?.nome) || nome} />
          <Info label="Idade" value={cand?.idade != null ? `${cand.idade} anos` : "—"} />
          <Info label="CPF" value={formatCpf(cand?.cpf || data.candidato_cpf)} />
          <Info label="E-mail" value={cand?.email || "—"} />
          <Info label="Celular" value={formatPhone(cand?.celular || cand?.telefone)} />
          <Info label="Regime" value={regimeLabel[data.regime] || "—"} />
          <Info label="Modalidade" value={textoPlano(data.modalidade) || "—"} />
          <Info label="Salário ou bolsa" value={money(data.salario)} />
          <Info label="Carga horária" value={data.carga_horaria || "—"} />
          <Info label="Formação" value={cand?.curriculo?.escolaridade || "—"} />
          <Info label="Instituição" value={textoPlano(cand?.curriculo?.instituicao?.nome_fantasia || cand?.curriculo?.instituicao?.razao_social) || "—"} />
          <Info label="Término de estudo" value={dateBr(cand?.curriculo?.terminoestudo)} />
          <Info label="Bairro" value={cand?.bairro || "—"} />
          <Info label="Cidade / UF" value={[cand?.cidade, cand?.uf].filter(Boolean).join(" / ") || "—"} />
        </dl>
      </Card>

      {salvo ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{salvo}</p> : null}

      {data.situacao === "ativa" || editando ? (
        <Card className="grid max-w-4xl gap-5 md:p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy-900">{editando ? "Editar rescisão" : "Demitir"}</h2>
            <p className="text-sm text-slate-500">
              {editando
                ? "Corrija os dados e salve. O documento é refeito e precisa ser enviado para assinatura de novo."
                : "Preencha os dados da rescisão. Ao confirmar, o documento é gerado e o vínculo é encerrado."}
            </p>
          </div>
          {editando && salva?.assinatura === "Aguardando" ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Esta rescisão já foi enviada para assinatura. Ao salvar, o link enviado deixa de valer aqui: avise a pessoa e envie o documento novo.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <Field label="Motivo da demissão (vai no documento)">
                <Select aria-label="Motivo da demissão" value={motivo} onChange={(event) => setMotivo(event.target.value)}>
                  <option value="">Selecione</option>
                  {MOTIVOS.map((item) => <option key={item} value={item}>{item}</option>)}
                  {motivo && !MOTIVOS.some((item) => item === motivo) ? <option value={motivo}>{motivo}</option> : null}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Data de demissão">
                <Input type="date" aria-label="Data de demissão" value={dataDemissao} onChange={(event) => setDataDemissao(event.target.value)} />
              </Field>
            </div>
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Avaliação de desempenho</span>
            <FiltroChips
              rotulo="Avaliação de desempenho"
              opcoes={AVALIACOES.map((item) => ({ id: item, rotulo: item }))}
              valor={avaliacao}
              onChange={(item) => setAvaliacao(item as (typeof AVALIACOES)[number])}
            />
          </div>

          <Field label="Resumo das atividades">
            <Textarea aria-label="Resumo das atividades" value={resumo} onChange={(event) => setResumo(event.target.value)} rows={6} />
          </Field>

          <Field label="Motivo interno (não vai no documento)">
            <Textarea aria-label="Motivo interno" value={motivoInterno} onChange={(event) => setMotivoInterno(event.target.value)} rows={4} placeholder="Anotação interna da equipe" />
          </Field>

          {erroForm ? <Alerta>{message}</Alerta> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
            {editando ? (
              <>
                <Button disabled={salvarEdicao.isPending} onClick={salvarAlteracoes}>
                  <Save size={16} /> {salvarEdicao.isPending ? "Salvando…" : "Salvar alterações"}
                </Button>
                <Button variant="secondary" type="button" disabled={salvarEdicao.isPending} onClick={() => { setEditando(false); setMessage(""); setPrevia(false); }}>Cancelar</Button>
              </>
            ) : (
              <Button variant="danger" disabled={demitir.isPending || conferindo} onClick={() => void confirmarDemissao()}>
                <FileX size={16} /> {demitir.isPending ? "Gerando…" : conferindo ? "Conferindo contratos…" : "Gerar rescisão e demitir"}
              </Button>
            )}
            <Button variant="secondary" type="button" onClick={gerarPrevia}>
              <Eye size={16} /> Ver prévia
            </Button>
            <span className="text-xs text-slate-500">A prévia só aparece na tela; nada é gravado.</span>
          </div>

          {previa ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <h3 className="text-[15px] font-bold text-navy-900">Prévia da rescisão</h3>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <Info label="Candidato" value={nome} />
                <Info label="Empresa" value={empresa} />
                <Info label="Cargo" value={textoPlano(data.cargo) || "—"} />
                <Info label="Motivo" value={motivo} />
                <Info label="Data" value={dateBr(dataDemissao)} />
                <Info label="Avaliação" value={avaliacao || "—"} />
              </dl>
              <div>
                <p className="text-xs text-slate-500">Atividades</p>
                <p className="whitespace-pre-line text-slate-700">{resumo || "—"}</p>
              </div>
              {motivoInterno ? (
                <div>
                  <p className="text-xs text-slate-500">Motivo interno</p>
                  <p className="whitespace-pre-line text-slate-700">{motivoInterno}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-[15px] font-bold text-navy-900">Demissão</h2>
            <p className="text-sm text-slate-500">
              Este vínculo já está encerrado em {dateBr(data.data_encerramento)}.{" "}
              <Link className="font-semibold text-cyan-700 hover:underline" to={`/contratacoes/${data.id_contratacao}`}>Abrir nas informações da contratação</Link>
            </p>
            {salva && !salva.editavel ? <p className="text-sm text-slate-500">A rescisão já foi assinada e não pode mais ser editada.</p> : null}
          </div>
          {salva?.editavel ? (
            <Button variant="secondary" onClick={abrirEdicao}><Pencil size={16} /> Editar rescisão</Button>
          ) : null}
        </Card>
      )}

      <DocumentosContratacao id={String(data.id_contratacao)} />
      {faltantes ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Contrato faltante">
          <div className="grid max-h-[90vh] w-full max-w-lg gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-700 shadow-xl">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-navy-900">
                <AlertTriangle size={20} className="shrink-0 text-amber-500" /> Contrato faltante
              </h2>
              <p className="mt-2 text-sm">
                {faltantes.length === 1 ? "Este contrato da entrada não voltou assinado:" : `Estes ${faltantes.length} contratos da entrada não voltaram assinados:`}
              </p>
            </div>
            <ul className="grid gap-2">
              {faltantes.map((item) => {
                const chave = `${item.origem}-${item.id}`;
                return (
                  <li key={chave} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="font-semibold text-navy-900">{item.nome}</span>
                        <span className="text-xs text-slate-500">
                          {[item.situacao, item.data ? `gerado em ${dateBr(item.data)}` : "", item.origem === "historico" ? "sistema antigo" : ""].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      {item.origem === "termo" ? (
                        <a className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 hover:underline" href={`/termos/${item.id}`} target="_blank" rel="noreferrer">
                          Ver contrato <ExternalLink size={14} />
                        </a>
                      ) : (
                        <button type="button" className="text-sm font-semibold text-cyan-700 hover:underline" aria-expanded={vendo === chave} onClick={() => setVendo(vendo === chave ? null : chave)}>
                          {vendo === chave ? "Fechar contrato" : "Ver contrato"}
                        </button>
                      )}
                    </div>
                    {vendo === chave ? (
                      <p className="max-h-60 overflow-y-auto whitespace-pre-line rounded border border-slate-200 bg-white p-2 text-xs text-slate-600">
                        {textoPlano(item.texto) || "Contrato sem texto gravado no sistema."}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-slate-500">A rescisão pode seguir mesmo sem essas assinaturas.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" disabled={demitir.isPending} onClick={seguirComRescisao}>
                <FileX size={16} /> Seguir com rescisão
              </Button>
              <Button variant="secondary" onClick={() => setFaltantes(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      ) : null}
      {pedido ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Assinatura digital">
          <div className="grid w-full max-w-md gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-slate-700 shadow-xl">
            <div>
              <h2 className="text-xl font-extrabold text-navy-900">Assinatura digital</h2>
              {pedido === "perguntar" ? (
                <p className="mt-2 text-sm">A rescisão foi gerada e o vínculo encerrado. Enviar este documento para assinatura digital na ZapSign?</p>
              ) : (
                <p className="mt-2 text-sm">Documento enviado para assinatura. Envelope enviado.</p>
              )}
            </div>
            {message ? <Alerta>{message}</Alerta> : null}
            <div className="flex flex-wrap items-center gap-2">
              {pedido === "perguntar" ? (
                <>
                  <Button disabled={enviarAssinatura.isPending} onClick={() => enviarAssinatura.mutate()}>
                    <Send size={16} /> {enviarAssinatura.isPending ? "Enviando…" : "Sim, enviar"}
                  </Button>
                  <Button variant="secondary" onClick={() => navigate(`/contratacoes/${id}`)}>Não, agora não</Button>
                </>
              ) : null}
              <button type="button" className="ml-auto text-sm font-semibold text-cyan-700 hover:underline" onClick={() => navigate(`/contratacoes/${id}`)}>
                Ver documento
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Voltar() {
  return <VoltarLink to="/contratacoes/rescisao" rotulo="Rescisão" />;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-slate-700">{value || "—"}</dd>
    </div>
  );
}
