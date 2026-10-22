import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Field, Input, Textarea } from "@/components/ui";
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

const APOLICE = "Apólice Coletiva nº 09820055561928 da Porto Seguro";

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
  { key: "emissao_cidade_data", label: "Cidade e data de emissão", section: "estagio", full: true },
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

function normalizar(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function GeradorTce() {
  const navigate = useNavigate();
  const empresas = useQuery({ queryKey: ["tce-empresas"], queryFn: () => api<Empresa[]>("/api/v1/tce/empresas") });
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [empresaId, setEmpresaId] = useState("");
  const [concedente, setConcedente] = useState({ razao_social: "", cnpj: "", endereco: "", cep: "", cidade: "", estado: "", email: "", representante: "" });
  const [campos, setCampos] = useState<Record<string, string>>({ seguro_apolice: APOLICE });
  const [escolaBusca, setEscolaBusca] = useState("");
  const [escolas, setEscolas] = useState<Escola[]>([]);
  const [escolaErro, setEscolaErro] = useState("");
  const [responsavel, setResponsavel] = useState(false);
  const [erro, setErro] = useState("");

  const lista = empresas.data?.data ?? [];
  const termo = busca.trim();
  const visiveis = termo.length < 1 ? [] : lista.filter((empresa) => {
    const texto = normalizar(`${empresa.razao_social} ${empresa.nome_fantasia} ${empresa.cnpj}`);
    return texto.includes(normalizar(termo));
  }).slice(0, 15);

  async function procurarEscola(valor: string) {
    setEscolaBusca(valor);
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

  const gerar = useMutation({
    mutationFn: () => api<{ id: string }>("/api/v1/tce/gerar", {
      method: "POST",
      body: JSON.stringify({ empresa_id: empresaId, concedente, campos: { ...campos, seguro_apolice: APOLICE } }),
    }),
    onSuccess: (result) => navigate(`/termos/${result.data.id}`),
    onError: (error) => setErro(error instanceof ApiError ? error.message : "Não foi possível gerar o TCE."),
  });

  return (
    <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); setErro(""); gerar.mutate(); }}>
      <section className="grid gap-3 md:grid-cols-2">
        <h2 className="font-bold md:col-span-2">Empresa concedente</h2>
        {empresas.isError ? <p className="text-sm text-rose-600 md:col-span-2">Não foi possível carregar as empresas. Confira SUPABASE_URL e a chave no ambiente.</p> : null}
        <div className="relative md:col-span-2">
          <Field label="Pesquisar empresa">
            <Input value={busca} autoComplete="off" placeholder="Razão social, nome fantasia ou CNPJ" onChange={(event) => { setBusca(event.target.value); setAberta(true); }} onFocus={() => setAberta(true)} />
          </Field>
          {aberta && termo.length >= 1 ? (
            <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {visiveis.length === 0 ? <p className="px-3 py-2 text-sm text-slate-500">Nenhuma empresa encontrada.</p> : null}
              {visiveis.map((empresa) => (
                <button key={empresa.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                  setEmpresaId(empresa.id);
                  setConcedente({ razao_social: empresa.razao_social, cnpj: empresa.cnpj, endereco: empresa.endereco, cep: empresa.cep, cidade: empresa.cidade, estado: empresa.estado, email: empresa.email, representante: empresa.representante });
                  setBusca(`${empresa.razao_social}${empresa.nome_fantasia ? ` (${empresa.nome_fantasia})` : ""} · ${empresa.cnpj}`);
                  setAberta(false);
                }}>{empresa.razao_social}{empresa.nome_fantasia ? ` (${empresa.nome_fantasia})` : ""} · {empresa.cnpj}</button>
              ))}
            </div>
          ) : null}
        </div>
        {([
          ["razao_social", "Razão social", true],
          ["cnpj", "CNPJ", false],
          ["cep", "CEP", false],
          ["endereco", "Endereço", true],
          ["cidade", "Cidade", false],
          ["estado", "Estado", false],
          ["email", "E-mail", false],
          ["representante", "Representante", false],
        ] as const).map(([key, label, full]) => (
          <Field key={key} label={label}>
            <Input className={full ? "" : undefined} value={concedente[key]} onChange={(event) => setConcedente((atual) => ({ ...atual, [key]: event.target.value }))} />
          </Field>
        ))}
      </section>
      {SECOES.map((secao) => (
        <section key={secao.id} className="grid gap-3 md:grid-cols-2">
          <h2 className="font-bold md:col-span-2">{secao.title}</h2>
          {secao.id === "responsavel" ? (
            <label className="flex items-center gap-2 text-sm font-semibold md:col-span-2">
              <input type="checkbox" checked={responsavel} onChange={(event) => setResponsavel(event.target.checked)} />
              Incluir responsável legal
            </label>
          ) : null}
          {secao.id === "escola" ? (
            <div className="relative md:col-span-2">
              <Field label="Pesquisar escola">
                <Input value={escolaBusca} autoComplete="off" placeholder="Nome ou CNPJ" onChange={(event) => void procurarEscola(event.target.value)} />
              </Field>
              {escolas.length > 0 || escolaErro ? (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                  {escolaErro ? <p className="px-3 py-2 text-sm text-rose-600">{escolaErro}</p> : null}
                  {escolas.map((escola) => (
                    <button key={escola.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                      setCampos((atual) => ({ ...atual, ...escola.campos }));
                      setEscolaBusca(escola.rotulo);
                      setEscolas([]);
                    }}>{escola.rotulo}</button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {secao.id === "responsavel" && !responsavel ? null : CAMPOS.filter((field) => field.section === secao.id).map((field) => (
            <div key={field.key} className={field.full ? "md:col-span-2" : undefined}>
              <Field label={field.label}>
                {field.multiline ? (
                  <Textarea rows={6} value={campos[field.key] ?? ""} onChange={(event) => setCampos((atual) => ({ ...atual, [field.key]: event.target.value }))} />
                ) : (
                  <Input type={field.date ? "date" : "text"} readOnly={field.key === "seguro_apolice"} placeholder={field.placeholder} value={field.key === "seguro_apolice" ? APOLICE : campos[field.key] ?? ""} onChange={(event) => setCampos((atual) => ({ ...atual, [field.key]: event.target.value }))} />
                )}
              </Field>
            </div>
          ))}
        </section>
      ))}
      {erro ? <p className="text-sm text-rose-600">{erro}</p> : null}
      <Button type="submit" disabled={gerar.isPending || !empresaId}>{gerar.isPending ? "Gerando…" : "Gerar TCE"}</Button>
    </form>
  );
}
