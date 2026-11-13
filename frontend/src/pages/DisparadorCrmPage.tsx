import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, FileSpreadsheet, Loader2, Search, Send, Upload, UserPlus, X } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Alerta, CabecalhoPagina, FiltroChips } from "@/components/pagina";
import { Badge, Button, Card, Field, Input, Select, Skeleton, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

export const DISPARADOR_INFOJOBS_URL = "https://dnaworkia-disparador-infojobs.vkfaze.easypanel.host/";

type Fase = { id: string; nome: string; ganho: boolean; perdido: boolean };
type Funil = { id: string; nome: string; padrao: boolean; fases: Fase[] };
type Campo = { id: string; nome: string; rotulo: string; tipo: string };
type Config = { funis: Funil[]; campos: Campo[]; disparo: { canalConfigurado: boolean; templates: string[] } };
type Deal = { id: string; titulo: string; status: string; etapa: string; etapaId: string; funil: string; funilId: string };
type Verificado = { telefone: string; normalizado: string | null; valido: boolean; existe: boolean; contato: { id: string; nome: string } | null; deals: Deal[] };
type ResultadoCriar = { telefone: string; status: "criado" | "movido" | "ja_estava" | "erro"; contatoId: string | null; dealId: string | null; motivo: string | null };
type Planilha = { colunas: string[]; linhas: string[][] };

/** Uma linha a conferir: telefone e, quando vem da planilha, nome e valores dos campos personalizados. */
type Linha = { telefone: string; nome: string; campos: Array<{ fieldId: string; value: string }> };

const USO_IGNORAR = "";
const USO_TELEFONE = "__telefone";
const USO_NOME = "__nome";

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).replace(/^data:[^,]*,/, ""));
    leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

function semAcento(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Sugere o uso de cada coluna pelo título: telefone, nome ou o campo personalizado de mesmo nome. */
function sugerirUso(coluna: string, campos: Campo[]) {
  const chave = semAcento(coluna);
  if (/^(telefone|celular|whats|whatsapp|fone|phone|numero|contato)/.test(chave)) return USO_TELEFONE;
  if (/^(nome|nome_completo|name|candidato)$/.test(chave)) return USO_NOME;
  const campo = campos.find((item) => semAcento(item.nome) === chave || semAcento(item.rotulo) === chave);
  return campo?.id ?? USO_IGNORAR;
}

function telefoneBonito(normalizado: string | null, bruto: string) {
  if (!normalizado) return bruto;
  const d = normalizado.slice(2);
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : normalizado;
}

const ROTULO_RESULTADO: Record<ResultadoCriar["status"], string> = { criado: "Criado", movido: "Movido para a fase", ja_estava: "Já tinha deal", erro: "Erro" };
const TOM_RESULTADO: Record<ResultadoCriar["status"], string> = { criado: "ativa", movido: "aberta", ja_estava: "pausada", erro: "recusado" };

function Passo({ numero, titulo, texto, children, acoes }: { numero: number; titulo: string; texto: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgb(15_23_42/0.06)] md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-700 text-sm font-bold text-white">{numero}</span>
          <div>
            <h2 className="text-base font-bold text-navy-900">{titulo}</h2>
            <p className="text-sm text-slate-500">{texto}</p>
          </div>
        </div>
        {acoes}
      </header>
      {children}
    </section>
  );
}

export function DisparadorCrmPage() {
  const config = useQuery({ queryKey: ["disparo-crm-config"], queryFn: () => api<Config>("/api/v1/disparo-crm/config"), staleTime: 5 * 60_000 });
  const cfg = config.data?.data;
  const [modo, setModo] = useState<"colar" | "planilha">("colar");
  const [colados, setColados] = useState("");
  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [usos, setUsos] = useState<string[]>([]);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [verificados, setVerificados] = useState<Verificado[] | null>(null);
  const [filtro, setFiltro] = useState<"" | "crm" | "novo" | "invalido">("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [funilId, setFunilId] = useState("");
  const [faseId, setFaseId] = useState("");
  const [mover, setMover] = useState(true);
  const [resultados, setResultados] = useState<Record<string, ResultadoCriar>>({});
  const [template, setTemplate] = useState("");
  const [idioma, setIdioma] = useState("pt_BR");
  const [aviso, setAviso] = useState<{ tom: "info" | "erro"; texto: string } | null>(null);

  const funil = cfg?.funis.find((item) => item.id === (funilId || cfg.funis.find((f) => f.padrao)?.id || cfg.funis[0]?.id));
  const fase = funil?.fases.find((item) => item.id === faseId);

  const lerArquivo = useMutation({
    mutationFn: async (arquivo: File) => api<Planilha>("/api/v1/disparo-crm/planilha", { method: "POST", body: JSON.stringify({ arquivo: { nome: arquivo.name, base64: await lerBase64(arquivo) } }) }),
    onSuccess: (resposta, arquivo) => {
      setPlanilha(resposta.data);
      setNomeArquivo(arquivo.name);
      setUsos(resposta.data.colunas.map((coluna) => sugerirUso(coluna, cfg?.campos ?? [])));
      setAviso(null);
    },
    onError: (error) => setAviso({ tom: "erro", texto: error.message }),
  });

  const verificar = useMutation({
    mutationFn: (lista: Linha[]) => api<Verificado[]>("/api/v1/disparo-crm/verificar", { method: "POST", body: JSON.stringify({ telefones: lista.map((linha) => linha.telefone).join("\n") }) }),
    onSuccess: (resposta) => {
      setVerificados(resposta.data);
      setResultados({});
      setFiltro("");
      setMarcados(resposta.data.filter((item) => item.valido).map((item) => item.telefone));
      setAviso(null);
    },
    onError: (error) => setAviso({ tom: "erro", texto: error.message }),
  });

  /** Monta as linhas a partir do texto colado ou da planilha mapeada e confere no CRM. */
  function conferir() {
    setAviso(null);
    let lista: Linha[] = [];
    if (modo === "colar") {
      lista = colados.split(/[\n\r,;\t]+/).map((tel) => tel.trim()).filter(Boolean).map((telefone) => ({ telefone, nome: "", campos: [] }));
    } else if (planilha) {
      const colTel = usos.indexOf(USO_TELEFONE);
      if (colTel < 0) return setAviso({ tom: "erro", texto: "Escolha qual coluna da planilha tem o telefone." });
      const colNome = usos.indexOf(USO_NOME);
      lista = planilha.linhas.filter((linha) => (linha[colTel] ?? "").trim()).map((linha) => ({
        telefone: linha[colTel].trim(),
        nome: colNome >= 0 ? (linha[colNome] ?? "").trim() : "",
        campos: usos.flatMap((uso, i) => (uso && uso !== USO_TELEFONE && uso !== USO_NOME && (linha[i] ?? "").trim() ? [{ fieldId: uso, value: linha[i].trim() }] : [])),
      }));
    }
    if (!lista.length) return setAviso({ tom: "erro", texto: modo === "colar" ? "Cole ao menos um telefone com DDD." : "A coluna de telefone está vazia." });
    if (lista.length > 300) return setAviso({ tom: "erro", texto: `São ${lista.length} telefones; confira até 300 por vez.` });
    setLinhas(lista);
    verificar.mutate(lista);
  }

  const porTelefone = useMemo(() => new Map(linhas.map((linha) => [linha.telefone, linha])), [linhas]);
  const visiveis = (verificados ?? []).filter((item) => (filtro === "crm" ? item.existe : filtro === "novo" ? item.valido && !item.existe : filtro === "invalido" ? !item.valido : true));
  const contagem = { crm: (verificados ?? []).filter((i) => i.existe).length, novo: (verificados ?? []).filter((i) => i.valido && !i.existe).length, invalido: (verificados ?? []).filter((i) => !i.valido).length };
  const selecionados = (verificados ?? []).filter((item) => marcados.includes(item.telefone) && item.valido);
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.filter((i) => i.valido).every((item) => marcados.includes(item.telefone));
  // Contatos que podem receber o template: já estavam no CRM ou acabaram de ser criados.
  const contatosParaDisparo = [...new Set(selecionados.map((item) => resultados[item.telefone]?.contatoId ?? item.contato?.id ?? null).filter((id): id is string => Boolean(id)))];

  const criar = useMutation({
    mutationFn: () => api<ResultadoCriar[]>("/api/v1/disparo-crm/criar", {
      method: "POST",
      body: JSON.stringify({ stageId: faseId, moverExistentes: mover, itens: selecionados.map((item) => ({ telefone: item.telefone, nome: porTelefone.get(item.telefone)?.nome || item.contato?.nome || undefined, campos: porTelefone.get(item.telefone)?.campos ?? [] })) }),
    }),
    onSuccess: (resposta) => {
      setResultados((atual) => ({ ...atual, ...Object.fromEntries(resposta.data.map((item) => [item.telefone, item])) }));
      const n = (s: ResultadoCriar["status"]) => resposta.data.filter((item) => item.status === s).length;
      setAviso({ tom: n("erro") ? "erro" : "info", texto: `${n("criado")} criado(s), ${n("movido")} movido(s) para "${fase?.nome}", ${n("ja_estava")} já tinham deal aberto${n("erro") ? `, ${n("erro")} com erro (veja na tabela)` : ""}.` });
    },
    onError: (error) => setAviso({ tom: "erro", texto: error.message }),
  });

  const disparar = useMutation({
    mutationFn: () => api<{ campanhaId: string; etiqueta: string; contatos: number; semEtiqueta: number; canal: string }>("/api/v1/disparo-crm/disparar", {
      method: "POST",
      body: JSON.stringify({ contatoIds: contatosParaDisparo, template: template.trim(), idioma: idioma.trim() || "pt_BR", nome: `Disparo ${template.trim()} — ${new Date().toLocaleDateString("pt-BR")}` }),
    }),
    onSuccess: (resposta) => setAviso({ tom: "info", texto: `Disparo lançado no CRM para ${resposta.data.contatos} contato(s) (etiqueta ${resposta.data.etiqueta}). Acompanhe em Campanhas no Bwipo.${resposta.data.semEtiqueta ? ` ${resposta.data.semEtiqueta} não puderam ser marcados e ficaram de fora.` : ""}` }),
    onError: (error) => setAviso({ tom: "erro", texto: error instanceof ApiError ? error.message : "Não foi possível disparar." }),
  });

  function alternar(telefone: string) {
    setMarcados((atual) => (atual.includes(telefone) ? atual.filter((t) => t !== telefone) : [...atual, telefone]));
  }

  function escolherArquivo(event: ChangeEvent<HTMLInputElement>) {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (arquivo) lerArquivo.mutate(arquivo);
  }

  const ocupado = verificar.isPending || criar.isPending || disparar.isPending;

  return (
    <div className="grid gap-5">
      <CabecalhoPagina
        titulo="Disparador pelo CRM"
        descricao="Confira telefones no Bwipo, crie ou mova os deals na fase escolhida (com os campos da planilha) e dispare o template de WhatsApp para os selecionados."
        acoes={<a href={DISPARADOR_INFOJOBS_URL} target="_blank" rel="noreferrer"><Button type="button" variant="secondary"><ExternalLink size={16} /> Abrir disparador Infojobs</Button></a>}
      />
      {config.isError ? <Alerta>{config.error instanceof ApiError ? config.error.message : "Não foi possível ler o CRM."}</Alerta> : null}
      {aviso ? <Alerta tom={aviso.tom}>{aviso.texto}</Alerta> : null}

      <Passo numero={1} titulo="Telefones" texto="Cole os números ou importe uma planilha (.xlsx ou .csv). Até 300 por vez.">
        <FiltroChips rotulo="Origem dos telefones" valor={modo} onChange={setModo} opcoes={[{ id: "colar", rotulo: "Colar telefones" }, { id: "planilha", rotulo: "Importar planilha" }]} />
        {modo === "colar" ? (
          <Field label="Telefones com DDD (um por linha, ou separados por vírgula)">
            <Textarea rows={6} placeholder={"(11) 97035-0419\n41984941906\n+55 21 99999-0000"} value={colados} onChange={(event) => setColados(event.target.value)} />
          </Field>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={arquivoRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={escolherArquivo} />
              <Button type="button" variant="secondary" disabled={lerArquivo.isPending || config.isLoading} onClick={() => arquivoRef.current?.click()}>
                {lerArquivo.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {planilha ? "Trocar planilha" : "Escolher planilha"}
              </Button>
              {planilha ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                  <FileSpreadsheet size={15} className="text-emerald-700" /> {nomeArquivo}: {planilha.linhas.length} linhas
                  <button type="button" aria-label="Remover planilha" className="text-slate-400 hover:text-rose-600" onClick={() => { setPlanilha(null); setUsos([]); }}><X size={14} /></button>
                </span>
              ) : <span className="text-xs text-slate-500">A primeira linha precisa ter os títulos das colunas.</span>}
            </div>
            {planilha ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="data-table compact">
                  <thead><tr><th>Coluna da planilha</th><th>Exemplos</th><th className="w-72">Usar como</th></tr></thead>
                  <tbody>
                    {planilha.colunas.map((coluna, i) => (
                      <tr key={`${coluna}-${i}`}>
                        <td className="font-semibold text-navy-900">{coluna}</td>
                        <td className="max-w-80 truncate text-xs text-slate-500">{planilha.linhas.slice(0, 3).map((linha) => linha[i]).filter(Boolean).join(" · ") || "vazia"}</td>
                        <td>
                          <Select aria-label={`Uso da coluna ${coluna}`} value={usos[i] ?? ""} onChange={(event) => setUsos((atual) => atual.map((uso, j) => (j === i ? event.target.value : uso === event.target.value && event.target.value ? USO_IGNORAR : uso)))}>
                            <option value={USO_IGNORAR}>Ignorar</option>
                            <option value={USO_TELEFONE}>Telefone</option>
                            <option value={USO_NOME}>Nome do contato</option>
                            <optgroup label="Campo personalizado do deal">
                              {(cfg?.campos ?? []).map((campo) => <option key={campo.id} value={campo.id}>{campo.rotulo}</option>)}
                            </optgroup>
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}
        <div className="flex justify-end">
          <Button type="button" disabled={ocupado || (modo === "planilha" && !planilha)} onClick={conferir}>
            {verificar.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} {verificar.isPending ? "Conferindo no CRM…" : "Conferir no CRM"}
          </Button>
        </div>
      </Passo>

      {verificar.isPending ? <Skeleton className="h-48" /> : verificados ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <Passo
            numero={2}
            titulo="Quem já está no CRM"
            texto="Marque quem vai receber. Novos são criados no passo 3; quem já tem deal aberto no funil pode ser movido para a fase."
            acoes={<FiltroChips rotulo="Filtrar resultado" valor={filtro} onChange={setFiltro} opcoes={[{ id: "", rotulo: "Todos", contagem: verificados.length }, { id: "crm", rotulo: "No CRM", contagem: contagem.crm }, { id: "novo", rotulo: "Novos", contagem: contagem.novo }, { id: "invalido", rotulo: "Inválidos", contagem: contagem.invalido }]} />}
          >
            <div className="overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th className="w-px"><input type="checkbox" aria-label="Marcar todos" className="h-4 w-4 accent-cyan-700" checked={todosVisiveisMarcados} onChange={() => setMarcados((atual) => (todosVisiveisMarcados ? atual.filter((t) => !visiveis.some((v) => v.telefone === t)) : [...new Set([...atual, ...visiveis.filter((v) => v.valido).map((v) => v.telefone)])]))} /></th>
                    <th>Telefone</th>
                    <th>Contato</th>
                    <th>No CRM</th>
                    <th>Deals</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((item) => {
                    const linha = porTelefone.get(item.telefone);
                    const resultado = resultados[item.telefone];
                    const abertos = item.deals.filter((deal) => deal.status === "OPEN");
                    return (
                      <tr key={item.telefone} className={marcados.includes(item.telefone) ? "bg-cyan-50" : undefined}>
                        <td>{item.valido ? <input type="checkbox" aria-label={`Marcar ${item.telefone}`} className="h-4 w-4 accent-cyan-700" checked={marcados.includes(item.telefone)} onChange={() => alternar(item.telefone)} /> : null}</td>
                        <td className="whitespace-nowrap tabular-nums">{telefoneBonito(item.normalizado, item.telefone)}</td>
                        <td>
                          <p className="font-semibold text-navy-900">{item.contato?.nome || linha?.nome || "—"}</p>
                          {linha?.campos.length ? <p className="text-xs text-slate-500">{linha.campos.length} campo(s) da planilha</p> : null}
                        </td>
                        <td>{!item.valido ? <Badge value="recusado">Inválido</Badge> : item.existe ? <Badge value="ativa">No CRM</Badge> : <Badge value="aberta">Novo</Badge>}</td>
                        <td className="text-xs text-slate-600">
                          {abertos.length ? abertos.map((deal) => <p key={deal.id}><span className="font-semibold text-slate-700">{deal.etapa}</span> · {deal.funil}</p>) : item.deals.length ? <span className="text-slate-500">{item.deals.length} fechado(s)</span> : <span className="text-slate-400">Sem deal</span>}
                        </td>
                        <td className="text-xs">
                          {resultado ? (
                            <span className="grid gap-0.5"><Badge value={TOM_RESULTADO[resultado.status]}>{ROTULO_RESULTADO[resultado.status]}</Badge>{resultado.motivo ? <span className="text-slate-500">{resultado.motivo}</span> : null}</span>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Passo>

          <aside className="grid gap-4 xl:sticky xl:top-0">
            <Passo numero={3} titulo="Criar e ativar" texto={`${selecionados.length} telefone(s) marcado(s).`}>
              <Field label="Funil">
                <Select value={funil?.id ?? ""} onChange={(event) => { setFunilId(event.target.value); setFaseId(""); }} disabled={!cfg}>
                  {(cfg?.funis ?? []).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                </Select>
              </Field>
              <Field label="Fase de criação">
                <Select value={faseId} onChange={(event) => setFaseId(event.target.value)} disabled={!funil}>
                  <option value="">Escolha a fase</option>
                  {(funil?.fases ?? []).filter((item) => !item.ganho && !item.perdido).map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                </Select>
              </Field>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-cyan-700" checked={mover} onChange={(event) => setMover(event.target.checked)} />
                <span>Quem já tem deal aberto neste funil vai para esta fase (sem criar outro)</span>
              </label>
              <Button type="button" className="w-full" disabled={ocupado || !faseId || !selecionados.length} onClick={() => criar.mutate()}>
                {criar.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} {criar.isPending ? "Criando no CRM…" : `Criar/mover ${selecionados.length} no CRM`}
              </Button>

              <div className="grid gap-3 border-t border-slate-200 pt-4">
                <p className="text-sm font-bold text-navy-900">Disparar template de WhatsApp</p>
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                  <Field label="Template aprovado">
                    <Input list="templates-disparo" placeholder="nome_do_template" value={template} onChange={(event) => setTemplate(event.target.value.trim())} />
                  </Field>
                  <Field label="Idioma"><Input value={idioma} onChange={(event) => setIdioma(event.target.value)} /></Field>
                </div>
                <datalist id="templates-disparo">{(cfg?.disparo.templates ?? []).map((nome) => <option key={nome} value={nome} />)}</datalist>
                <p className="text-xs text-slate-500">
                  {cfg?.disparo.canalConfigurado ? "Sai pelo canal de WhatsApp configurado para disparos." : "Sem canal configurado: sai pelo canal da última conversa de cada contato (contato sem conversa não recebe)."}
                  {" "}Vai para {contatosParaDisparo.length} contato(s) já no CRM entre os marcados; crie os novos antes.
                </p>
                <Button type="button" variant="secondary" className="w-full" disabled={ocupado || !template || !contatosParaDisparo.length} onClick={() => {
                  if (window.confirm(`Disparar o template "${template}" para ${contatosParaDisparo.length} contato(s) pelo CRM?`)) disparar.mutate();
                }}>
                  {disparar.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {disparar.isPending ? "Disparando…" : `Disparar para ${contatosParaDisparo.length}`}
                </Button>
                {disparar.isSuccess ? <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><Check size={14} /> Campanha lançada no CRM.</p> : null}
              </div>
            </Passo>
          </aside>
        </div>
      ) : (
        <Card className={cn("text-sm text-slate-500")}>Depois de conferir, aparece aqui quem já está no CRM, com os deals e as fases, e as opções de criar e disparar.</Card>
      )}
    </div>
  );
}
