import { AppError } from "../lib/errors.js";
import { crmRequest, CrmApiError } from "../origem/crm-dna.js";
import { normalizePhone } from "../origem/phone.js";

export type CrmFn = <T>(path: string, init?: RequestInit) => Promise<T>;

type CrmStage = { id: string; name: string; position?: number; isWon?: boolean; isLost?: boolean };
type CrmPipeline = { id: string; name: string; isDefault?: boolean; stages?: CrmStage[] };
type CrmCampo = { id: string; name: string; label?: string | null; type?: string; options?: unknown };
type CrmContato = { id: string; name?: string | null; phone?: string | null };
type CrmDeal = { id: string; title?: string | null; status?: string | null; stage?: { id?: string; name?: string | null; pipeline?: { id?: string; name?: string | null } | null } | null; updatedAt?: string | null };
type Lista<T> = { items?: T[] };

export type DealResumo = { id: string; titulo: string; status: string; etapa: string; etapaId: string; funil: string; funilId: string };
export type Verificado = { telefone: string; normalizado: string | null; valido: boolean; existe: boolean; contato: { id: string; nome: string } | null; deals: DealResumo[] };
export type ItemCriar = { telefone: string; nome?: string; campos?: Array<{ fieldId: string; value: string }> };
export type ResultadoCriar = { telefone: string; status: "criado" | "movido" | "ja_estava" | "erro"; contatoId: string | null; dealId: string | null; motivo: string | null };

/** Tamanho máximo de uma lista por chamada (o CRM limita 400 req/min por token). */
export const LIMITE_LISTA = 300;

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function itensDe<T>(resposta: unknown): T[] {
  if (Array.isArray(resposta)) return resposta as T[];
  const r = resposta as Record<string, unknown> | null;
  const lista = r?.items ?? r?.data ?? r?.pipelines ?? r?.fields ?? r?.customFields;
  return Array.isArray(lista) ? (lista as T[]) : [];
}

/** Lê os telefones colados: um por linha ou separados por vírgula, ponto e vírgula ou tab. Sem repetir. */
export function separarTelefones(texto: string): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const parte of texto.split(/[\n\r,;\t]+/)) {
    const bruto = parte.trim();
    if (!bruto) continue;
    const chave = normalizePhone(bruto) ?? bruto.replace(/\D/g, "");
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(bruto);
  }
  return saida;
}

function resumoDeal(deal: CrmDeal): DealResumo {
  return {
    id: deal.id,
    titulo: texto(deal.title) || "Negócio",
    status: texto(deal.status) || "OPEN",
    etapa: texto(deal.stage?.name),
    etapaId: texto(deal.stage?.id),
    funil: texto(deal.stage?.pipeline?.name),
    funilId: texto(deal.stage?.pipeline?.id),
  };
}

/** Executa em lotes pequenos, em ordem, para não estourar o limite do CRM. */
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(...(await Promise.all(itens.slice(i, i + tamanho).map(fn))));
  return saida;
}

function erroCrm(error: unknown, padrao: string): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof CrmApiError) {
    if (/não configurados/.test(error.message)) return new AppError(503, "CRM_NAO_CONFIGURADO", "A API do CRM não está configurada no servidor (CRM_BASE_URL e CRM_API_KEY).");
    if (error.status === 401 || error.status === 403) return new AppError(502, "CRM_SEM_PERMISSAO", `O CRM recusou a operação: ${error.message}`);
    return new AppError(502, "CRM_FALHOU", error.message || padrao);
  }
  return new AppError(502, "CRM_FALHOU", padrao);
}

/**
 * Disparador pelo CRM (Bwipo): confere telefones, cria ou move deals na fase escolhida (com campos personalizados
 * vindos da planilha) e dispara um template de WhatsApp por campanha de integração. Só grava no CRM.
 */
export class DisparadorService {
  constructor(
    private readonly crm: CrmFn = crmRequest,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  private get canal() {
    return texto(this.env.BWIPO_CANAL_DISPARO_ID);
  }

  /** Funis com fases, campos personalizados de deal e o que o disparo de template usa. */
  async configuracao() {
    try {
      const [pipelines, camposDeal] = await Promise.all([
        this.crm<unknown>("/api/pipelines"),
        this.crm<unknown>("/api/custom-fields?entity=deal"),
      ]);
      return {
        funis: itensDe<CrmPipeline>(pipelines).map((p) => ({
          id: p.id,
          nome: texto(p.name),
          padrao: Boolean(p.isDefault),
          fases: (p.stages ?? [])
            .slice()
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
            .map((s) => ({ id: s.id, nome: texto(s.name), ganho: Boolean(s.isWon), perdido: Boolean(s.isLost) })),
        })),
        campos: itensDe<CrmCampo>(camposDeal).map((c) => ({ id: c.id, nome: texto(c.name), rotulo: texto(c.label) || texto(c.name), tipo: texto(c.type) })),
        disparo: {
          canalConfigurado: Boolean(this.canal),
          templates: texto(this.env.BWIPO_TEMPLATES_DISPARO).split(",").map((nome) => nome.trim()).filter(Boolean),
        },
      };
    } catch (error) {
      throw erroCrm(error, "Não foi possível ler funis e campos do CRM.");
    }
  }

  /** Para cada telefone: se o contato existe no CRM e quais deals ele tem (abertos primeiro). */
  async verificar(telefones: string[]): Promise<Verificado[]> {
    if (telefones.length > LIMITE_LISTA) throw new AppError(422, "LISTA_GRANDE", `Envie até ${LIMITE_LISTA} telefones por vez.`);
    return emLotes(telefones, 4, async (bruto): Promise<Verificado> => {
      const normalizado = normalizePhone(bruto);
      if (!normalizado) return { telefone: bruto, normalizado: null, valido: false, existe: false, contato: null, deals: [] };
      try {
        const [contatos, deals] = await Promise.all([
          this.crm<Lista<CrmContato>>(`/api/contacts?phone=${normalizado}&perPage=1`),
          this.crm<Lista<CrmDeal>>(`/api/deals?contactPhone=${normalizado}&perPage=10`),
        ]);
        const contato = contatos.items?.[0] ?? null;
        const lista = (deals.items ?? []).map(resumoDeal).sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN"));
        return {
          telefone: bruto,
          normalizado,
          valido: true,
          existe: Boolean(contato),
          contato: contato ? { id: contato.id, nome: texto(contato.name) } : null,
          deals: lista,
        };
      } catch (error) {
        throw erroCrm(error, "Não foi possível consultar o CRM.");
      }
    });
  }

  /**
   * Cria contato + deal na fase escolhida (POST /api/leads, idempotente pelo telefone). Se o contato já tem deal
   * aberto no mesmo funil: move para a fase (quando pedido) ou deixa como está, sem duplicar.
   */
  async criar(input: { stageId: string; itens: ItemCriar[]; moverExistentes: boolean; origem: string }): Promise<ResultadoCriar[]> {
    if (input.itens.length > LIMITE_LISTA) throw new AppError(422, "LISTA_GRANDE", `Envie até ${LIMITE_LISTA} contatos por vez.`);
    const config = await this.configuracao();
    const funil = config.funis.find((f) => f.fases.some((fase) => fase.id === input.stageId));
    if (!funil) throw new AppError(422, "FASE_INVALIDA", "Fase não encontrada no CRM. Atualize a página e escolha de novo.");
    return emLotes(input.itens, 3, async (item): Promise<ResultadoCriar> => {
      const normalizado = normalizePhone(item.telefone);
      if (!normalizado) return { telefone: item.telefone, status: "erro", contatoId: null, dealId: null, motivo: "Telefone inválido (use DDD + número)." };
      const campos = (item.campos ?? []).filter((campo) => campo.fieldId && texto(campo.value));
      try {
        const abertos = await this.crm<Lista<CrmDeal>>(`/api/deals?contactPhone=${normalizado}&status=OPEN&pipelineId=${encodeURIComponent(funil.id)}&perPage=1`);
        const existente = abertos.items?.[0];
        if (existente) {
          if (!input.moverExistentes) return { telefone: item.telefone, status: "ja_estava", contatoId: null, dealId: existente.id, motivo: `Já tem deal aberto em ${texto(existente.stage?.name) || funil.nome}.` };
          if (existente.stage?.id !== input.stageId) {
            await this.crm(`/api/deals/${encodeURIComponent(existente.id)}`, { method: "PUT", body: JSON.stringify({ stageId: input.stageId }) });
          }
          if (campos.length) {
            await this.crm(`/api/deals/${encodeURIComponent(existente.id)}/custom-fields`, { method: "PUT", body: JSON.stringify({ values: campos }) });
          }
          return { telefone: item.telefone, status: "movido", contatoId: null, dealId: existente.id, motivo: null };
        }
        const nome = texto(item.nome) || `+${normalizado}`;
        const resposta = await this.crm<{ contact?: { id?: string }; deal?: { id?: string } | null; missingCustomFields?: { deal?: string[] } }>("/api/leads", {
          method: "POST",
          body: JSON.stringify({
            contact: { name: nome, phone: `+${normalizado}`, lifecycleStage: "LEAD", source: input.origem },
            deal: { stageId: input.stageId, title: `Negócio ${nome}`, customFields: campos },
          }),
        });
        const faltando = resposta.missingCustomFields?.deal ?? [];
        return {
          telefone: item.telefone,
          status: "criado",
          contatoId: resposta.contact?.id ?? null,
          dealId: resposta.deal?.id ?? null,
          motivo: faltando.length ? `Campos não encontrados no CRM: ${faltando.join(", ")}.` : null,
        };
      } catch (error) {
        const erro = erroCrm(error, "Falha ao criar no CRM.");
        return { telefone: item.telefone, status: "erro", contatoId: null, dealId: null, motivo: erro.message };
      }
    });
  }

  /**
   * Dispara um template de WhatsApp só para os contatos escolhidos: etiqueta temporária nos contatos + campanha
   * de integração filtrada por essa etiqueta + lançamento. Canal: BWIPO_CANAL_DISPARO_ID ou o da última conversa.
   */
  async disparar(input: { contatoIds: string[]; template: string; idioma: string; nome: string }) {
    const ids = [...new Set(input.contatoIds.filter(Boolean))];
    if (!ids.length) throw new AppError(422, "SEM_CONTATOS", "Escolha ao menos um contato que já esteja no CRM.");
    if (ids.length > LIMITE_LISTA) throw new AppError(422, "LISTA_GRANDE", `Dispare para até ${LIMITE_LISTA} contatos por vez.`);
    const agora = new Date();
    const carimbo = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(agora).replace(/\D/g, "").slice(0, 12);
    try {
      const tag = await this.crm<{ id?: string; tag?: { id?: string } }>("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: `disparo-sistema-${carimbo}`, color: "#0e7490" }),
      });
      const tagId = tag.id ?? tag.tag?.id;
      if (!tagId) throw new AppError(502, "CRM_FALHOU", "O CRM não devolveu a etiqueta do disparo.");
      const falhas: string[] = [];
      await emLotes(ids, 4, async (id) => {
        try {
          await this.crm(`/api/contacts/${encodeURIComponent(id)}/tags`, { method: "POST", body: JSON.stringify({ tagId }) });
        } catch {
          falhas.push(id);
        }
      });
      if (falhas.length === ids.length) throw new AppError(502, "CRM_FALHOU", "Não foi possível marcar os contatos para o disparo.");
      const canal = this.canal;
      const criada = await this.crm<{ campaign?: { id?: string } }>("/api/integrations/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: input.nome || `Disparo DNA Work ${carimbo}`,
          type: "TEMPLATE",
          ...(canal ? { channelId: canal } : { useLastConversationChannel: true }),
          filters: { tagIds: [tagId] },
          templateName: input.template,
          templateLanguage: input.idioma || "pt_BR",
        }),
      });
      const campanhaId = criada.campaign?.id;
      if (!campanhaId) throw new AppError(502, "CRM_FALHOU", "O CRM não devolveu a campanha criada.");
      await this.crm(`/api/integrations/campaigns/${encodeURIComponent(campanhaId)}/launch`, { method: "POST" });
      return { campanhaId, etiqueta: `disparo-sistema-${carimbo}`, contatos: ids.length - falhas.length, semEtiqueta: falhas.length, canal: canal ? "configurado" : "ultima_conversa" };
    } catch (error) {
      throw erroCrm(error, "Não foi possível disparar pelo CRM.");
    }
  }
}
