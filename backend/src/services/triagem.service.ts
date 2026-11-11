import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { AppError } from "../lib/errors.js";
import { distanciaKm, geocodeCepServidor, rotuloDoCep, type Ponto } from "../lib/triagem-geo.js";
import type { Pool } from "pg";
import { DIAS_ESCALA, textoDoHorario } from "../lib/horario-escala.js";

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
};

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
  latitude: number | null;
  longitude: number | null;
  nome_fantasia: string | null;
  local: string | null;
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

export class TriagemService {
  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
  ) {}

  /** Vagas abertas do Postgres (public.vaga) com a empresa: só as dos tipos pedidos e com coordenada. */
  private async vagasAbertas(tipos: TipoVaga[]) {
    const codigos = tipos.map((tipo) => (tipo === "Estágio" ? 1 : 2));
    const { rows } = await this.db.query<VagaPostgres>(
      `SELECT v.id::text AS id, v.vaga_id::text AS vaga_id, v.tipo_vaga, v.cargo, v.salario, v.beneficios, v.sexo, v.idade, v.idade_ate,
              v.horario, v.tipo_trabalho, v.latitude, v.longitude, e.nome_fantasia, e.local
       FROM public.vaga v
       LEFT JOIN public.empresa e ON e.id = v.empresa_id
       WHERE v.tipo_vaga = ANY($1::int[]) AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL`,
      [codigos],
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
    const [origem, originLabel, vagas] = await Promise.all([
      this.origem(input),
      rotuloDoCep(input.cep),
      this.vagasAbertas(input.tipos),
    ]);

    const candidatas: Array<VagaProxima & { grupo: string }> = [];
    for (const vaga of vagas) {
      const distancia = distanciaKm(origem, { lat: Number(vaga.latitude), lng: Number(vaga.longitude) });
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
      });
    }

    // Mesmo vaga_id = mesma empresa e mesmos detalhes: mostra uma vez só, a unidade mais próxima.
    candidatas.sort((a, b) => a.distanceKm - b.distanceKm);
    const unicas = new Map<string, VagaProxima>();
    for (const { grupo, ...vaga } of candidatas) if (!unicas.has(grupo)) unicas.set(grupo, vaga);
    return { originLabel, jobs: [...unicas.values()] };
  }

  /** Empresas do agente (sede 10) com vaga aberta no Lightsail que ainda não estão em public.empresa. */
  async empresasPendentes(): Promise<EmpresaPendente[]> {
    if (!this.mysql) return [];
    const [rows] = await this.mysql.query<RowDataPacket[]>(`
      SELECT e.nome_fantasia, e.razao_social, e.cnpj, COUNT(*) AS vagas
      FROM empresa e
      JOIN vaga v ON v.id_empresa = e.id_empresa
      WHERE e.sede = 10 AND v.status = 0
      GROUP BY e.id_empresa, e.nome_fantasia, e.razao_social, e.cnpj
      ORDER BY e.nome_fantasia, e.razao_social
    `);
    if (!rows.length) return [];
    const cadastradas = new Set(
      (await this.db.query<{ cnpj: string | null }>("SELECT cnpj FROM public.empresa")).rows.map((row) => digits(row.cnpj)).filter(Boolean),
    );
    return rows
      .filter((row) => !cadastradas.has(digits(String(row.cnpj ?? ""))))
      .map((row) => ({
        nome: String(row.nome_fantasia || row.razao_social || "").trim(),
        cnpj: String(row.cnpj ?? "").trim(),
        vagas: Number(row.vagas) || 0,
      }));
  }
}
