export const PAGINAS = [
  { id: "painel", nome: "Painel", grupo: "Geral" },
  { id: "candidatos", nome: "Candidatos", grupo: "Geral" },
  { id: "empresas", nome: "Empresas", grupo: "Geral" },
  { id: "vagas", nome: "Consultar vagas", grupo: "Vagas" },
  { id: "vagas-modelos", nome: "Consultar modelos", grupo: "Vagas" },
  { id: "vagas-modelo", nome: "Cadastrar modelo", grupo: "Vagas" },
  { id: "processos", nome: "Processos", grupo: "Geral" },
  { id: "contratacoes", nome: "Contratações", grupo: "Geral" },
  { id: "termos", nome: "Consultar termos", grupo: "Termos" },
  { id: "termos-gerar", nome: "Gerar TCE", grupo: "Termos" },
  { id: "instituicoes", nome: "Consultar instituições", grupo: "Instituições" },
  { id: "instituicoes-nova", nome: "Cadastrar instituição", grupo: "Instituições" },
  { id: "faturamento", nome: "Gerar faturamento", grupo: "Financeiro" },
  { id: "contas", nome: "Contas a receber", grupo: "Financeiro" },
  { id: "regua", nome: "Régua de cobrança", grupo: "Financeiro" },
  { id: "procfy", nome: "Relatório Procfy", grupo: "Financeiro" },
  { id: "comissao", nome: "Consultar comissão", grupo: "Comissão" },
  { id: "comissao-empresas", nome: "Empresas da comissão", grupo: "Comissão" },
  { id: "holerite", nome: "Holerite", grupo: "Financeiro" },
  { id: "emails", nome: "E-mails", grupo: "Geral" },
  { id: "documentos", nome: "Documentos pendentes", grupo: "Geral" },
] as const;

export const IDS_PAGINA = new Set<string>(PAGINAS.map((pagina) => pagina.id));

const REGRAS_API: Array<[string, string[]]> = [
  ["/api/v1/dashboard", ["painel"]],
  ["/api/v1/candidatos", ["candidatos"]],
  ["/api/v1/empresas", ["empresas"]],
  ["/api/v1/modalidades", ["vagas", "vagas-modelos", "vagas-modelo"]],
  ["/api/v1/vagas", ["vagas", "vagas-modelos", "vagas-modelo"]],
  ["/api/v1/processos", ["processos"]],
  ["/api/v1/contratacoes", ["contratacoes"]],
  ["/api/v1/tce", ["termos", "termos-gerar"]],
  ["/api/v1/termos", ["termos", "termos-gerar"]],
  ["/api/v1/emails", ["emails"]],
  ["/api/v1/asaas/regua", ["regua"]],
  ["/api/v1/asaas", ["contas", "faturamento"]],
];

export function paginasDaApi(path: string): string[] {
  const regra = REGRAS_API.find(([prefixo]) => path === prefixo || path.startsWith(`${prefixo}/`));
  return regra?.[1] ?? [];
}
