import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileSignature, Search, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Field, Input, Textarea, cn } from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Empresa = {
  id: string;
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  endereco: string;
  cep: string;
  cidade: string;
  estado: string;
  email: string;
  representante: string;
};

type Escola = { id: string; rotulo: string; campos: Record<string, string> };
type CandidatoBusca = { id: string; nome: string; cpf: string; empresa: string };
type Preenchimento = {
  campos: Record<string, string>;
  concedente: { razao_social: string; nome_fantasia?: string; cnpj: string; endereco: string; cep: string; cidade: string; estado: string; email: string; representante: string } | null;
  empresaId: string;
  escolaId: string;
  idContratacao: number | null;
  terminoEstudo: string;
};

const APOLICE = "Apólice Coletiva nº 09820055561928 da Porto Seguro";
/** Valores iguais em todo TCE: aparecem só para leitura e o backend também grava sempre estes. */
const FIXOS: Record<string, string> = {
  seguro_apolice: APOLICE,
  carga_horaria_diaria: "6 horas",
  carga_horaria_semanal: "30 horas",
};
const AVISO_FIXO: Record<string, string> = {
  seguro_apolice: "Fixa para todos os termos.",
  carga_horaria_diaria: "Padrão de todo estágio.",
  carga_horaria_semanal: "Padrão de todo estágio.",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Termos antigos guardam "Cidade, 12 de novembro de 2026": na tela fica só a cidade (o backend põe a data do dia). */
function cidadeDaEmissao(valor: string | undefined) {
  return (valor ?? "")
    .replace(/[\s,–-]*\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\.?\s*$/i, "")
    .replace(/[\s,–-]*\d{1,2}\/\d{1,2}\/\d{2,4}\.?\s*$/, "");
}

function hojePorExtenso() {
  const hoje = new Date();
  return `${hoje.getDate()} de ${MESES[hoje.getMonth()]} de ${hoje.getFullYear()}`;
}

type VagaEstagio = { id: string; cargo: string; empresa: string; empresaId: string; local: string; campos: Record<string, string> };

const CAMPOS: Array<{ key: string; label: string; section: string; full?: boolean; multiline?: boolean; placeholder?: string; date?: boolean }> = [
  { key: "nome", label: "Nome completo", section: "candidato" },
  { key: "data_nascimento", label: "Data de nascimento", section: "candidato", date: true },
  { key: "cpf", label: "CPF", section: "candidato" },
  { key: "rg", label: "RG", section: "candidato" },
  { key: "email", label: "E-mail", section: "candidato" },
  { key: "telefone", label: "Telefone", section: "candidato" },
  { key: "endereco", label: "Endereço", section: "candidato", full: true },
  { key: "cep", label: "CEP", section: "candidato" },
  { key: "cidade", label: "Cidade", section: "candidato" },
  { key: "estado", label: "Estado", section: "candidato", placeholder: "UF" },
  { key: "curso", label: "Curso", section: "candidato" },
  { key: "periodo", label: "Período", section: "candidato" },
  { key: "ano", label: "Ano", section: "candidato" },
  { key: "turno", label: "Turno", section: "candidato" },
  { key: "tipo_estagio", label: "Tipo de estágio", section: "candidato", placeholder: "Obrigatório ou não obrigatório" },
  { key: "nome_responsavel", label: "Nome", section: "responsavel" },
  { key: "nascimento_responsavel", label: "Data de nascimento", section: "responsavel", date: true },
  { key: "cpf_responsavel", label: "CPF", section: "responsavel" },
  { key: "rg_responsavel", label: "RG", section: "responsavel" },
  { key: "email_responsavel", label: "E-mail", section: "responsavel" },
  { key: "telefone_responsavel", label: "Telefone", section: "responsavel" },
  { key: "endereco_responsavel", label: "Endereço", section: "responsavel", full: true },
  { key: "cep_responsavel", label: "CEP", section: "responsavel" },
  { key: "cidade_responsavel", label: "Cidade", section: "responsavel" },
  { key: "estado_responsavel", label: "Estado", section: "responsavel", placeholder: "UF" },
  { key: "nome_escola", label: "Nome", section: "escola", full: true },
  { key: "escola_cnpj_inep", label: "CNPJ / INEP", section: "escola" },
  { key: "escola_representante", label: "Representante", section: "escola" },
  { key: "escola_email", label: "E-mail", section: "escola", full: true },
  { key: "escola_endereco", label: "Endereço", section: "escola", full: true },
  { key: "escola_cep", label: "CEP", section: "escola" },
  { key: "escola_cidade", label: "Cidade", section: "escola" },
  { key: "escola_estado", label: "Estado", section: "escola", placeholder: "UF" },
  { key: "emissao_cidade_data", label: "Cidade de emissão", section: "estagio", full: true },
  { key: "estagio_inicio", label: "Início", section: "estagio", date: true },
  { key: "estagio_termino", label: "Término", section: "estagio", date: true },
  { key: "carga_horaria_diaria", label: "Carga horária diária", section: "estagio" },
  { key: "carga_horaria_semanal", label: "Carga horária semanal", section: "estagio" },
  { key: "jornada", label: "Jornada", section: "estagio" },
  { key: "supervisor", label: "Supervisor", section: "estagio" },
  { key: "bolsa", label: "Bolsa", section: "estagio" },
  { key: "beneficios", label: "Benefícios", section: "estagio" },
  { key: "seguro_apolice", label: "Apólice de seguro", section: "estagio", full: true },
  { key: "data_termo_aditivo", label: "Data do termo aditivo", section: "estagio", date: true },
  { key: "plano_atividades", label: "Plano de atividades", section: "estagio", full: true, multiline: true },
];

const SECOES = [
  { id: "candidato", title: "Candidato" },
  { id: "responsavel", title: "Responsável legal" },
  { id: "escola", title: "Instituição de ensino" },
  { id: "estagio", title: "Estágio" },
];

function dataBr(iso: string) {
  const partes = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : iso;
}

/** Mesmas travas do v0: término até o fim dos estudos e no máximo 2 anos. */
function erroDasDatas(inicio: string, termino: string, terminoEstudo: string) {
  if (!termino) return "";
  if (inicio && termino < inicio) return "O término do estágio não pode ser antes do início.";
  if (terminoEstudo && termino > terminoEstudo) return `O término passa da data de término dos estudos do candidato (${dataBr(terminoEstudo)}).`;
  if (inicio) {
    const limite = new Date(`${inicio}T00:00:00Z`);
    limite.setUTCDate(limite.getUTCDate() + 730);
    if (new Date(`${termino}T00:00:00Z`) > limite) return "O estágio não pode passar de 2 anos.";
  }
  return "";
}

function normalizar(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

type DadosTce = {
  empresa_id: string;
  status: string;
  concedente: { razao_social: string; cnpj: string; endereco: string; cep: string; cidade: string; estado: string; email: string; representante: string };
  campos: Record<string, string>;
};

export function GeradorTce({ editarId }: { editarId?: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const contratacaoParam = Number(params.get("contratacao")) || null;
  const [idContratacao, setIdContratacao] = useState<number | null>(null);
  const [terminoEstudo, setTerminoEstudo] = useState("");
  const empresas = useQuery({ queryKey: ["tce-empresas"], queryFn: () => api<Empresa[]>("/api/v1/tce/empresas") });
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [empresaId, setEmpresaId] = useState("");
  const [concedente, setConcedente] = useState({ razao_social: "", cnpj: "", endereco: "", cep: "", cidade: "", estado: "", email: "", representante: "" });
  const [campos, setCampos] = useState<Record<string, string>>({ ...FIXOS });
  const [candidatoBusca, setCandidatoBusca] = useState("");
  // Candidato escolhido na pesquisa: o TCE grava os documentos dele (CPF, RG, endereço, responsável) na ficha.
  const [candidatoId, setCandidatoId] = useState<string | null>(null);
  const [candidatos, setCandidatos] = useState<CandidatoBusca[]>([]);
  const [escolaBusca, setEscolaBusca] = useState("");
  const [escolas, setEscolas] = useState<Escola[]>([]);
  const [escolaErro, setEscolaErro] = useState("");
  // Só para o selo "Preenchido" do bloco da escola.
  const [escolaEscolhida, setEscolaEscolhida] = useState("");
  const [responsavel, setResponsavel] = useState(false);
  const [vagaBusca, setVagaBusca] = useState("");
  const [vagas, setVagas] = useState<VagaEstagio[]>([]);
  const [vagaAberta, setVagaAberta] = useState(false);
  const [vagaEscolhida, setVagaEscolhida] = useState("");
  const [vagaAviso, setVagaAviso] = useState("");
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(!editarId);
  const dados = useQuery({
    queryKey: ["tce-dados", editarId],
    enabled: Boolean(editarId),
    queryFn: () => api<DadosTce>(`/api/v1/tce/${editarId}/dados`),
  });
  useEffect(() => {
    const salvo = dados.data?.data;
    if (!editarId || !salvo || pronto) return;
    setEmpresaId(salvo.empresa_id || "");
    setConcedente(salvo.concedente);
    setBusca(salvo.concedente.razao_social ? `${salvo.concedente.razao_social} · ${salvo.concedente.cnpj}` : "");
    setCampos({ ...salvo.campos, ...FIXOS });
    setEscolaBusca(salvo.campos.nome_escola || "");
    setResponsavel(Boolean(salvo.campos.nome_responsavel));
    setPronto(true);
  }, [dados.data, editarId, pronto]);

  const lista = empresas.data?.data ?? [];
  const termo = busca.trim();
  const termoDigitos = termo.replace(/\D/g, "");
  const visiveis = termo.length < 1 ? [] : lista.filter((empresa) => {
    const texto = normalizar(`${empresa.razao_social} ${empresa.nome_fantasia} ${empresa.cnpj}`);
    // CNPJ digitado com ou sem pontuação acha a empresa.
    return texto.includes(normalizar(termo)) || (termoDigitos.length >= 5 && empresa.cnpj.replace(/\D/g, "").includes(termoDigitos));
  }).slice(0, 15);

  async function procurarCandidato(valor: string) {
    setCandidatoBusca(valor);
    setCandidatoId(null);
    if (valor.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    try {
      const result = await api<CandidatoBusca[]>(`/api/v1/tce/candidatos?q=${encodeURIComponent(valor.trim())}`);
      setCandidatos(result.data);
    } catch {
      setCandidatos([]);
    }
  }

  function aplicarPreenchimento(dados: Preenchimento) {
      setIdContratacao(dados.idContratacao ?? null);
      setTerminoEstudo(dados.terminoEstudo ?? "");
      setCampos((atual) => ({ ...atual, ...dados.campos, ...FIXOS }));
      if (dados.campos.nome_responsavel) setResponsavel(true);
      if (dados.escolaId) {
        setEscolaBusca(dados.campos.nome_escola || "");
        setEscolaEscolhida(dados.campos.nome_escola || "");
      }
      if (dados.concedente) {
        setConcedente({
          razao_social: dados.concedente.razao_social,
          cnpj: dados.concedente.cnpj,
          endereco: dados.concedente.endereco,
          cep: dados.concedente.cep,
          cidade: dados.concedente.cidade,
          estado: dados.concedente.estado,
          email: dados.concedente.email,
          representante: dados.concedente.representante,
        });
        setEmpresaId(dados.empresaId);
        setBusca(`${dados.concedente.razao_social} · ${dados.concedente.cnpj}`);
        setAberta(false);
      }
  }

  async function escolherCandidato(pessoa: CandidatoBusca) {
    setCandidatoBusca(`${pessoa.nome}${pessoa.cpf ? ` · ${pessoa.cpf}` : ""}`);
    setCandidatoId(pessoa.id);
    setCandidatos([]);
    setErro("");
    try {
      const result = await api<Preenchimento>(`/api/v1/tce/candidatos/${pessoa.id}`);
      aplicarPreenchimento(result.data);
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : "Não foi possível carregar o candidato.");
    }
  }

  useEffect(() => {
    if (!contratacaoParam) return;
    let ativo = true;
    api<Preenchimento>(`/api/v1/tce/contratacoes/${contratacaoParam}`)
      .then((result) => {
        if (!ativo) return;
        aplicarPreenchimento(result.data);
        setCandidatoBusca(result.data.campos.nome || "");
      })
      .catch((error) => {
        if (ativo) setErro(error instanceof ApiError ? error.message : "Não foi possível carregar a contratação.");
      });
    return () => { ativo = false; };
  }, [contratacaoParam]);

  async function procurarVaga(valor: string) {
    setVagaBusca(valor);
    setVagaEscolhida("");
    setVagaAberta(true);
    try {
      const result = await api<VagaEstagio[]>(`/api/v1/tce/vagas?q=${encodeURIComponent(valor.trim())}`);
      setVagas(result.data);
    } catch {
      setVagas([]);
    }
  }

  /** Vaga escolhida: preenche as condições que ela tem e, sem empresa escolhida ainda, a concedente. */
  function escolherVaga(vaga: VagaEstagio) {
    setCampos((atual) => ({ ...atual, ...vaga.campos, ...FIXOS }));
    setVagaBusca(`${vaga.cargo}${vaga.empresa ? ` · ${vaga.empresa}` : ""}`);
    setVagaEscolhida(vaga.cargo);
    setVagaAberta(false);
    const empresa = lista.find((item) => item.id === vaga.empresaId);
    if (!empresaId && empresa) {
      setEmpresaId(empresa.id);
      setConcedente({ razao_social: empresa.razao_social, cnpj: empresa.cnpj, endereco: empresa.endereco, cep: empresa.cep, cidade: empresa.cidade, estado: empresa.estado, email: empresa.email, representante: empresa.representante });
      setBusca(`${empresa.razao_social}${empresa.nome_fantasia ? ` (${empresa.nome_fantasia})` : ""} · ${empresa.cnpj}`);
      setVagaAviso("A empresa concedente também foi preenchida com a empresa da vaga.");
    } else if (empresaId && vaga.empresaId && vaga.empresaId !== empresaId) {
      setVagaAviso("Atenção: a vaga é de outra empresa, diferente da concedente escolhida no bloco 1.");
    } else {
      setVagaAviso("");
    }
  }

  async function procurarEscola(valor: string) {
    setEscolaBusca(valor);
    setEscolaEscolhida("");
    if (valor.trim().length < 2) {
      setEscolas([]);
      setEscolaErro("");
      return;
    }
    try {
      const result = await api<{ opcoes: Escola[]; erro: string }>(`/api/v1/tce/escolas?q=${encodeURIComponent(valor.trim())}`);
      setEscolas(result.data.opcoes);
      setEscolaErro(result.data.erro);
    } catch (error) {
      setEscolas([]);
      setEscolaErro(error instanceof ApiError ? error.message : "Não foi possível buscar as escolas.");
    }
  }

  const corpo = { empresa_id: empresaId, id_contratacao: idContratacao, id_candidato: candidatoId, concedente, campos: { ...campos, ...FIXOS } };
  const gerar = useMutation({
    mutationFn: () => editarId
      ? api<{ id: string }>(`/api/v1/tce/${editarId}`, { method: "PATCH", body: JSON.stringify(corpo) })
      : api<{ id: string }>("/api/v1/tce/gerar", { method: "POST", body: JSON.stringify(corpo) }),
    onSuccess: (result) => navigate(`/termos/${result.data.id}`),
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível salvar o TCE."),
  });

  const opcional = (key: string) => key === "data_termo_aditivo";
  const preenchido = (valor: string | undefined) => Boolean(valor && valor.trim());
  const progresso = [
    { id: "tce-concedente", titulo: "Empresa concedente", feitos: CONCEDENTE_PRINCIPAIS.filter((key) => preenchido(concedente[key])).length, total: CONCEDENTE_PRINCIPAIS.length },
    { id: "tce-candidato", titulo: "Estagiário", feitos: PRINCIPAIS.candidato.filter((key) => preenchido(campos[key])).length, total: PRINCIPAIS.candidato.length },
    ...(responsavel ? [{ id: "tce-responsavel", titulo: "Responsável legal", feitos: PRINCIPAIS.responsavel.filter((key) => preenchido(campos[key])).length, total: PRINCIPAIS.responsavel.length }] : []),
    { id: "tce-escola", titulo: "Instituição de ensino", feitos: PRINCIPAIS.escola.filter((key) => preenchido(campos[key])).length, total: PRINCIPAIS.escola.length },
    { id: "tce-estagio", titulo: "Condições do estágio", feitos: PRINCIPAIS.estagio.filter((key) => preenchido(campos[key])).length, total: PRINCIPAIS.estagio.length },
  ];
  const campo = (field: (typeof CAMPOS)[number]) => (
    <div key={field.key} className={LARGURA[field.key] ?? "sm:col-span-2"}>
      <Field label={`${field.label}${opcional(field.key) ? " (se houver)" : ""}`}>
        {field.multiline ? (
          <Textarea rows={7} placeholder="Descreva as atividades que o estagiário vai realizar" value={campos[field.key] ?? ""} onChange={(event) => setCampos((atual) => ({ ...atual, [field.key]: event.target.value }))} />
        ) : (
          <Input
            type={field.date ? "date" : "text"}
            readOnly={field.key in FIXOS}
            className={field.key in FIXOS ? "bg-slate-50 text-slate-500" : undefined}
            placeholder={field.placeholder ?? EXEMPLOS[field.key]}
            value={FIXOS[field.key] ?? (field.key === "emissao_cidade_data" ? cidadeDaEmissao(campos[field.key]) : campos[field.key]) ?? ""}
            onChange={(event) => setCampos((atual) => ({ ...atual, [field.key]: event.target.value }))}
          />
        )}
        {field.key === "estagio_termino" && terminoEstudo ? <span className="text-xs text-slate-500">Os estudos terminam em {dataBr(terminoEstudo)}; o estágio não pode passar disso.</span> : null}
        {field.key === "emissao_cidade_data" ? <span className="text-xs text-slate-500">A data entra sozinha: o dia em que o PDF é gerado{editarId ? " ou salvo" : ""} (hoje, {hojePorExtenso()}).</span> : null}
        {AVISO_FIXO[field.key] ? <span className="text-xs text-slate-500">{AVISO_FIXO[field.key]}</span> : null}
      </Field>
    </div>
  );
  const camposDa = (secao: string, chaves?: string[]) => CAMPOS.filter((field) => field.section === secao && (!chaves || chaves.includes(field.key))).map(campo);

  return (
    <form className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start" onSubmit={(event) => {
      event.preventDefault();
      const problema = erroDasDatas(campos.estagio_inicio ?? "", campos.estagio_termino ?? "", terminoEstudo);
      setErro(problema);
      if (!problema) gerar.mutate();
    }}>
      <div className="grid min-w-0 gap-4">
        {idContratacao ? <p className="flex items-center gap-2 rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-800"><Check size={16} /> Dados carregados da contratação {idContratacao}. Confira cada bloco antes de gerar.</p> : null}
        {editarId && dados.data?.data.status && dados.data.data.status !== "gerado" ? (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Este termo já foi enviado. Ao salvar, o PDF é refeito e ele volta para Gerado, para ser enviado de novo.</p>
        ) : null}
        {editarId && dados.isError ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">Este termo não tem dados para editar. Ele foi gerado sem o formulário do TCE.</p> : null}

        <Bloco id="tce-concedente" numero={1} titulo="Empresa concedente" texto="Quem oferece o estágio.">
          <Busca rotulo="Preencher pela empresa cadastrada" origem={empresaId && concedente.razao_social ? concedente.razao_social : ""}>
            <Input value={busca} autoComplete="off" placeholder="Digite a razão social, o nome fantasia ou o CNPJ" className="pl-9" onChange={(event) => { setBusca(event.target.value); setAberta(true); }} onFocus={() => setAberta(true)} onBlur={() => window.setTimeout(() => setAberta(false), 150)} />
            {aberta && termo.length >= 1 ? (
              <Sugestoes>
                {visiveis.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Nenhuma empresa com esse nome ou CNPJ.</p> : null}
                {visiveis.map((empresa) => (
                  <Sugestao key={empresa.id} titulo={empresa.nome_fantasia || empresa.razao_social} detalhe={[empresa.nome_fantasia ? empresa.razao_social : null, empresa.cnpj].filter(Boolean).join(" — ")} onEscolher={() => {
                    setEmpresaId(empresa.id);
                    setConcedente({ razao_social: empresa.razao_social, cnpj: empresa.cnpj, endereco: empresa.endereco, cep: empresa.cep, cidade: empresa.cidade, estado: empresa.estado, email: empresa.email, representante: empresa.representante });
                    setBusca(`${empresa.razao_social}${empresa.nome_fantasia ? ` (${empresa.nome_fantasia})` : ""} · ${empresa.cnpj}`);
                    setAberta(false);
                  }} />
                ))}
              </Sugestoes>
            ) : null}
            {empresas.isError ? <p className="mt-1 text-sm text-rose-600">Não foi possível carregar as empresas. Atualize a página em instantes.</p> : null}
          </Busca>
          <Grade>
            {CONCEDENTE_CAMPOS.map(([key, label, largura]) => (
              <div key={key} className={largura}>
                <Field label={label}>
                  <Input value={concedente[key]} placeholder={EXEMPLOS[key]} onChange={(event) => setConcedente((atual) => ({ ...atual, [key]: event.target.value }))} />
                </Field>
              </div>
            ))}
          </Grade>
        </Bloco>

        <Bloco id="tce-candidato" numero={2} titulo="Estagiário" texto="Dados pessoais e do curso. Ao escolher o candidato, a escola e a empresa da contratação também são preenchidas.">
          <Busca rotulo="Preencher pelo candidato cadastrado" origem={candidatoId ? campos.nome ?? "" : ""}>
            <Input value={candidatoBusca} autoComplete="off" placeholder="Digite o nome, o CPF ou a empresa" className="pl-9" onChange={(event) => void procurarCandidato(event.target.value)} />
            {candidatos.length ? (
              <Sugestoes>
                {candidatos.map((pessoa) => (
                  <Sugestao key={pessoa.id} titulo={pessoa.nome} detalhe={[pessoa.cpf, pessoa.empresa].filter(Boolean).join(" — ")} onEscolher={() => void escolherCandidato(pessoa)} />
                ))}
              </Sugestoes>
            ) : null}
          </Busca>
          <Subtitulo>Dados pessoais</Subtitulo>
          <Grade>{camposDa("candidato", ["nome", "data_nascimento", "cpf", "rg", "email", "telefone"])}</Grade>
          <Subtitulo>Endereço</Subtitulo>
          <Grade>{camposDa("candidato", ["endereco", "cep", "cidade", "estado"])}</Grade>
          <Subtitulo>Curso</Subtitulo>
          <Grade>{camposDa("candidato", ["curso", "periodo", "ano", "turno", "tipo_estagio"])}</Grade>
        </Bloco>

        <Bloco id="tce-responsavel" numero={3} titulo="Responsável legal" texto="Só para estagiário menor de idade, quando aplicável.">
          <label className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-semibold", responsavel ? "border-cyan-500/40 bg-cyan-50 text-cyan-800" : "border-slate-200 text-slate-700")}>
            <input type="checkbox" className="h-4 w-4 accent-cyan-700" checked={responsavel} onChange={(event) => setResponsavel(event.target.checked)} />
            Incluir responsável legal no termo
          </label>
          {responsavel ? <Grade>{camposDa("responsavel")}</Grade> : null}
        </Bloco>

        <Bloco id="tce-escola" numero={4} titulo="Instituição de ensino" texto="Onde o estagiário estuda.">
          <Busca rotulo="Preencher pela escola cadastrada" origem={escolaEscolhida}>
            <Input value={escolaBusca} autoComplete="off" placeholder="Digite o nome ou o CNPJ da escola" className="pl-9" onChange={(event) => void procurarEscola(event.target.value)} />
            {escolas.length > 0 || escolaErro ? (
              <Sugestoes>
                {escolaErro ? <p className="px-3 py-2 text-sm text-rose-600">{escolaErro}</p> : null}
                {escolas.map((escola) => (
                  <Sugestao key={escola.id} titulo={escola.rotulo} onEscolher={() => {
                    setCampos((atual) => ({ ...atual, ...escola.campos }));
                    setEscolaBusca(escola.rotulo);
                    setEscolaEscolhida(escola.campos.nome_escola || escola.rotulo);
                    setEscolas([]);
                  }} />
                ))}
              </Sugestoes>
            ) : null}
          </Busca>
          <Grade>{camposDa("escola")}</Grade>
        </Bloco>

        <Bloco id="tce-estagio" numero={5} titulo="Condições do estágio" texto="Vão no Anexo I do termo. A vaga preenche jornada, bolsa, benefícios e plano de atividades.">
          <Busca rotulo="Preencher pela vaga de estágio" origem={vagaEscolhida}>
            <Input value={vagaBusca} autoComplete="off" placeholder="Digite o cargo ou a empresa da vaga" className="pl-9" onChange={(event) => void procurarVaga(event.target.value)} onFocus={() => { if (!vagas.length) void procurarVaga(vagaBusca); else setVagaAberta(true); }} onBlur={() => window.setTimeout(() => setVagaAberta(false), 150)} />
            {vagaAberta ? (
              <Sugestoes>
                {vagas.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Nenhuma vaga de estágio aberta com esse cargo ou empresa.</p> : null}
                {vagas.map((vaga) => (
                  <Sugestao key={vaga.id} titulo={vaga.cargo} detalhe={[vaga.empresa, vaga.local, vaga.campos.bolsa].filter(Boolean).join(" — ")} onEscolher={() => escolherVaga(vaga)} />
                ))}
              </Sugestoes>
            ) : null}
            {vagaAviso ? <p className={cn("mt-1 text-xs", vagaAviso.startsWith("Atenção") ? "text-amber-800" : "text-slate-500")}>{vagaAviso}</p> : null}
          </Busca>
          <Subtitulo>Período</Subtitulo>
          <Grade>{camposDa("estagio", ["estagio_inicio", "estagio_termino", "emissao_cidade_data", "data_termo_aditivo"])}</Grade>
          <Subtitulo>Jornada e supervisão</Subtitulo>
          <Grade>{camposDa("estagio", ["carga_horaria_diaria", "carga_horaria_semanal", "jornada", "supervisor"])}</Grade>
          <Subtitulo>Bolsa, benefícios e seguro</Subtitulo>
          <Grade>{camposDa("estagio", ["bolsa", "beneficios", "seguro_apolice"])}</Grade>
          <Grade>{camposDa("estagio", ["plano_atividades"])}</Grade>
        </Bloco>
      </div>

      <aside className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 xl:sticky xl:top-0">
        <div>
          <p className="text-[15px] font-bold text-navy-900">{editarId ? "Salvar o termo" : "Gerar o termo"}</p>
          <p className="text-sm text-slate-500">Campos principais preenchidos em cada bloco. Clique para ir até ele.</p>
        </div>
        <ol className="grid gap-1">
          {progresso.map((item) => {
            const completo = item.feitos === item.total;
            return (
              <li key={item.id}>
                <a href={`#${item.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", completo ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500")}>
                    {completo ? <Check size={12} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{item.titulo}</span>
                  <span className="tabular-nums text-xs text-slate-500">{item.feitos}/{item.total}</span>
                </a>
              </li>
            );
          })}
        </ol>
        {!editarId && !empresaId ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Escolha a empresa concedente na pesquisa do bloco 1 para liberar o botão.</p> : null}
        {erro ? <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p> : null}
        <Button type="submit" className="h-11 w-full" disabled={gerar.isPending || !pronto || (!editarId && !empresaId)}>
          <FileSignature size={16} /> {gerar.isPending ? "Salvando…" : editarId ? "Salvar e atualizar o PDF" : "Gerar TCE"}
        </Button>
        <p className="text-xs text-slate-500">{editarId ? "O PDF é refeito com o que estiver no formulário." : "O PDF abre para conferência. A assinatura só é enviada no passo seguinte."}</p>
      </aside>
    </form>
  );
}

/** Campos principais de cada bloco, só para o andamento do painel lateral (não bloqueiam a geração). */
const CONCEDENTE_PRINCIPAIS = ["razao_social", "cnpj", "endereco", "cep", "cidade", "estado", "email", "representante"] as const;
const PRINCIPAIS: Record<string, string[]> = {
  candidato: ["nome", "data_nascimento", "cpf", "rg", "endereco", "cep", "cidade", "estado", "curso", "turno", "tipo_estagio"],
  responsavel: ["nome_responsavel", "cpf_responsavel", "telefone_responsavel"],
  escola: ["nome_escola", "escola_cnpj_inep", "escola_endereco", "escola_cidade", "escola_estado"],
  estagio: ["estagio_inicio", "estagio_termino", "carga_horaria_diaria", "carga_horaria_semanal", "jornada", "supervisor", "bolsa", "plano_atividades"],
};

const CONCEDENTE_CAMPOS = [
  ["razao_social", "Razão social", "sm:col-span-4"],
  ["cnpj", "CNPJ", "sm:col-span-2"],
  ["endereco", "Endereço", "sm:col-span-4"],
  ["cep", "CEP", "sm:col-span-2"],
  ["cidade", "Cidade", "sm:col-span-3"],
  ["estado", "Estado", "sm:col-span-1"],
  ["email", "E-mail de contato", "sm:col-span-2"],
  ["representante", "Representante legal", "sm:col-span-6"],
] as const;

/** Largura de cada campo na grade de 6 colunas: curto para CEP e UF, largo para nome e endereço. */
const LARGURA: Record<string, string> = {
  nome: "sm:col-span-4", data_nascimento: "sm:col-span-2", cpf: "sm:col-span-3", rg: "sm:col-span-3", email: "sm:col-span-4",
  endereco: "sm:col-span-4", cep: "sm:col-span-2", cidade: "sm:col-span-4", estado: "sm:col-span-2",
  curso: "sm:col-span-4", turno: "sm:col-span-4", tipo_estagio: "sm:col-span-6",
  nome_responsavel: "sm:col-span-4", nascimento_responsavel: "sm:col-span-2", cpf_responsavel: "sm:col-span-3", rg_responsavel: "sm:col-span-3", email_responsavel: "sm:col-span-4",
  endereco_responsavel: "sm:col-span-4", cep_responsavel: "sm:col-span-2", cidade_responsavel: "sm:col-span-4", estado_responsavel: "sm:col-span-2",
  nome_escola: "sm:col-span-4", escola_cnpj_inep: "sm:col-span-2", escola_representante: "sm:col-span-3", escola_email: "sm:col-span-3",
  escola_endereco: "sm:col-span-4", escola_cep: "sm:col-span-2", escola_cidade: "sm:col-span-4", escola_estado: "sm:col-span-2",
  estagio_inicio: "sm:col-span-2", estagio_termino: "sm:col-span-2", data_termo_aditivo: "sm:col-span-2", emissao_cidade_data: "sm:col-span-2",
  carga_horaria_diaria: "sm:col-span-3", carga_horaria_semanal: "sm:col-span-3", jornada: "sm:col-span-4", supervisor: "sm:col-span-2",
  bolsa: "sm:col-span-2", beneficios: "sm:col-span-4", seguro_apolice: "sm:col-span-6",
  plano_atividades: "sm:col-span-6",
};

/** Exemplos de formato nos campos vazios. */
const EXEMPLOS: Record<string, string> = {
  cnpj: "00.000.000/0000-00", cep: "00000-000", estado: "SP", email: "contato@empresa.com.br",
  cpf: "000.000.000-00", telefone: "(11) 90000-0000", periodo: "Ex.: 3º semestre", ano: "Ex.: 2º ano", turno: "Manhã, tarde, noite ou integral",
  cpf_responsavel: "000.000.000-00", telefone_responsavel: "(11) 90000-0000", cep_responsavel: "00000-000",
  escola_cnpj_inep: "CNPJ ou código INEP", escola_cep: "00000-000",
  emissao_cidade_data: "Ex.: São Paulo", carga_horaria_diaria: "Ex.: 6 horas", carga_horaria_semanal: "Ex.: 30 horas",
  jornada: "Ex.: Segunda a sexta, das 9h às 15h", bolsa: "Ex.: R$ 1.200,00", beneficios: "Ex.: Vale-transporte",
};

function Bloco({ id, numero, titulo, texto, children }: { id: string; numero: number; titulo: string; texto: string; children: ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-4 gap-4 rounded-xl border border-slate-200 bg-white p-4 md:p-5">
      <header className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-700 text-sm font-bold text-white">{numero}</span>
        <div>
          <h2 className="text-base font-bold text-navy-900">{titulo}</h2>
          <p className="text-sm text-slate-500">{texto}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Grade({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-6">{children}</div>;
}

function Subtitulo({ children }: { children: ReactNode }) {
  return <p className="-mb-1 border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-700">{children}</p>;
}

/** Busca de preenchimento automático, em destaque no topo do bloco. */
function Busca({ rotulo, origem, children }: { rotulo: string; origem: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 rounded-lg bg-slate-50 p-3">
      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
        <Sparkles size={15} className="text-cyan-700" /> {rotulo}
        {origem ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"><Check size={12} /> Preenchido: {origem}</span> : null}
      </span>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-[1.25rem] -translate-y-1/2 text-slate-400" />
        {children}
      </div>
    </div>
  );
}

function Sugestoes({ children }: { children: ReactNode }) {
  return <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">{children}</div>;
}

function Sugestao({ titulo, detalhe, onEscolher }: { titulo: string; detalhe?: string; onEscolher: () => void }) {
  return (
    <button type="button" className="grid w-full px-3 py-2 text-left hover:bg-slate-50" onMouseDown={(event) => event.preventDefault()} onClick={onEscolher}>
      <span className="text-sm font-semibold text-navy-900">{titulo}</span>
      {detalhe ? <span className="text-xs text-slate-500">{detalhe}</span> : null}
    </button>
  );
}
