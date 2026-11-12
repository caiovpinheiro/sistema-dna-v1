import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { AppError } from "../lib/errors.js";
import { distanciaKm, geocodeCepServidor, rotuloDoCep, type Ponto } from "../lib/triagem-geo.js";
import type { Pool } from "pg";
import { DIAS_ESCALA, textoDoHorario } from "../lib/horario-escala.js";
import { sincronizarEnderecoEmpresas } from "../lib/empresa-endereco.js";
import type { Logger } from "./notion-sync.service.js";

export type TipoVaga = "CLT" | "Estágio";

export type BuscaTriagem = {
  cep: string;
  raioKm: number;
  tipos: TipoVaga[];
  sexo?: "M" | "F";
  idade?: number;
  lat?: number;
  lng?: number;
};

export type VagaProxima = {
  id: string;
  title: string;
  company: string;
  location: string;
  contractType: string;
  salaryLabel: string;
  hasBenefits: boolean;
  /** Vaga em home office (tipo de trabalho "remoto" no cadastro). */
  homeOffice: boolean;
  schedule: string | null;
  schedules: string[];
  distanceKm: number;
  /** Prioridade da vaga em /vagas (dna_work.vaga.prioridade): "alta" vem primeiro na busca e "baixa" por último. */
  prioridade: Prioridade;
};

export type Prioridade = "alta" | "media" | "baixa";

export type EmpresaPendente = { nome: string; cnpj: string; vagas: number };

type VagaPostgres = {
  id: string;
  vaga_id: string | null;
  tipo_vaga: number | null;
  cargo: string | null;
  salario: string | number | null;
  beneficios: string | null;
  sexo: string | null;
  idade: number | null;
  idade_ate: number | null;
  horario: string | null;
  tipo_trabalho: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
  nome_fantasia: string | null;
  local: string | null;
  prioridade: string | null;
};

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function inteiro(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Horário da vaga no espelho: o texto ("texto=…") quando existe; senão, a grade por dia (1 domingo … 7 sábado). */
export function horarioDoEspelho(horario: string | null | undefined): string | null {
  const bruto = String(horario ?? "");
  const texto = bruto.match(/(?:^|;)texto=([\s\S]*)$/)?.[1]?.trim();
  if (texto) return texto;
  const porDia = new Map<number, { entrada: string; saida: string }>();
  for (const [, dia, entrada, saida] of bruto.matchAll(/(?:^|;)([1-7])=(\d{2}:\d{2})-(\d{2}:\d{2})/g)) {
    porDia.set(Number(dia), { entrada, saida });
  }
  // DIAS_ESCALA começa na segunda; na grade, 2 é segunda e 1 é domingo.
  const dias = DIAS_ESCALA.map((_, indice) => {
    const faixa = porDia.get(indice === 6 ? 1 : indice + 2);
    return faixa ? { modo: "fixo" as const, ...faixa } : { modo: "folga" as const, entrada: "", saida: "" };
  });
  return porDia.size ? textoDoHorario(dias) || null : null;
}

/** Tira do horário o trecho "home office" ("…, 4 horas. Home Office." vira "…, 4 horas."). */
export function semHomeOffice(horario: string | null): string | null {
  if (!horario) return horario;
  const limpo = horario
    .replace(/[\s.,;:–-]*\b(?:vaga\s+(?:em\s+)?)?home[\s-]*office\b[\s.]*/gi, ". ")
    .replace(/\s*\.\s*\.\s*/g, ". ")
    .replace(/[\s.;,]+$/, "")
    .trim();
  return limpo ? (/[.!?]$/.test(horario.trim()) ? `${limpo}.` : limpo) : null;
}

/** "Barra Funda - São Paulo / SP" vira "Barra Funda, São Paulo SP". */
export function localDaEmpresa(local: string | null | undefined): string {
  return String(local ?? "").replace(/\s+/g, " ").trim().replace(/\s+-\s+/, ", ").replace(/\s*\/\s*/, " ");
}

function prioridadeDe(valor: string | null | undefined): Prioridade {
  return valor === "alta" || valor === "baixa" ? valor : "media";
}

/** Posição da faixa de prioridade na busca: alta (0) no topo, média (1) no meio, baixa (2) no fim. */
export const FAIXA_PRIORIDADE: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

/**
 * Ordem final da busca, depois dos filtros (raio, sexo, idade):
 * - mesmo vaga_id = mesma empresa e mesmos detalhes: mostra uma vez só, a unidade mais próxima;
 *   o grupo fica com a maior prioridade entre as unidades dele (uma alta basta para o grupo ser alta);
 * - prioridade alta no topo, média no meio, baixa no fim; dentro de cada faixa vale a ordem normal (distância).
 */
export function ordenarResultado(candidatas: Array<VagaProxima & { grupo: string }>): VagaProxima[] {
  const ordenadas = [...candidatas].sort((a, b) => a.distanceKm - b.distanceKm);
  const doGrupo = new Map<string, Prioridade>();
  for (const vaga of ordenadas) {
    const atual = doGrupo.get(vaga.grupo);
    if (!atual || FAIXA_PRIORIDADE[vaga.prioridade] < FAIXA_PRIORIDADE[atual]) doGrupo.set(vaga.grupo, vaga.prioridade);
  }
  const unicas = new Map<string, VagaProxima>();
  for (const { grupo, ...vaga } of ordenadas) {
    if (!unicas.has(grupo)) unicas.set(grupo, { ...vaga, prioridade: doGrupo.get(grupo)! });
  }
  // sort estável: dentro da mesma faixa fica a ordem por distância.
  return [...unicas.values()].sort((a, b) => FAIXA_PRIORIDADE[a.prioridade] - FAIXA_PRIORIDADE[b.prioridade]);
}

/**
 * Mesmo CEP da pessoa é 0 km: o ponto da pessoa vem do centro do CEP e o da empresa do endereço completo,
 * e os dois serviços chegam a divergir em mais de 1 km para o mesmo endereço.
 */
export function distanciaDaVaga(origem: Ponto, cep: string, vaga: { cep: string | null; latitude: number | string | null; longitude: number | string | null }): number {
  const cepPessoa = digits(cep);
  if (cepPessoa.length === 8 && digits(vaga.cep) === cepPessoa) return 0;
  if (vaga.latitude == null || vaga.longitude == null) return Number.NaN;
  return distanciaKm(origem, { lat: Number(vaga.latitude), lng: Number(vaga.longitude) });
}

export class TriagemService {
  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
    private readonly log?: Logger,
  ) {}

  /**
   * Antes de medir, traz para public.empresa e public.vaga o endereço atual da ficha (dna_work.empresa).
   * Sem divergência é só uma consulta; com divergência, geocodifica só as empresas que mudaram.
   * Falha aqui não impede a busca.
   */
  private async enderecosAtualizados() {
    if (!this.log) return;
    await sincronizarEnderecoEmpresas(this.db, this.config.GOOGLE_MAPS_API_KEY, this.log).catch((error: unknown) =>
      this.log!.error({ erro: error instanceof Error ? error.message : String(error) }, "triagem: falha ao conferir o endereço das empresas"));
  }

  /** Vagas abertas do Postgres (public.vaga) com a empresa: só as dos tipos pedidos e com coordenada (ou no mesmo CEP da pessoa). */
  private async vagasAbertas(tipos: TipoVaga[], cep: string) {
    const codigos = tipos.map((tipo) => (tipo === "Estágio" ? 1 : 2));
    const { rows } = await this.db.query<VagaPostgres>(
      `SELECT v.id::text AS id, v.vaga_id::text AS vaga_id, v.tipo_vaga, v.cargo, v.salario, v.beneficios, v.sexo, v.idade, v.idade_ate,
              v.horario, v.tipo_trabalho, v.cep, v.latitude, v.longitude, e.nome_fantasia, e.local, dv.prioridade
       FROM public.vaga v
       LEFT JOIN public.empresa e ON e.id = v.empresa_id
       LEFT JOIN dna_work.vaga dv ON dv.id_vaga = v.id::text
       WHERE v.tipo_vaga = ANY($1::int[])
         AND ((v.latitude IS NOT NULL AND v.longitude IS NOT NULL) OR regexp_replace(coalesce(v.cep, ''), '\\D', '', 'g') = $2)`,
      [codigos, digits(cep)],
    );
    return rows;
  }

  private async origem(input: BuscaTriagem): Promise<Ponto> {
    if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng };
    const ponto = await geocodeCepServidor(input.cep, this.config.GOOGLE_MAPS_API_KEY);
    if (!ponto) throw new AppError(422, "CEP_NAO_LOCALIZADO", "Não foi possível localizar esse CEP.");
    return ponto;
  }

  async buscar(input: BuscaTriagem) {
    await this.enderecosAtualizados();
    const [origem, originLabel, vagas] = await Promise.all([
      this.origem(input),
      rotuloDoCep(input.cep),
      this.vagasAbertas(input.tipos, input.cep),
    ]);

    const candidatas: Array<VagaProxima & { grupo: string }> = [];
    for (const vaga of vagas) {
      const distancia = distanciaDaVaga(origem, input.cep, vaga);
      if (!Number.isFinite(distancia) || distancia > input.raioKm) continue;
      const sexo = String(vaga.sexo ?? "").trim().toUpperCase();
      if (input.sexo && sexo && sexo !== "I" && sexo !== input.sexo) continue;
      if (input.idade != null) {
        const minima = inteiro(vaga.idade);
        const maxima = inteiro(vaga.idade_ate);
        if (minima != null && input.idade < minima) continue;
        if (maxima != null && input.idade > maxima) continue;
      }
      const salario = Number(vaga.salario) || 0;
      const homeOffice = vaga.tipo_trabalho === "remoto";
      // Home office tem linha própria: não repete no horário.
      const horario = homeOffice ? semHomeOffice(horarioDoEspelho(vaga.horario)) : horarioDoEspelho(vaga.horario);
      candidatas.push({
        id: vaga.id,
        grupo: vaga.vaga_id || vaga.id,
        title: vaga.cargo?.trim() || "Vaga",
        company: vaga.nome_fantasia?.trim() || "",
        location: localDaEmpresa(vaga.local),
        contractType: Number(vaga.tipo_vaga) === 1 ? "Estágio" : "CLT",
        salaryLabel: salario > 0 ? moeda.format(salario) : "salário a combinar",
        hasBenefits: Boolean(vaga.beneficios?.trim()),
        homeOffice,
        schedule: horario,
        schedules: horario ? [horario] : [],
        distanceKm: Math.round(distancia * 10) / 10,
        prioridade: prioridadeDe(vaga.prioridade),
      });
    }

    return { originLabel, jobs: ordenarResultado(candidatas) };
  }

  /** Empresas do agente (sede 10) com vaga aberta no Lightsail que ainda não estão em public.empresa. */
  async empresasPendentes(): Promise<EmpresaPendente[]> {
    if (!this.mysql) return [];
    const [rows] = await this.mysql.query<RowDataPacket[]>(`
      SELECT e.id_empresa, e.nome_fantasia, e.razao_social, e.cnpj, COUNT(*) AS vagas
      FROM empresa e
      JOIN vaga v ON v.id_empresa = e.id_empresa
      WHERE e.sede = 10 AND v.status = 0
      GROUP BY e.id_empresa, e.nome_fantasia, e.razao_social, e.cnpj
      ORDER BY e.nome_fantasia, e.razao_social
    `);
    if (!rows.length) return [];
    // Compara pelo id (empresa sem CNPJ) e pelo CNPJ (empresa reativada com outro id).
    const noPostgres = (await this.db.query<{ id: string; cnpj: string | null }>("SELECT id::text AS id, cnpj FROM public.empresa")).rows;
    const ids = new Set(noPostgres.map((row) => row.id));
    const cadastradas = new Set(noPostgres.map((row) => digits(row.cnpj)).filter(Boolean));
    return rows
      .filter((row) => !ids.has(String(row.id_empresa)))
      .filter((row) => {
        const cnpj = digits(String(row.cnpj ?? ""));
        return !cnpj || !cadastradas.has(cnpj);
      })
      .map((row) => ({
        nome: String(row.nome_fantasia || row.razao_social || "").trim(),
        cnpj: String(row.cnpj ?? "").trim(),
        vagas: Number(row.vagas) || 0,
      }));
  }
}
