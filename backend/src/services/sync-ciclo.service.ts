import type { Logger, NotionSyncService, ResultadoSync } from "./notion-sync.service.js";
import type { ResultadoAbertas, VagasAbertasSyncService } from "./vagas-abertas-sync.service.js";

export type ResultadoCiclo = { slot: string; abertas: ResultadoAbertas | null; notion: ResultadoSync | null };

/** Ciclo do sync: 1) copiar vagas novas 2) apagar fechadas 3) aplicar Notion. Um ciclo por vez. */
export class SyncCicloService {
  private rodando: Promise<ResultadoCiclo> | null = null;

  constructor(
    private readonly abertas: VagasAbertasSyncService,
    private readonly notion: NotionSyncService,
    private readonly log: Logger,
  ) {}

  executar(dry: boolean, slot: string): Promise<ResultadoCiclo> {
    this.rodando ??= this.ciclo(dry, slot).finally(() => {
      this.rodando = null;
    });
    return this.rodando;
  }

  private async ciclo(dry: boolean, slot: string): Promise<ResultadoCiclo> {
    const resultado: ResultadoCiclo = { slot, abertas: null, notion: null };
    try {
      resultado.abertas = await this.abertas.executar(dry, slot);
    } catch (error) {
      // Falha na cópia não impede o Notion de rodar nas vagas que já estão no sistema.
      this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: passo de cópia falhou");
    }
    try {
      resultado.notion = await this.notion.executar(dry);
    } catch (error) {
      this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync notion: passo falhou");
    }
    return resultado;
  }
}
