import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { VagaService } from "../services/vaga.service.js";

/** Serviços do monólito que as ferramentas podem usar. Cresce junto com as ferramentas (Fase 3). */
export type ServicosMcp = {
  vagas: Pick<VagaService, "opcoesFiltro">;
};

export type ContextoFerramenta = {
  usuario: { id: string; nome: string };
  integracao: { id: string; slug: string; nome: string };
  /** Permissões individuais concedidas ao usuário nesta integração (ex.: candidatos:contato). */
  permissoes: ReadonlySet<string>;
  servicos: ServicosMcp;
  requestId: string;
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
  /** true quando a ferramenta chama serviço externo (Google, OpenAI, JEV…). */
  abertoAoMundo?: boolean;
  entrada: E;
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
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: boolean };
};

export function descreverFerramenta(ferramenta: Ferramenta): DescricaoCatalogo {
  const schema = zodToJsonSchema(ferramenta.entrada, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    nome: ferramenta.nome,
    titulo: ferramenta.titulo,
    descricao: ferramenta.descricao,
    versao: 1,
    inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: ferramenta.abertoAoMundo === true },
  };
}
