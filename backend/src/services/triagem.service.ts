import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { AppError } from "../lib/errors.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import { distanciaKm, geocodeCepServidor, rotuloDoCep, type Ponto } from "../lib/triagem-geo.js";
import { horariosPorCodigo } from "../lib/triagem-horario.js";
import { vagasDoNotion } from "../lib/triagem-notion.js";

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
  schedule: string | null;
  schedules: string[];
  distanceKm: number;
};

export type EmpresaPendente = { nome: string; cnpj: string; vagas: number };

type JobEnriched = {
  id: string;
  source_job_id: string | null;
  title: string | null;
  company_name: string | null;
  location: string | null;
  contract_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  benefits: string | null;
  latitude: number | null;
  longitude: number | null;
};

type PerfilVaga = { sexo: string; idadeMin: number | null; idadeMax: number | null };

const PAGINA = 1000;

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function digits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function inteiro(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function chaveDeduplicacao(vaga: VagaProxima) {
  const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  return [vaga.title, vaga.company, vaga.location, vaga.contractType, vaga.salaryLabel].map(norm).join("|") + `|${vaga.hasBenefits}`;
}

export class TriagemService {
  constructor(
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
  ) {}

  private rest() {
    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new AppError(503, "SUPABASE_NAO_CONFIGURADO", "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
    }
    return supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
  }

  private async todasAsLinhas<T>(caminho: string): Promise<T[]> {
    const rest = this.rest();
    const linhas: T[] = [];
    for (let offset = 0; ; offset += PAGINA) {
      const pagina = await rest.get<T[]>(`${caminho}&limit=${PAGINA}&offset=${offset}`);
      linhas.push(...pagina);
      if (pagina.length < PAGINA) return linhas;
    }
  }

  private async vagasComCoordenada(tipos: TipoVaga[]) {
    const filtroTipo = encodeURIComponent(`(${tipos.map((tipo) => `"${tipo}"`).join(",")})`);
    return this.todasAsLinhas<JobEnriched>(
      "jobs_enriched?select=id,source_job_id,title,company_name,location,contract_type,salary_min,salary_max,benefits,latitude,longitude"
      + `&latitude=not.is.null&longitude=not.is.null&contract_type=in.${filtroTipo}&order=id`,
    );
  }

  private async codigosDosJobs(ids: string[]) {
    const codigos = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const rows = await this.rest().get<Array<{ id: string; codigo: string | null }>>(`jobs?select=id,codigo&id=in.(${lote.join(",")})`);
      for (const row of rows) {
        const codigo = row.codigo?.trim().toUpperCase();
        if (codigo) codigos.set(row.id, codigo);
      }
    }
    return codigos;
  }

  /** Sexo e faixa de idade das vagas abertas no Lightsail. Só lê. */
  private async perfisAbertos(codigos: string[]) {
    if (!this.mysql) throw new AppError(503, "MYSQL_NAO_CONFIGURADO", "Defina as credenciais DNA_WORK_DB para filtrar por sexo ou idade.");
    const perfis = new Map<string, PerfilVaga[]>();
    if (!codigos.length) return perfis;
    const [rows] = await this.mysql.query<RowDataPacket[]>(
      "SELECT codigo, sexo, idade, idadeate FROM vaga WHERE status = 0 AND codigo IN (?)",
      [codigos],
    );
    for (const row of rows) {
      const codigo = String(row.codigo ?? "").trim().toUpperCase();
      const lista = perfis.get(codigo) ?? [];
      lista.push({ sexo: String(row.sexo ?? "").trim().toUpperCase(), idadeMin: inteiro(row.idade), idadeMax: inteiro(row.idadeate) });
      perfis.set(codigo, lista);
    }
    return perfis;
  }

  private async origem(input: BuscaTriagem): Promise<Ponto> {
    if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng };
    const ponto = await geocodeCepServidor(input.cep, this.config.GOOGLE_MAPS_API_KEY);
    if (!ponto) throw new AppError(422, "CEP_NAO_LOCALIZADO", "Não foi possível localizar esse CEP.");
    return ponto;
  }

  async buscar(input: BuscaTriagem) {
    const [origem, originLabel, vagas, horarios, notion] = await Promise.all([
      this.origem(input),
      rotuloDoCep(input.cep),
      this.vagasComCoordenada(input.tipos),
      horariosPorCodigo(),
      vagasDoNotion(this.config.NOTION_TOKEN),
    ]);

    const noRaio = vagas
      .map((vaga) => ({ vaga, distancia: distanciaKm(origem, { lat: Number(vaga.latitude), lng: Number(vaga.longitude) }) }))
      .filter((item) => Number.isFinite(item.distancia) && item.distancia <= input.raioKm);

    const ids = [...new Set(noRaio.map((item) => item.vaga.source_job_id).filter((id): id is string => Boolean(id)))];
    const codigos = ids.length ? await this.codigosDosJobs(ids) : new Map<string, string>();

    const filtraPerfil = Boolean(input.sexo) || input.idade != null;
    const perfis = filtraPerfil ? await this.perfisAbertos([...new Set(codigos.values())]) : new Map<string, PerfilVaga[]>();

    const candidatas: VagaProxima[] = [];
    for (const { vaga, distancia } of noRaio) {
      const codigo = vaga.source_job_id ? codigos.get(vaga.source_job_id) : undefined;
      if (codigo && filtraPerfil) {
        const lista = perfis.get(codigo) ?? [];
        const passa = (perfil: PerfilVaga | undefined) => {
          if (input.sexo && perfil && perfil.sexo && perfil.sexo !== "I" && perfil.sexo !== input.sexo) return false;
          if (input.idade != null) {
            if (!perfil) return false;
            if (perfil.idadeMin != null && input.idade < perfil.idadeMin) return false;
            if (perfil.idadeMax != null && input.idade > perfil.idadeMax) return false;
          }
          return true;
        };
        if (lista.length ? !lista.some(passa) : !passa(undefined)) continue;
      }
      const salario = Number(vaga.salary_max) || Number(vaga.salary_min) || 0;
      // Código na página Operacional: horário e bairro saem do Notion; senão, webhook e jobs_enriched.
      const doNotion = codigo ? notion.get(codigo) : undefined;
      const horarioWebhook = codigo ? horarios.get(codigo) ?? null : null;
      const schedules = doNotion?.horarios.length ? [...doNotion.horarios] : horarioWebhook ? [horarioWebhook] : [];
      candidatas.push({
        id: vaga.id,
        title: vaga.title?.trim() || "Vaga",
        company: vaga.company_name?.trim() || "",
        location: doNotion?.local || vaga.location?.trim() || "",
        contractType: vaga.contract_type?.trim() || "",
        salaryLabel: salario > 0 ? moeda.format(salario) : "salário a combinar",
        hasBenefits: Boolean(vaga.benefits?.trim()),
        schedule: schedules[0] ?? null,
        schedules,
        distanceKm: Math.round(distancia * 10) / 10,
      });
    }

    candidatas.sort((a, b) => a.distanceKm - b.distanceKm);
    const unicas = new Map<string, VagaProxima>();
    for (const vaga of candidatas) {
      const chave = chaveDeduplicacao(vaga);
      const existente = unicas.get(chave);
      if (!existente) {
        unicas.set(chave, vaga);
        continue;
      }
      for (const horario of vaga.schedules) {
        if (!existente.schedules.includes(horario)) existente.schedules.push(horario);
      }
      existente.schedule ??= vaga.schedule;
    }

    return { originLabel, jobs: [...unicas.values()] };
  }

  /** Empresas do agente (sede 10) com vaga aberta no Lightsail que ainda não estão no Supabase. */
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
      (await this.todasAsLinhas<{ cnpj: string | null }>("empresa?select=cnpj&order=id")).map((row) => digits(row.cnpj)).filter(Boolean),
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
