import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { perfilSuficiente, textoDoCurriculo, type PerfilProfissional } from "../lib/curriculo/perfil.js";
import { explicarCompatibilidade, type Explicacao } from "../lib/jev/explicacao.js";
import {
  PERGUNTA_COMPATIBILIDADE,
  RespostaJevInvalida,
  escalaDa,
  interpretarRespostaJev,
  montarEstadoJev,
  type AvaliacaoJev,
  type EstadoJev,
  type VagaParaJev,
} from "../lib/jev/jev.js";
import { horarioDoEspelho } from "./triagem.service.js";

export type StatusAvaliacao = "avaliada" | "indisponivel" | "dados_insuficientes" | "falhou" | "resposta_invalida" | "nao_encontrada";

export type AvaliacaoVaga = {
  id: string;
  status: StatusAvaliacao;
  /** Motivo legível quando a vaga não foi avaliada. Nunca contém dados do currículo. */
  motivo: string | null;
  jev: AvaliacaoJev | null;
  explicacao: Explicacao | null;
};

export type ResultadoCompatibilidade = {
  avaliacoes: AvaliacaoVaga[];
  jev: { pronto: boolean; motivo: string | null; modelo: string; pergunta: string; escala: { min: number; max: number }; lote: number };
};

type LinhaVaga = {
  id: string;
  cargo: string | null;
  atividades: string | null;
  descricao: string | null;
  requisitos: string | null;
  escolaridade: string | null;
  carga_horaria: string | null;
  horario: string | null;
  tipo_vaga: number | null;
  cargo_descricao: string | null;
  cargo_requisitos: string | null;
};

type Config = Pick<AppConfig, "JEV_MODEL" | "JEV_TIMEOUT_MS" | "JEV_CONCORRENCIA"> & Partial<Pick<AppConfig, "JEV_LOTE">>;

/** Executa fn em no máximo `limite` itens ao mesmo tempo, preservando a ordem do resultado. */
export async function mapComLimite<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultado = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const indice = proximo++;
      resultado[indice] = await fn(itens[indice]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limite), itens.length) }, trabalhador));
  return resultado;
}

function texto(valor: string | null | undefined): string | null {
  const limpo = String(valor ?? "").trim();
  return limpo || null;
}

function comTimeout<T>(promessa: Promise<T>, ms: number, controle: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => {
      controle.abort();
      rejeitar(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    }, ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/**
 * Matching profissional da triagem inteligente. Só lê public.vaga e chama o JEV: não grava candidato,
 * não mexe no CRM e não envia mensagem. Filtros operacionais (sexo, idade, distância) ficam na busca rápida.
 */
export class TriagemMatchingService {
  constructor(
    private readonly db: Pool,
    private readonly config: Config,
    private readonly jev: EstadoJev,
  ) {}

  estadoJev() {
    return {
      pronto: this.jev.pronto,
      motivo: this.jev.pronto ? null : this.jev.motivo,
      modelo: this.config.JEV_MODEL,
      pergunta: PERGUNTA_COMPATIBILIDADE.id,
      escala: escalaDa(PERGUNTA_COMPATIBILIDADE),
      /** Quantas vagas a tela manda por vez; "Analisar mais" pede o próximo lote. */
      lote: this.config.JEV_LOTE ?? 10,
    };
  }

  /** Descrição/requisitos vêm da vaga e, se vazios, do cargo. Banco sem essas colunas cai na consulta básica. */
  private async carregarVagas(ids: string[]): Promise<Map<string, LinhaVaga>> {
    const completa = `
      SELECT v.id::text AS id, v.cargo, v.atividades, v.descricao, v.requisitos, v.escolaridade::text AS escolaridade,
             v.carga_horaria::text AS carga_horaria, v.horario, v.tipo_vaga, c.descricao AS cargo_descricao, c.requisitos AS cargo_requisitos
      FROM public.vaga v LEFT JOIN public.cargo c ON c.id = v.cargo_id
      WHERE v.id::text = ANY($1::text[])`;
    const basica = `
      SELECT v.id::text AS id, v.cargo, v.atividades, NULL::text AS descricao, NULL::text AS requisitos, v.escolaridade::text AS escolaridade,
             v.carga_horaria::text AS carga_horaria, v.horario, v.tipo_vaga, NULL::text AS cargo_descricao, NULL::text AS cargo_requisitos
      FROM public.vaga v WHERE v.id::text = ANY($1::text[])`;
    let rows: LinhaVaga[];
    try {
      rows = (await this.db.query<LinhaVaga>(completa, [ids])).rows;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "42703" && code !== "42P01") throw error;
      rows = (await this.db.query<LinhaVaga>(basica, [ids])).rows;
    }
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Escolaridade da vaga é o id_flex do cadastro antigo; vira o nome quando dna_work.flex existe. Código sem nome não vai ao JEV. */
  private async nomesDeEscolaridade(codigos: string[]): Promise<Map<string, string>> {
    const numericos = [...new Set(codigos.filter((codigo) => /^\d+$/.test(codigo)))];
    if (!numericos.length) return new Map();
    try {
      const { rows } = await this.db.query<{ id: string; valor: string | null }>(
        "SELECT id_flex::text AS id, valor FROM dna_work.flex WHERE id_flex::text = ANY($1::text[])",
        [numericos],
      );
      return new Map(rows.filter((row) => texto(row.valor)).map((row) => [row.id, String(row.valor).trim()]));
    } catch {
      return new Map();
    }
  }

  private paraJev(linha: LinhaVaga, escolaridades: Map<string, string>): VagaParaJev {
    const codigo = texto(linha.escolaridade);
    const escolaridade = codigo ? (/^\d+$/.test(codigo) ? escolaridades.get(codigo) ?? null : codigo) : null;
    return {
      cargo: texto(linha.cargo) ?? "",
      atividades: texto(linha.atividades),
      descricao: texto(linha.descricao) ?? texto(linha.cargo_descricao),
      requisitos: texto(linha.requisitos) ?? texto(linha.cargo_requisitos),
      escolaridade,
      cargaHoraria: texto(linha.carga_horaria),
      horario: horarioDoEspelho(linha.horario),
      tipo: Number(linha.tipo_vaga) === 1 ? "Estágio" : "CLT",
    };
  }

  private async avaliarUma(id: string, vaga: VagaParaJev, curriculo: string): Promise<AvaliacaoVaga> {
    const explicacao = explicarCompatibilidade(curriculo, vaga);
    if (!this.jev.pronto) return { id, status: "indisponivel", motivo: this.jev.motivo, jev: null, explicacao };
    const controle = new AbortController();
    try {
      const bruto = await comTimeout(
        this.jev.transporte({ modelo: this.config.JEV_MODEL, estado: montarEstadoJev(curriculo, vaga), perguntas: [PERGUNTA_COMPATIBILIDADE] }, controle.signal),
        this.config.JEV_TIMEOUT_MS,
        controle,
      );
      return { id, status: "avaliada", motivo: null, jev: interpretarRespostaJev(bruto), explicacao };
    } catch (error) {
      if (error instanceof RespostaJevInvalida) return { id, status: "resposta_invalida", motivo: `Resposta do JEV descartada: ${error.message}`, jev: null, explicacao };
      const timeout = (error as { name?: string })?.name === "TimeoutError";
      return { id, status: "falhou", motivo: timeout ? "O JEV não respondeu a tempo." : "Falha ao consultar o JEV.", jev: null, explicacao };
    }
  }

  async avaliar(input: { perfil: Partial<PerfilProfissional>; vagaIds: string[] }): Promise<ResultadoCompatibilidade> {
    const ids = [...new Set(input.vagaIds)];
    const curriculo = textoDoCurriculo(input.perfil);
    const vagas = await this.carregarVagas(ids);
    const escolaridades = await this.nomesDeEscolaridade([...vagas.values()].map((linha) => texto(linha.escolaridade) ?? ""));
    const suficiente = perfilSuficiente(input.perfil);

    const avaliacoes = await mapComLimite(ids, this.config.JEV_CONCORRENCIA, async (id): Promise<AvaliacaoVaga> => {
      const linha = vagas.get(id);
      if (!linha) return { id, status: "nao_encontrada", motivo: "A vaga não está mais aberta.", jev: null, explicacao: null };
      const vaga = this.paraJev(linha, escolaridades);
      if (!vaga.cargo || !(vaga.atividades || vaga.descricao || vaga.requisitos)) {
        return { id, status: "dados_insuficientes", motivo: "A vaga não tem atividades, descrição nem requisitos cadastrados.", jev: null, explicacao: null };
      }
      if (!suficiente) {
        return { id, status: "dados_insuficientes", motivo: "Currículo com poucas informações profissionais. Complete o resumo, as experiências ou as habilidades.", jev: null, explicacao: null };
      }
      return this.avaliarUma(id, vaga, curriculo);
    });
    return { avaliacoes, jev: this.estadoJev() };
  }
}
