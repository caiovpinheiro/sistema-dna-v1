import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Pool } from "pg";
import type { EmpresaRepository } from "../repositories/empresa.repository.js";
import type { CadastroService } from "../services/cadastro.service.js";
import type { CandidatoService } from "../services/candidato.service.js";
import type { ContratacaoService } from "../services/contratacao.service.js";
import type { DashboardService } from "../services/dashboard.service.js";
import type { DossieService } from "../services/dossie.service.js";
import type { MetricasService } from "../services/metricas.service.js";
import type { ProcessoService } from "../services/processo.service.js";
import type { TriagemMatchingService } from "../services/triagem-matching.service.js";
import type { TriagemService } from "../services/triagem.service.js";
import type { VagaService } from "../services/vaga.service.js";

/** Serviços e repositories do monólito que as ferramentas podem usar. Nenhuma ferramenta recebe SQL livre. */
export type ServicosMcp = {
  db: Pool;
  vagas: VagaService;
  cadastro: CadastroService;
  empresas: EmpresaRepository;
  candidatos: CandidatoService;
  processos: ProcessoService;
  contratacoes: ContratacaoService;
  dashboard: DashboardService;
  metricas: MetricasService;
  triagem: TriagemService;
  matching: TriagemMatchingService;
  dossie: DossieService;
  /** Origem dos candidatos (cache em memória de 10 min; chama o CRM). */
  origem: (from: string | null, to: string | null) => Promise<{ status: number; body: unknown }>;
};

export type TipoLink = "vagas" | "empresas" | "candidatos" | "processos" | "contratacoes" | "triagem";

export type ContextoFerramenta = {
  usuario: { id: string; nome: string };
  integracao: { id: string; slug: string; nome: string };
  /** Permissões individuais concedidas ao usuário nesta integração (ex.: candidatos:contato). */
  permissoes: ReadonlySet<string>;
  servicos: ServicosMcp;
  requestId: string;
  /** Link interno do painel (página que o colaborador consegue abrir), ou null se o tipo não tem página. */
  link(tipo: TipoLink, id: string | number): string | null;
  /** O usuário tem esta página do painel (admin tem todas)? Para ferramentas que juntam dados de mais de um módulo. */
  temPagina(pagina: string): boolean;
};

export type ResultadoFerramenta = { dados: Record<string, unknown> };

export type Ferramenta<E extends ZodTypeAny = ZodTypeAny> = {
  /** Identificador estável (contrato com os clientes). Nunca renomear: criar outro e aposentar o antigo. */
  nome: string;
  titulo: string;
  /** Quando e como usar. É o que o modelo lê para decidir. */
  descricao: string;
  modulo: string;
  /** Na v1 só leitura. Escrita exigirá fluxo de aprovação no painel (ver docs/mcp). */
  tipo: "leitura";
  /** Páginas do painel; basta ter UMA delas (admin tem todas). Vazio = sem exigência de página. */
  paginas: readonly string[];
  adminOnly?: boolean;
  escopo: string;
  /**
   * "puro" = só lê o banco do DNA Work. "servico_externo" = envia dados ou chama Google/CRM/JEV/OpenAI (openWorldHint),
   * normalmente com custo: exige `limitePorHora`.
   */
  consumo: "puro" | "servico_externo";
  /** Teto de chamadas por usuário por hora (obrigatório para serviço externo). */
  limitePorHora?: number;
  /** Permissões individuais (por usuário/integração) que liberam CAMPOS da resposta, ex.: candidatos:contato. */
  permissoesIndividuais?: readonly string[];
  entrada: E;
  /** Contrato da resposta: validado (estrito) antes de sair do monólito. Campo fora do contrato derruba a resposta. */
  saida: ZodTypeAny;
  executar(contexto: ContextoFerramenta, entrada: z.infer<E>): Promise<ResultadoFerramenta>;
};

/** Módulos que existem na arquitetura mas ficam desligados até decisão explícita. */
export const MODULOS_DESATIVADOS: ReadonlySet<string> = new Set(["financeiro"]);

const NOME_VALIDO = /^[a-z][a-z0-9_]{2,63}$/;

export class RegistroFerramentas {
  private readonly itens = new Map<string, Ferramenta>();

  registrar<E extends ZodTypeAny>(ferramenta: Ferramenta<E>): this {
    if (!NOME_VALIDO.test(ferramenta.nome)) throw new Error(`Nome de ferramenta inválido: ${ferramenta.nome}`);
    if (this.itens.has(ferramenta.nome)) throw new Error(`Ferramenta repetida: ${ferramenta.nome}`);
    if (ferramenta.tipo !== "leitura") throw new Error(`${ferramenta.nome}: a v1 só aceita ferramentas de leitura.`);
    if (!ferramenta.descricao.trim() || !ferramenta.titulo.trim()) throw new Error(`${ferramenta.nome}: título e descrição são obrigatórios.`);
    if (ferramenta.consumo === "servico_externo" && !ferramenta.limitePorHora) throw new Error(`${ferramenta.nome}: serviço externo exige limitePorHora.`);
    if (ferramenta.saida === undefined) throw new Error(`${ferramenta.nome}: schema de saída obrigatório.`);
    this.itens.set(ferramenta.nome, ferramenta as unknown as Ferramenta);
    return this;
  }

  obter(nome: string): Ferramenta | undefined {
    const ferramenta = this.itens.get(nome);
    return ferramenta && !MODULOS_DESATIVADOS.has(ferramenta.modulo) ? ferramenta : undefined;
  }

  listar(): Ferramenta[] {
    return [...this.itens.values()].filter((ferramenta) => !MODULOS_DESATIVADOS.has(ferramenta.modulo));
  }

  nomes(): string[] {
    return this.listar().map((ferramenta) => ferramenta.nome);
  }
}

export type DescricaoCatalogo = {
  nome: string;
  titulo: string;
  descricao: string;
  versao: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: boolean };
  /** OpenAI/MCP: política de autenticação declarada na própria ferramenta. */
  securitySchemes: Array<{ type: "oauth2"; scopes: string[] }>;
  _meta: { securitySchemes: Array<{ type: "oauth2"; scopes: string[] }>; dnawork: { modulo: string; consumo: string; limitePorHora: number | null; permissoesIndividuais: string[] } };
};

const jsonSchema = (schema: ZodTypeAny) => {
  const resultado = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete resultado.$schema;
  return resultado;
};

/** Descrição para o catálogo (autenticado ou público). Sem páginas internas, sem instruções da integração. */
export function descreverFerramenta(ferramenta: Ferramenta): DescricaoCatalogo {
  const securitySchemes = [{ type: "oauth2" as const, scopes: [ferramenta.escopo] }];
  return {
    nome: ferramenta.nome,
    titulo: ferramenta.titulo,
    descricao: ferramenta.descricao,
    versao: 1,
    inputSchema: jsonSchema(ferramenta.entrada),
    outputSchema: jsonSchema(ferramenta.saida),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: ferramenta.consumo === "servico_externo" },
    securitySchemes,
    _meta: {
      securitySchemes,
      dnawork: { modulo: ferramenta.modulo, consumo: ferramenta.consumo, limitePorHora: ferramenta.limitePorHora ?? null, permissoesIndividuais: [...(ferramenta.permissoesIndividuais ?? [])] },
    },
  };
}
