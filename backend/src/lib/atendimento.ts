function texto(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const item = value.trim();
    if (item === "null" || item === "undefined") return "";
    return item;
  }
  return "";
}

function pareceId(value: string): boolean {
  return /^[0-9a-f-]{32,40}$/i.test(value);
}

function primeiraLinha(value: string): string {
  return value.split(/\r?\n/)[0]?.trim() ?? "";
}

export function extrairTexto(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(extrairTexto).filter(Boolean).join("\n\n");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.text === "string" && row.text.trim()) return row.text.trim();
    if ("output" in row) return extrairTexto(row.output);
    if ("content" in row) return extrairTexto(row.content);
  }
  return "";
}

export function sexoCadastro(value: string | null | undefined): string | null {
  const item = (value ?? "").trim().toLowerCase();
  if (item === "m" || item === "homem" || item === "masculino") return "M";
  if (item === "f" || item === "mulher" || item === "feminino") return "F";
  if (item === "o" || item === "outro") return "O";
  return null;
}

export function cepCadastro(value: string | null | undefined): string | null {
  const digitos = (value ?? "").replace(/\D/g, "");
  if (digitos.length === 7) return `0${digitos}`;
  if (digitos.length === 8) return digitos;
  return null;
}

export function escolaridadeCadastro(value: string | null | undefined): string | null {
  const item = (value ?? "").trim();
  if (!item) return null;
  const conhecidas: Record<string, string> = {
    ensino_fundamental_incompleto: "Ensino fundamental incompleto",
    ensino_fundamental_completo: "Ensino fundamental completo",
    ensino_medio_incompleto: "Ensino médio incompleto",
    ensino_medio_completo: "Ensino médio completo",
    ensino_superior_incompleto: "Ensino superior incompleto",
    ensino_superior_completo: "Ensino superior completo",
  };
  return conhecidas[item] ?? item.replaceAll("_", " ");
}

export function normalizarAtendimento(body: unknown): Record<string, unknown> {
  const origem = Array.isArray(body) ? body[0] : body;
  const row = origem && typeof origem === "object" ? { ...(origem as Record<string, unknown>) } : {};
  if (row.candidato && typeof row.candidato === "object") {
    Object.assign(row, row.candidato);
  }
  const empresaInformada = texto(row.id_empresa);
  const descricao = texto(row.descricao_vaga);
  const entrevista = texto(row.resumo_entrevista) || extrairTexto(row.entrevista);
  return {
    nome: texto(row.nome),
    celular: texto(row.celular || row.telefone),
    email: texto(row.email) || undefined,
    cpf: texto(row.cpf) || undefined,
    id_vaga: texto(row.id_vaga) || texto(row.id_vaga_escolhida) || undefined,
    id_empresa: pareceId(empresaInformada) ? empresaInformada : undefined,
    empresa: texto(row.empresa) || (pareceId(empresaInformada) ? undefined : empresaInformada) || undefined,
    cargo: texto(row.cargo) || primeiraLinha(descricao) || undefined,
    cep: texto(row.cep) || undefined,
    sexo: texto(row.sexo) || undefined,
    escolaridade: texto(row.escolaridade) || undefined,
    idade: texto(row.idade) || undefined,
    tipo_de_vaga: texto(row.tipo_de_vaga) || undefined,
    resumo_cv: texto(row.resumo_cv) || undefined,
    resumo_entrevista: entrevista || undefined,
    descricao_vaga: descricao || undefined,
    teste_comportamental: texto(row.teste_comportamental ?? row["teste comportamental"]) || undefined,
    info_conducao: texto(row.info_conducao ?? row.info_conducoes) || undefined,
    deal_id: texto(row.dealId ?? row.deal_id) || undefined,
    data_recebimento: texto(row.data_recebimento) || undefined,
    observacao: texto(row.observacao) || undefined,
  };
}
