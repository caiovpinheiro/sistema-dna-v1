import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ClipboardCopy, FileText, Loader2, Phone, Save, Search, Sparkles, Upload, X } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { api } from "@/lib/api";

type Vaga = { id: string; cargo: string; empresa: string; tipo: "CLT" | "Estágio"; local: string };

type Negocio = {
  id: string;
  titulo: string;
  status: string | null;
  etapa: string | null;
  funil: string | null;
  contato: string | null;
  telefone: string | null;
  atualizadoEm: string | null;
};

type CandidatoDados = {
  nome: string | null;
  idade: string | number | null;
  escolaridade: string | null;
  turno: string | null;
  sexo: string | null;
  resumo_cv: string | null;
  tipo_de_vaga: string | null;
  "teste comportamental": string | null;
  info_conducoes: string | null;
  resumo_entrevista: string | null;
  descricao_vaga: string | null;
};

type Busca = { negocios: Negocio[]; negocio: Negocio | null; candidato: CandidatoDados | null; vagaEscolhidaId: string | null; idVagaCrm: string | null };
type Manual = { nome: string; idade: string; escolaridade: string; turno: string; bairroCidade: string };
type Resultado = { dossie: string; tipo: "CLT" | "Estágio"; modelo: string; vaga: Vaga; curriculo: "enviado" | "banco" | "nenhum" };

const MANUAL_VAZIO: Manual = { nome: "", idade: "", escolaridade: "", turno: "", bairroCidade: "" };
const TAMANHO_MAXIMO = 5 * 1024 * 1024;
const ACEITOS = ".pdf,.docx,.png,.jpg,.jpeg,.webp";

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

function mascaraTelefone(valor: string) {
  const d = valor.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Passo({ numero, titulo, texto, children }: { numero: number; titulo: string; texto?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-700 text-xs font-bold text-white">{numero}</span>
        <div>
          <p className="text-sm font-semibold text-navy-900">{titulo}</p>
          {texto ? <p className="text-xs text-slate-500">{texto}</p> : null}
        </div>
      </div>
      <div className="grid gap-3 pl-9">{children}</div>
    </div>
  );
}

function Indicador({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium", ativo ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500")}>
      {ativo ? <Check size={12} /> : <X size={12} />} {children}
    </span>
  );
}

/** Dados do negócio e da linha de candidatos_dados que vão para o dossiê. */
function ResumoCandidato({ negocio, candidato }: { negocio: Negocio; candidato: CandidatoDados | null }) {
  return (
    <div className="grid gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <p>
        <span className="font-semibold text-navy-900">{negocio.contato || negocio.titulo}</span>
        {negocio.telefone ? ` · ${negocio.telefone}` : ""}
        {negocio.etapa ? ` · ${negocio.funil ? `${negocio.funil} / ` : ""}${negocio.etapa}` : ""}
        {negocio.status && negocio.status !== "OPEN" ? ` · ${negocio.status}` : ""}
      </p>
      {candidato ? (
        <>
          <p>
            Cadastro: {[candidato.nome, candidato.idade != null && candidato.idade !== "" ? `${candidato.idade} anos` : null, candidato.escolaridade, candidato.turno ? `turno ${candidato.turno}` : null].filter(Boolean).join(" · ") || "sem dados cadastrais"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Indicador ativo={Boolean(candidato.resumo_cv)}>Resumo do CV</Indicador>
            <Indicador ativo={Boolean(candidato["teste comportamental"])}>Teste comportamental</Indicador>
            <Indicador ativo={Boolean(candidato.info_conducoes)}>Deslocamento</Indicador>
            <Indicador ativo={Boolean(candidato.resumo_entrevista)}>Entrevista</Indicador>
          </div>
        </>
      ) : (
        <p className="text-amber-800">Sem registro em candidatos_dados para este negócio. O dossiê usa só o currículo enviado e os campos abaixo.</p>
      )}
    </div>
  );
}

export function DossiePage() {
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [telefone, setTelefone] = useState("");
  const [busca, setBusca] = useState<Busca | null>(null);
  const [dealId, setDealId] = useState("");
  const [filtroVaga, setFiltroVaga] = useState("");
  const [vagaId, setVagaId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [colado, setColado] = useState("");
  const [manual, setManual] = useState<Manual>(MANUAL_VAZIO);
  const [erro, setErro] = useState("");
  const [dossie, setDossie] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [notaSalva, setNotaSalva] = useState(false);

  const status = useQuery({
    queryKey: ["dossie-status"],
    queryFn: () => api<{ configurada: boolean; modelo: string }>("/api/v1/triagem/dossie/status"),
    staleTime: 60_000,
  });
  const vagas = useQuery({
    queryKey: ["dossie-vagas"],
    queryFn: () => api<Vaga[]>("/api/v1/triagem/dossie/vagas"),
    staleTime: 60_000,
  });

  const listaVagas = vagas.data?.data ?? [];
  const vagasFiltradas = useMemo(() => {
    const termo = semAcento(filtroVaga.trim());
    if (!termo) return listaVagas;
    return listaVagas.filter((vaga) => semAcento(`${vaga.cargo} ${vaga.empresa} ${vaga.local} ${vaga.tipo}`).includes(termo) || vaga.id === vagaId);
  }, [listaVagas, filtroVaga, vagaId]);
  const vagaEscolhida = listaVagas.find((vaga) => vaga.id === vagaId) ?? null;

  const buscaCrm = useMutation({
    mutationFn: (params: { telefone: string; dealId?: string }) => {
      const query = new URLSearchParams({ telefone: params.telefone, ...(params.dealId ? { dealId: params.dealId } : {}) });
      return api<Busca>(`/api/v1/triagem/dossie/candidato?${query.toString()}`);
    },
    onSuccess: (resposta) => {
      setBusca(resposta.data);
      setDealId(resposta.data.negocio?.id ?? "");
      // Vaga do campo id_vaga_escolhida do negócio já vem marcada; o operador pode trocar.
      if (resposta.data.vagaEscolhidaId) {
        setVagaId(resposta.data.vagaEscolhidaId);
        setFiltroVaga("");
      }
      setManual(MANUAL_VAZIO);
      setDossie("");
      setNotaSalva(false);
    },
    onError: (error) => setErro(error.message),
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        vagaId,
        ...(dealId ? { dealId, telefone: telefone.replace(/\D/g, "") } : {}),
        manual: Object.fromEntries(Object.entries(manual).filter(([, valor]) => valor.trim())),
      };
      if (arquivo) body.arquivo = { nome: arquivo.name, base64: await lerBase64(arquivo) };
      else if (colado.trim()) body.texto = colado.trim();
      return api<Resultado>("/api/v1/triagem/dossie", { method: "POST", body: JSON.stringify(body) });
    },
    onMutate: () => {
      setErro("");
      setNotaSalva(false);
    },
    onSuccess: (resposta) => setDossie(resposta.data.dossie),
    onError: (error) => setErro(error.message),
  });

  const nota = useMutation({
    mutationFn: () => api<{ salvo: boolean }>("/api/v1/triagem/dossie/nota", { method: "POST", body: JSON.stringify({ dealId, conteudo: dossie }) }),
    onSuccess: () => setNotaSalva(true),
    onError: (error) => setErro(error.message),
  });

  function buscarNegocio(event: FormEvent) {
    event.preventDefault();
    const digitos = telefone.replace(/\D/g, "");
    if (digitos.length < 10) return setErro("Informe o telefone com DDD.");
    setErro("");
    buscaCrm.mutate({ telefone: digitos });
  }

  function trocarNegocio(id: string) {
    setDealId(id);
    if (id) buscaCrm.mutate({ telefone: telefone.replace(/\D/g, ""), dealId: id });
  }

  function limparNegocio() {
    setBusca(null);
    setDealId("");
    setManual(MANUAL_VAZIO);
  }

  function escolherArquivo(event: ChangeEvent<HTMLInputElement>) {
    const escolhido = event.target.files?.[0];
    event.target.value = "";
    if (!escolhido) return;
    if (escolhido.size > TAMANHO_MAXIMO) return setErro("O currículo passa de 5 MB. Envie um arquivo menor.");
    if (/\.doc$/i.test(escolhido.name)) return setErro("Arquivo .doc antigo não é suportado. Salve como PDF ou DOCX.");
    setErro("");
    setArquivo(escolhido);
    setColado("");
  }

  async function copiar() {
    if (!dossie) return;
    await navigator.clipboard.writeText(dossie);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const candidato = busca?.candidato ?? null;
  const temCurriculo = Boolean(arquivo || colado.trim().length >= 30 || candidato?.resumo_cv);
  const temNome = Boolean(manual.nome.trim() || candidato?.nome);
  const iaPronta = status.data?.data.configurada ?? true;
  const podeGerar = Boolean(vagaId) && temCurriculo && temNome && iaPronta && !gerar.isPending;
  const faltando = [!vagaId && "a vaga", !temCurriculo && "o currículo", !temNome && "o nome do candidato"].filter(Boolean).join(", ");

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">Gerador de dossiês</h1>
        <p className="text-sm text-slate-500">Busque o candidato no CRM pelo telefone, escolha a vaga, envie o currículo e gere o dossiê para a empresa.</p>
      </div>

      {status.data && !status.data.data.configurada ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">A geração de dossiê está indisponível: falta configurar a OPENAI_API_KEY no servidor.</p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
        <Card>
          <div className="grid gap-6">
            <Passo numero={1} titulo="Candidato no CRM" texto="Traz o negócio do CRM e os dados já gravados do candidato (teste comportamental, deslocamento, entrevista). Opcional.">
              <form onSubmit={buscarNegocio} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Telefone">
                    <Input inputMode="tel" autoComplete="off" placeholder="(11) 99999-9999" value={telefone} onChange={(event) => setTelefone(mascaraTelefone(event.target.value))} />
                  </Field>
                </div>
                <Button type="submit" variant="ghost" className="h-10" disabled={buscaCrm.isPending}>
                  {buscaCrm.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar no CRM
                </Button>
              </form>
              {busca ? (
                busca.negocios.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum negócio com esse telefone no CRM. Você ainda pode gerar o dossiê com o currículo e os campos abaixo.</p>
                ) : (
                  <>
                    {busca.negocios.length > 1 ? (
                      <Field label={`${busca.negocios.length} negócios com esse telefone`}>
                        <Select value={dealId} onChange={(event) => trocarNegocio(event.target.value)}>
                          {busca.negocios.map((negocio) => (
                            <option key={negocio.id} value={negocio.id}>
                              {[negocio.titulo, negocio.etapa, negocio.status === "OPEN" ? "aberto" : negocio.status?.toLowerCase()].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    {busca.negocio ? <ResumoCandidato negocio={busca.negocio} candidato={candidato} /> : null}
                    <button type="button" className="flex w-fit items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600" onClick={limparNegocio}>
                      <X size={13} /> Não usar o CRM
                    </button>
                  </>
                )
              ) : null}
            </Passo>

            <Passo numero={2} titulo="Vaga escolhida" texto="Vagas abertas no sistema. Vaga de estágio usa o modelo de dossiê de estágio; as demais, o de CLT.">
              <Input placeholder="Filtrar por cargo, empresa ou bairro" value={filtroVaga} onChange={(event) => setFiltroVaga(event.target.value)} />
              <Select value={vagaId} onChange={(event) => setVagaId(event.target.value)} disabled={vagas.isLoading}>
                <option value="">{vagas.isLoading ? "Carregando vagas…" : `Selecione (${vagasFiltradas.length} ${vagasFiltradas.length === 1 ? "vaga" : "vagas"})`}</option>
                {vagasFiltradas.map((vaga) => (
                  <option key={vaga.id} value={vaga.id}>
                    {vaga.cargo} · {vaga.empresa || "Empresa sem nome"} · {vaga.tipo}{vaga.local ? ` · ${vaga.local}` : ""}
                  </option>
                ))}
              </Select>
              {vagas.isError ? <p className="text-sm text-rose-600">{vagas.error.message}</p> : null}
              {busca?.idVagaCrm && !busca.vagaEscolhidaId ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">A vaga escolhida no CRM ({busca.idVagaCrm}) não está entre as vagas abertas. Escolha a vaga na lista.</p>
              ) : null}
              {vagaEscolhida && busca?.vagaEscolhidaId === vagaEscolhida.id ? <p className="text-xs font-medium text-emerald-700">Vaga escolhida no CRM (id_vaga_escolhida).</p> : null}
              {vagaEscolhida ? <p className="text-xs text-slate-500">Dossiê de {vagaEscolhida.tipo === "Estágio" ? "estágio" : "CLT"} para {vagaEscolhida.cargo}{vagaEscolhida.empresa ? ` na ${vagaEscolhida.empresa}` : ""}.</p> : null}
            </Passo>

            <Passo numero={3} titulo="Currículo do candidato" texto="PDF, DOCX, PNG, JPG ou WEBP até 5 MB, ou cole o texto. Substitui o resumo do CV gravado no CRM.">
              <div className="flex flex-wrap items-center gap-2">
                <input ref={arquivoRef} type="file" accept={ACEITOS} className="hidden" onChange={escolherArquivo} />
                <Button type="button" variant="ghost" onClick={() => arquivoRef.current?.click()}>
                  <Upload size={16} /> {arquivo ? "Trocar arquivo" : "Enviar currículo"}
                </Button>
                {arquivo ? (
                  <span className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
                    <FileText size={13} /> {arquivo.name}
                    <button type="button" aria-label="Remover arquivo" className="text-slate-400 hover:text-rose-600" onClick={() => setArquivo(null)}><X size={13} /></button>
                  </span>
                ) : candidato?.resumo_cv ? <span className="text-xs text-emerald-700">Sem arquivo, usa o resumo do CV gravado no CRM.</span> : null}
              </div>
              {!arquivo ? (
                <Textarea rows={4} placeholder="Ou cole aqui o texto do currículo" value={colado} onChange={(event) => setColado(event.target.value)} />
              ) : null}
            </Passo>

            <Passo numero={4} titulo="Conferir dados" texto="Vazio = usa o que veio do CRM. Preencha para corrigir ou quando o candidato não estiver no CRM.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome completo">
                  <Input placeholder={candidato?.nome ?? ""} value={manual.nome} onChange={(event) => setManual({ ...manual, nome: event.target.value })} />
                </Field>
                <Field label="Idade">
                  <Input inputMode="numeric" placeholder={candidato?.idade != null ? String(candidato.idade) : ""} value={manual.idade} onChange={(event) => setManual({ ...manual, idade: event.target.value.replace(/\D/g, "").slice(0, 3) })} />
                </Field>
                <Field label="Escolaridade">
                  <Input placeholder={candidato?.escolaridade ?? "Ex.: Ensino médio completo"} value={manual.escolaridade} onChange={(event) => setManual({ ...manual, escolaridade: event.target.value })} />
                </Field>
                <Field label={vagaEscolhida?.tipo === "Estágio" ? "Turno em que estuda" : "Turno pretendido"}>
                  <Input placeholder={candidato?.turno ?? "Ex.: manhã"} value={manual.turno} onChange={(event) => setManual({ ...manual, turno: event.target.value })} />
                </Field>
                <Field label="Bairro e cidade">
                  <Input placeholder="Ex.: Mooca, São Paulo" value={manual.bairroCidade} onChange={(event) => setManual({ ...manual, bairroCidade: event.target.value })} />
                </Field>
              </div>
            </Passo>

            <div className="grid gap-2 border-t border-slate-200 pt-4">
              <Button type="button" disabled={!podeGerar} onClick={() => gerar.mutate()} className="w-full sm:w-fit">
                {gerar.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {gerar.isPending ? "Gerando dossiê…" : "Gerar dossiê"}
              </Button>
              {faltando && !gerar.isPending ? <p className="text-xs text-slate-500">Falta {faltando}.</p> : null}
              {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
            </div>
          </div>
        </Card>

        <Card className="xl:sticky xl:top-0">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-navy-900">Dossiê</p>
              {gerar.data && dossie ? (
                <p className="text-xs text-slate-500">
                  {gerar.data.data.tipo} · {gerar.data.data.curriculo === "enviado" ? "currículo enviado" : "resumo do CV do CRM"} · {gerar.data.data.modelo}
                </p>
              ) : null}
            </div>
            {gerar.isPending ? (
              <p className="flex items-center gap-2 py-16 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> A IA está escrevendo o dossiê. Pode levar até um minuto.</p>
            ) : dossie ? (
              <>
                <Textarea rows={18} value={dossie} onChange={(event) => { setDossie(event.target.value); setNotaSalva(false); }} />
                <p className="text-xs text-slate-500">Revise e ajuste o texto antes de enviar para a empresa.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => void copiar()}>
                    {copiado ? <Check size={16} /> : <ClipboardCopy size={16} />} {copiado ? "Copiado" : "Copiar"}
                  </Button>
                  {dealId ? (
                    <Button type="button" variant="ghost" disabled={nota.isPending || notaSalva || !dossie.trim()} onClick={() => nota.mutate()}>
                      {nota.isPending ? <Loader2 size={16} className="animate-spin" /> : notaSalva ? <Check size={16} /> : <Save size={16} />}
                      {notaSalva ? "Nota salva no CRM" : "Salvar como nota no CRM"}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="grid place-items-center gap-2 py-16 text-center text-sm text-slate-500">
                <Phone size={20} className="text-slate-400" />
                <p>O dossiê aparece aqui depois de gerado.</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
