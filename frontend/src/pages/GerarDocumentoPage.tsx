import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { FileDown, Search } from "lucide-react";
import { GerarRescisaoMedio } from "@/components/gerar-rescisao-medio";
import { Alerta, CabecalhoPagina, FiltroChips } from "@/components/pagina";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { formatCnpj, formatPhone, textoPlano } from "@/lib/format";

type Modelo = "contrato" | "adesao" | "rescisao";
type Modalidade = "direta" | "estagio" | "ambas";
type Empresa = {
  id_empresa: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  responsavel: string | null;
};

type Regimes = {
  clt_indeterminado: boolean;
  clt_determinado: boolean;
  clt_intermitente: boolean;
  autonomo: boolean;
  pj: boolean;
  outros: boolean;
  outros_texto: string;
};

const regimesIniciais: Regimes = {
  clt_indeterminado: true,
  clt_determinado: false,
  clt_intermitente: false,
  autonomo: false,
  pj: false,
  outros: false,
  outros_texto: "",
};

type Parte = { razao: string; cnpj: string; endereco: string; email: string; data: string; modalidade: Modalidade };

function hoje() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function parteVazia(): Parte {
  return { razao: "", cnpj: "", endereco: "", email: "", data: hoje(), modalidade: "ambas" };
}

const regimeOpcoes: Array<{ chave: keyof Omit<Regimes, "outros_texto">; rotulo: string }> = [
  { chave: "clt_indeterminado", rotulo: "CLT por prazo indeterminado" },
  { chave: "clt_determinado", rotulo: "CLT por prazo determinado ou experiência" },
  { chave: "clt_intermitente", rotulo: "CLT intermitente" },
  { chave: "autonomo", rotulo: "Profissional autônomo" },
  { chave: "pj", rotulo: "Pessoa jurídica" },
  { chave: "outros", rotulo: "Outros" },
];

function enderecoEmpresa(empresa: Empresa) {
  const linha = [empresa.logradouro, empresa.numero, empresa.complemento].filter(Boolean).join(", ");
  const cidade = [empresa.bairro, empresa.cidade, empresa.uf].filter(Boolean).join(", ");
  const cep = empresa.cep ? `CEP ${empresa.cep}` : "";
  return [linha, cidade, cep].filter(Boolean).join(" - ");
}

function cnpjEmpresa(valor: string | null) {
  if (!valor) return "";
  const formatado = formatCnpj(valor);
  return formatado === "—" ? valor : formatado;
}

function BuscaEmpresa({ rotulo, onEscolher }: { rotulo: string; onEscolher: (empresa: Empresa) => void }) {
  const [busca, setBusca] = useState("");
  const empresas = useQuery({
    queryKey: ["empresas-documento", busca],
    enabled: busca.trim().length >= 2,
    queryFn: () => api<Empresa[]>(`/api/v1/empresas?pageSize=8&q=${encodeURIComponent(busca.trim())}`),
  });
  const lista = empresas.data?.data ?? [];
  return (
    <div className="grid gap-1.5 rounded-lg bg-slate-50 p-3">
      <span className="text-sm font-semibold text-slate-700">{rotulo}</span>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input aria-label={rotulo} placeholder="Nome, razão social ou CNPJ" value={busca} onChange={(event) => setBusca(event.target.value)} className="pl-9" />
      </div>
      {lista.length ? (
        <div className="max-h-44 overflow-auto rounded-lg border border-slate-200 bg-white">
          {lista.map((item) => (
            <button key={item.id_empresa} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onEscolher(item); setBusca(item.nome_fantasia || item.razao_social); }}>
              <span className="font-semibold text-slate-700">{textoPlano(item.nome_fantasia || item.razao_social)}</span>
              <span className="ml-2 tabular-nums text-slate-500">{cnpjEmpresa(item.cnpj)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Bloco do formulário: título, uma frase do que preencher e a grade de 6 colunas. */
function Secao({ titulo, texto, children }: { titulo: string; texto: string; children: ReactNode }) {
  return (
    <Card className="grid gap-4 md:p-5">
      <header>
        <h2 className="text-[15px] font-bold text-navy-900">{titulo}</h2>
        <p className="text-sm text-slate-500">{texto}</p>
      </header>
      {children}
    </Card>
  );
}

function Grade({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-6">{children}</div>;
}

/** Célula da grade: larguras proporcionais ao conteúdo (CNPJ/datas curtos, nomes e endereços largos). */
function Col({ span, children }: { span: 2 | 3 | 4 | 6; children: ReactNode }) {
  const largura = { 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" }[span];
  return <div className={largura}>{children}</div>;
}

function Subtitulo({ children }: { children: ReactNode }) {
  return <p className="border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-700">{children}</p>;
}

const DOCUMENTOS: Array<{ id: Modelo; rotulo: string }> = [
  { id: "contrato", rotulo: "Contrato de prestação de serviços" },
  { id: "adesao", rotulo: "Termo de adesão" },
  { id: "rescisao", rotulo: "Rescisão de estágio do ensino médio" },
];

const DESCRICAO_DOCUMENTO: Record<Modelo, string> = {
  contrato: "Modelo 1 em Word (.docx), com o Anexo I de condições comerciais preenchido.",
  adesao: "Modelo 2 em Word (.docx): a aderente entra no contrato de uma contratante que já assinou.",
  rescisao: "PDF da rescisão do estágio do ensino médio, preenchido com os dados do estagiário efetivado.",
};

function Marcacao({ nome, marcado, onChange, children }: { nome: string; marcado: boolean; onChange: (valor: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input name={nome} type="checkbox" className="size-4 accent-cyan-700" checked={marcado} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

export function GerarDocumentoPage() {
  const [modelo, setModelo] = useState<Modelo>("contrato");
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);
  const [razao, setRazao] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [endereco, setEndereco] = useState("");
  const [email, setEmail] = useState("");
  const [data, setData] = useState(hoje);
  const [modalidade, setModalidade] = useState<Modalidade>("ambas");
  const partes = useRef<Record<"contrato" | "adesao", Parte>>({ contrato: parteVazia(), adesao: parteVazia() });
  const [regimes, setRegimes] = useState<Regimes>(regimesIniciais);
  const [taxaPercentual, setTaxaPercentual] = useState("");
  const [vencimentoDias, setVencimentoDias] = useState("5");
  const [garantia, setGarantia] = useState<"sim" | "nao">("sim");
  const [garantiaDias, setGarantiaDias] = useState("45");
  const [taxaAdministrativa, setTaxaAdministrativa] = useState("");
  const [taxaEstagio, setTaxaEstagio] = useState("");
  const [vencimentoDiverso, setVencimentoDiverso] = useState("");
  const [conversao, setConversao] = useState<"isento" | "percentual">("isento");
  const [conversaoPercentual, setConversaoPercentual] = useState("");
  const [registro, setRegistro] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [contratoData, setContratoData] = useState(hoje);
  const [contratanteRazao, setContratanteRazao] = useState("");
  const [contratanteCnpj, setContratanteCnpj] = useState("");
  const [condicoes, setCondicoes] = useState<"anexo_contrato" | "anexo_especifico">("anexo_contrato");
  const [responsavel, setResponsavel] = useState("");
  const [cargo, setCargo] = useState("");
  const [emailFaturamento, setEmailFaturamento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [enderecoFaturamento, setEnderecoFaturamento] = useState("");
  const [local, setLocal] = useState("São Paulo");

  function trocarModelo(proximo: Modelo) {
    if (proximo === "rescisao") {
      partes.current[modelo === "adesao" ? "adesao" : "contrato"] = { razao, cnpj, endereco, email, data, modalidade };
      setModelo("rescisao");
      return;
    }
    if (modelo === "rescisao") {
      const outra = partes.current[proximo];
      setRazao(outra.razao);
      setCnpj(outra.cnpj);
      setEndereco(outra.endereco);
      setEmail(outra.email);
      setData(outra.data);
      setModalidade(outra.modalidade);
      setModelo(proximo);
      return;
    }
    if (proximo === modelo) return;
    partes.current[modelo] = { razao, cnpj, endereco, email, data, modalidade };
    const outra = partes.current[proximo];
    setRazao(outra.razao);
    setCnpj(outra.cnpj);
    setEndereco(outra.endereco);
    setEmail(outra.email);
    setData(outra.data);
    setModalidade(outra.modalidade);
    setModelo(proximo);
  }

  const direta = modalidade === "direta" || modalidade === "ambas";
  const estagio = modalidade === "estagio" || modalidade === "ambas";

  function preencherAderente(empresa: Empresa) {
    setRazao(empresa.razao_social);
    setCnpj(cnpjEmpresa(empresa.cnpj));
    setEndereco(enderecoEmpresa(empresa));
    setEmail(empresa.email ?? "");
    if (!emailFaturamento) setEmailFaturamento(empresa.email ?? "");
    if (!telefone) setTelefone(formatPhone(empresa.telefone || empresa.celular) === "—" ? "" : formatPhone(empresa.telefone || empresa.celular));
    if (!enderecoFaturamento) setEnderecoFaturamento(enderecoEmpresa(empresa));
    if (!responsavel && empresa.responsavel) setResponsavel(empresa.responsavel);
  }

  function validar() {
    if (razao.trim().length < 3) return "Informe a razão social.";
    if (cnpj.replace(/\D/g, "").length !== 14) return "Informe o CNPJ com 14 dígitos.";
    if (endereco.trim().length < 8) return "Informe o endereço completo.";
    if (!email.includes("@")) return "Informe um e-mail válido.";
    if (!data) return "Informe a data.";
    if (modelo === "contrato") {
      if (direta && !taxaPercentual.trim()) return "Informe a taxa de recrutamento da contratação direta.";
      if (direta && !regimeOpcoes.some((item) => regimes[item.chave])) return "Assinale ao menos um regime da contratação direta.";
      if (direta && regimes.outros && !regimes.outros_texto.trim()) return "Descreva o outro regime.";
      if (direta && garantia === "sim" && !garantiaDias.replace(/\D/g, "")) return "Informe o prazo da garantia.";
      if (estagio && !taxaAdministrativa.trim()) return "Informe a taxa administrativa do estágio.";
      if (estagio && !taxaEstagio.trim()) return "Informe a taxa de recrutamento do estágio.";
      if (estagio && conversao === "percentual" && !conversaoPercentual.trim()) return "Informe o percentual da conversão após 12 meses.";
      return "";
    }
    if (contratanteRazao.trim().length < 3) return "Informe a razão social da contratante signatária.";
    if (contratanteCnpj.replace(/\D/g, "").length !== 14) return "Informe o CNPJ da contratante signatária.";
    if (!contratoData) return "Informe a data do contrato original.";
    if (responsavel.trim().length < 3) return "Informe o responsável.";
    if (cargo.trim().length < 2) return "Informe o cargo.";
    if (!emailFaturamento.includes("@")) return "Informe o e-mail de faturamento.";
    if (telefone.trim().length < 8) return "Informe o telefone.";
    if (enderecoFaturamento.trim().length < 8) return "Informe o endereço de faturamento.";
    if (local.trim().length < 2) return "Informe o local.";
    return "";
  }

  async function gerar(event: FormEvent) {
    event.preventDefault();
    const mensagem = validar();
    if (mensagem) {
      setErro(mensagem);
      return;
    }
    setErro("");
    setGerando(true);
    const corpo = modelo === "contrato"
      ? {
          modelo,
          razao_social: razao,
          cnpj,
          endereco,
          email,
          data,
          modalidade,
          regimes,
          taxa_recrutamento_percentual: taxaPercentual,
          vencimento_dias: vencimentoDias,
          garantia,
          garantia_dias: garantiaDias,
          taxa_administrativa: taxaAdministrativa,
          taxa_recrutamento_estagio: taxaEstagio,
          vencimento_diverso: vencimentoDiverso,
          conversao_12: conversao,
          conversao_percentual: conversaoPercentual,
          registro,
          observacoes,
        }
      : {
          modelo,
          razao_social: razao,
          cnpj,
          endereco,
          email,
          contrato_data: contratoData,
          contratante_razao: contratanteRazao,
          contratante_cnpj: contratanteCnpj,
          modalidade,
          condicoes,
          responsavel,
          cargo,
          email_faturamento: emailFaturamento,
          telefone,
          endereco_faturamento: enderecoFaturamento,
          local,
          data,
        };
    try {
      const response = await fetch("/api/v1/termos/documentos", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message || "Não foi possível gerar o documento.");
      }
      const blob = await response.blob();
      const dispo = response.headers.get("Content-Disposition") ?? "";
      const codificado = /filename\*=UTF-8''([^;]+)/.exec(dispo)?.[1];
      const arquivo = codificado ? decodeURIComponent(codificado) : "documento.docx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = arquivo;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível gerar o documento.");
    } finally {
      setGerando(false);
    }
  }

  const cabecalho = () => (
    <CabecalhoPagina
      titulo="Gerar documento"
      descricao="Escolha o documento e preencha os dados. Nada é gravado no sistema: o arquivo é baixado na hora."
    >
      <div className="mt-2 grid gap-1.5">
        <FiltroChips rotulo="Documento" opcoes={DOCUMENTOS} valor={modelo} onChange={trocarModelo} />
        <p className="text-xs text-slate-500">{DESCRICAO_DOCUMENTO[modelo]}</p>
      </div>
    </CabecalhoPagina>
  );

  if (modelo === "rescisao") {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        {cabecalho()}
        <GerarRescisaoMedio />
      </div>
    );
  }

  const botaoGerar = <Button type="submit" disabled={gerando}><FileDown size={16} /> {gerando ? "Gerando…" : modelo === "contrato" ? "Gerar contrato" : "Gerar termo de adesão"}</Button>;
  return (
    <form className="mx-auto grid w-full max-w-5xl gap-5" onSubmit={gerar}>
      {cabecalho()}

      <Secao
        titulo={modelo === "contrato" ? "Contratante" : "Aderente"}
        texto={modelo === "contrato" ? "A empresa que contrata a DNA Work. Pesquise para preencher sozinho." : "A empresa que adere ao contrato. Pesquise para preencher sozinho, inclusive o faturamento."}
      >
        <BuscaEmpresa rotulo="Buscar empresa já cadastrada" onEscolher={modelo === "contrato" ? (empresa) => { setRazao(empresa.razao_social); setCnpj(cnpjEmpresa(empresa.cnpj)); setEndereco(enderecoEmpresa(empresa)); setEmail(empresa.email ?? ""); } : preencherAderente} />
        <Grade>
          <Col span={4}><Field label="Razão social"><Input aria-label="Razão social" value={razao} onChange={(event) => setRazao(event.target.value)} /></Field></Col>
          <Col span={2}><Field label="CNPJ"><Input aria-label="CNPJ" placeholder="00.000.000/0000-00" value={cnpj} onChange={(event) => setCnpj(event.target.value)} /></Field></Col>
          <Col span={6}><Field label="Endereço completo"><Input aria-label="Endereço completo" value={endereco} onChange={(event) => setEndereco(event.target.value)} /></Field></Col>
          <Col span={4}><Field label="E-mail"><Input aria-label="E-mail" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field></Col>
          <Col span={2}><Field label={modelo === "contrato" ? "Data do contrato" : "Data da adesão"}><Input aria-label="Data" type="date" value={data} onChange={(event) => setData(event.target.value)} /></Field></Col>
        </Grade>
      </Secao>

      {modelo === "adesao" ? (
        <Secao titulo="Contrato ao qual adere" texto="A contratante que já assinou o contrato original e onde a adesão é assinada.">
          <BuscaEmpresa rotulo="Buscar a contratante signatária" onEscolher={(empresa) => { setContratanteRazao(empresa.razao_social); setContratanteCnpj(cnpjEmpresa(empresa.cnpj)); }} />
          <Grade>
            <Col span={4}><Field label="Razão social da contratante"><Input aria-label="Razão social da contratante" value={contratanteRazao} onChange={(event) => setContratanteRazao(event.target.value)} /></Field></Col>
            <Col span={2}><Field label="CNPJ da contratante"><Input aria-label="CNPJ da contratante" placeholder="00.000.000/0000-00" value={contratanteCnpj} onChange={(event) => setContratanteCnpj(event.target.value)} /></Field></Col>
            <Col span={2}><Field label="Data do contrato original"><Input aria-label="Data do contrato original" type="date" value={contratoData} onChange={(event) => setContratoData(event.target.value)} /></Field></Col>
            <Col span={4}><Field label="Local da assinatura"><Input aria-label="Local da assinatura" value={local} onChange={(event) => setLocal(event.target.value)} /></Field></Col>
          </Grade>
        </Secao>
      ) : null}

      <Secao
        titulo={modelo === "contrato" ? "Anexo I — condições comerciais" : "Adesão"}
        texto={modelo === "contrato" ? "Escolha as modalidades; só aparecem as taxas da modalidade escolhida." : "As modalidades a que a aderente adere e para onde vão as cobranças."}
      >
        <Grade>
          <Col span={3}>
            <Field label={modelo === "contrato" ? "Modalidades contratadas" : "Modalidades a que adere"}>
              <Select aria-label="Modalidade" value={modalidade} onChange={(event) => setModalidade(event.target.value as Modalidade)}>
                <option value="ambas">Ambas</option>
                <option value="direta">Somente contratação direta</option>
                <option value="estagio">Somente estágio</option>
              </Select>
            </Field>
          </Col>
          {modelo === "adesao" ? (
            <Col span={3}>
              <Field label="Condições comerciais">
                <Select aria-label="Condições comerciais" value={condicoes} onChange={(event) => setCondicoes(event.target.value === "anexo_especifico" ? "anexo_especifico" : "anexo_contrato")}>
                  <option value="anexo_contrato">As do Anexo I do contrato</option>
                  <option value="anexo_especifico">Anexo I específico da aderente</option>
                </Select>
              </Field>
            </Col>
          ) : null}
        </Grade>
        {modelo === "contrato" && direta ? (
          <div className="grid gap-3">
            <Subtitulo>Contratação direta</Subtitulo>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium text-slate-700">Regimes de contratação</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {regimeOpcoes.map((item) => (
                  <Marcacao key={item.chave} nome={item.chave} marcado={regimes[item.chave]} onChange={(valor) => setRegimes((atual) => ({ ...atual, [item.chave]: valor }))}>{item.rotulo}</Marcacao>
                ))}
              </div>
            </fieldset>
            <Grade>
              {regimes.outros ? <Col span={6}><Field label="Outro regime"><Input aria-label="Outro regime" value={regimes.outros_texto} onChange={(event) => setRegimes((atual) => ({ ...atual, outros_texto: event.target.value }))} /></Field></Col> : null}
              <Col span={2}><Field label="Taxa de recrutamento (%)"><Input aria-label="Taxa de recrutamento" inputMode="decimal" placeholder="80" value={taxaPercentual} onChange={(event) => setTaxaPercentual(event.target.value)} /></Field></Col>
              <Col span={2}><Field label="Vencimento (dias)"><Input aria-label="Vencimento em dias" inputMode="numeric" value={vencimentoDias} onChange={(event) => setVencimentoDias(event.target.value)} /></Field></Col>
              <Col span={2}>
                <Field label="Garantia de reposição">
                  <Select aria-label="Garantia de reposição" value={garantia} onChange={(event) => setGarantia(event.target.value === "nao" ? "nao" : "sim")}>
                    <option value="sim">Sim</option>
                    <option value="nao">Não se aplica</option>
                  </Select>
                </Field>
              </Col>
              {garantia === "sim" ? <Col span={2}><Field label="Prazo da garantia (dias)"><Input aria-label="Prazo da garantia" inputMode="numeric" value={garantiaDias} onChange={(event) => setGarantiaDias(event.target.value)} /></Field></Col> : null}
            </Grade>
          </div>
        ) : null}
        {modelo === "contrato" && estagio ? (
          <div className="grid gap-3">
            <Subtitulo>Estágio</Subtitulo>
            <Grade>
              <Col span={2}><Field label="Taxa administrativa mensal (R$)"><Input aria-label="Taxa administrativa" inputMode="decimal" placeholder="150,00" value={taxaAdministrativa} onChange={(event) => setTaxaAdministrativa(event.target.value)} /></Field></Col>
              <Col span={2}><Field label="Taxa de recrutamento (R$)"><Input aria-label="Taxa de recrutamento do estágio" inputMode="decimal" placeholder="500,00" value={taxaEstagio} onChange={(event) => setTaxaEstagio(event.target.value)} /></Field></Col>
              <Col span={2}>
                <Field label="Conversão após 12 meses">
                  <Select aria-label="Conversão após 12 meses" value={conversao} onChange={(event) => setConversao(event.target.value === "percentual" ? "percentual" : "isento")}>
                    <option value="isento">Isento</option>
                    <option value="percentual">Percentual</option>
                  </Select>
                </Field>
              </Col>
              <Col span={4}><Field label="Vencimento diverso da taxa administrativa"><Input aria-label="Vencimento diverso" placeholder="Deixe em branco para manter o dia 10" value={vencimentoDiverso} onChange={(event) => setVencimentoDiverso(event.target.value)} /></Field></Col>
              {conversao === "percentual" ? <Col span={2}><Field label="Percentual após 12 meses"><Input aria-label="Percentual após 12 meses" inputMode="decimal" value={conversaoPercentual} onChange={(event) => setConversaoPercentual(event.target.value)} /></Field></Col> : null}
            </Grade>
          </div>
        ) : null}
        {modelo === "contrato" ? (
          <div className="grid gap-3">
            <Subtitulo>Outras condições</Subtitulo>
            <Grade>
              <Col span={3}><Field label="Registro de condições por vaga"><Input aria-label="Registro de condições por vaga" value={registro} onChange={(event) => setRegistro(event.target.value)} /></Field></Col>
              <Col span={3}><Field label="Observações"><Input aria-label="Observações" value={observacoes} onChange={(event) => setObservacoes(event.target.value)} /></Field></Col>
            </Grade>
          </div>
        ) : (
          <div className="grid gap-3">
            <Subtitulo>Faturamento e comunicações</Subtitulo>
            <Grade>
              <Col span={4}><Field label="Responsável"><Input aria-label="Responsável" value={responsavel} onChange={(event) => setResponsavel(event.target.value)} /></Field></Col>
              <Col span={2}><Field label="Cargo"><Input aria-label="Cargo" value={cargo} onChange={(event) => setCargo(event.target.value)} /></Field></Col>
              <Col span={4}><Field label="E-mail"><Input aria-label="E-mail de faturamento" type="email" value={emailFaturamento} onChange={(event) => setEmailFaturamento(event.target.value)} /></Field></Col>
              <Col span={2}><Field label="Telefone"><Input aria-label="Telefone" value={telefone} onChange={(event) => setTelefone(event.target.value)} /></Field></Col>
              <Col span={6}><Field label="Endereço de faturamento"><Input aria-label="Endereço de faturamento" value={enderecoFaturamento} onChange={(event) => setEnderecoFaturamento(event.target.value)} /></Field></Col>
            </Grade>
          </div>
        )}
      </Secao>

      {/* Rodapé fixo: o botão e o erro de validação ficam sempre à vista enquanto o formulário rola. */}
      <div className="sticky bottom-0 z-10 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
        {erro ? <Alerta>{erro}</Alerta> : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-slate-500">Confira os dados: o arquivo é baixado no seu computador.</p>
          {botaoGerar}
        </div>
      </div>
    </form>
  );
}
