import { DIAS_ESCALA, diasDoTexto, textoDoHorario, type DiaEscala } from "../lib/horario-escala.js";
import { randomUUID, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { legacyToday } from "../lib/dates.js";
import { AppError } from "../lib/errors.js";
import { faixaDaSemana, horarioDe } from "./vagas-abertas-sync.service.js";
import { formatMoneyLegacy, moneyToNumber, parseMoney } from "../lib/money.js";
import type { CargoService } from "./cargo.service.js";
import { chaveCargo } from "../lib/cargo.js";
import { reagruparVagaIds } from "../lib/vaga-id.js";
import type { EmpresaCadastro, GrupoCreate, ModeloVaga, VagaCadastro } from "../schemas/cadastro.js";

type GrupoRow = { id: string; nome: string; email: string | null; telefone: string | null; criado_em: string };
type EmpresaRow = {
  id: string;
  grupo_id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  local: string | null;
  latitude: number | null;
  longitude: number | null;
};

const MIRROR_SQL = `
CREATE TABLE IF NOT EXISTS public.grupo (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  email text,
  telefone text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.empresa (
  id uuid PRIMARY KEY,
  grupo_id uuid NOT NULL REFERENCES public.grupo (id),
  cnpj text NOT NULL,
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL,
  email text,
  telefone text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  cep text,
  logradouro text,
  numero text,
  complemento text,
  latitude double precision,
  longitude double precision,
  local text
);
CREATE UNIQUE INDEX IF NOT EXISTS empresa_cnpj_digitos ON public.empresa (regexp_replace(cnpj, '\\D', '', 'g'));
CREATE TABLE IF NOT EXISTS public.vaga (
  id uuid PRIMARY KEY,
  vaga_id uuid NOT NULL,
  grupo_id uuid NOT NULL REFERENCES public.grupo (id),
  empresa_id uuid NOT NULL REFERENCES public.empresa (id),
  tipo_vaga integer NOT NULL,
  cargo text NOT NULL,
  salario numeric,
  carga_horaria text,
  escolaridade text,
  sexo text,
  idade integer,
  idade_ate integer,
  km numeric,
  atividades text,
  tempo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  horario text,
  turno text,
  beneficios text,
  conducoes text,
  jornada text,
  tipo_trabalho text,
  cep text,
  latitude double precision,
  longitude double precision
);
CREATE TABLE IF NOT EXISTS public.vaga_repetida (
  id uuid PRIMARY KEY,
  vaga_id uuid NOT NULL,
  grupo_id uuid,
  empresa_id uuid,
  tipo_vaga text,
  cargo text,
  salario numeric,
  carga_horaria text,
  escolaridade text,
  sexo text,
  idade integer,
  idade_ate integer,
  km numeric,
  atividades text,
  tempo text,
  horario text,
  turno text,
  beneficios text,
  conducoes text,
  jornada text,
  tipo_trabalho text,
  cep text,
  latitude double precision,
  longitude double precision
);
CREATE TABLE IF NOT EXISTS public.cargo (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  chave text NOT NULL,
  descricao text,
  requisitos text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cargo_chave_unica ON public.cargo (chave);
ALTER TABLE public.vaga ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS descricao text, ADD COLUMN IF NOT EXISTS requisitos text;
ALTER TABLE public.vaga_repetida ADD COLUMN IF NOT EXISTS cargo_id uuid REFERENCES public.cargo (id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS descricao text, ADD COLUMN IF NOT EXISTS requisitos text;
CREATE INDEX IF NOT EXISTS vaga_cargo_id ON public.vaga (cargo_id);
CREATE INDEX IF NOT EXISTS vaga_repetida_cargo_id ON public.vaga_repetida (cargo_id);
`;

function maskCnpj(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function semAcento(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

/** "Rua X, 123 - Bairro, Cidade - UF, 00000-000, Brasil": o endereço inteiro, para o Google achar o ponto certo. */
export function enderecoParaGeocode(partes: { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null }) {
  const limpo = (valor: string | null | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();
  const rua = [limpo(partes.logradouro), limpo(partes.numero)].filter(Boolean).join(", ");
  const cidadeUf = [limpo(partes.cidade), limpo(partes.uf).toUpperCase()].filter(Boolean).join(" - ");
  const digitos = limpo(partes.cep).replace(/\D/g, "");
  const cep = digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : "";
  const trechos = [[rua, limpo(partes.bairro)].filter(Boolean).join(" - "), cidadeUf, cep].filter(Boolean);
  return rua && cidadeUf ? `${trechos.join(", ")}, Brasil` : "";
}

function localDe(bairro: string, cidade: string, uf: string) {
  return `${bairro} - ${cidade} / ${uf.toUpperCase()}`;
}

function horaInformada(input: ModeloVaga, nome: string, fallback: string | null) {
  const value = (input as unknown as Record<string, string | undefined>)[nome];
  return value || fallback;
}

function horasDaVaga(input: ModeloVaga) {
  const entrada = input.horario_entrada;
  const saida = input.horario_saida;
  const horas = {
    entrada,
    saida,
    segunda_entrada: horaInformada(input, "segunda_entrada", entrada),
    segunda_saida: horaInformada(input, "segunda_saida", saida),
    terca_entrada: horaInformada(input, "terca_entrada", entrada),
    terca_saida: horaInformada(input, "terca_saida", saida),
    quarta_entrada: horaInformada(input, "quarta_entrada", entrada),
    quarta_saida: horaInformada(input, "quarta_saida", saida),
    quinta_entrada: horaInformada(input, "quinta_entrada", entrada),
    quinta_saida: horaInformada(input, "quinta_saida", saida),
    sexta_entrada: horaInformada(input, "sexta_entrada", entrada),
    sexta_saida: horaInformada(input, "sexta_saida", saida),
    sab_entrada: horaInformada(input, "sab_entrada", null),
    sab_saida: horaInformada(input, "sab_saida", null),
    domingo_entrada: horaInformada(input, "domingo_entrada", null),
    domingo_saida: horaInformada(input, "domingo_saida", null),
  };
  // Folga grava "0", como o Lightsail já marca dia sem trabalho.
  const folga = new Set(input.folga ?? []);
  for (const dia of folga) {
    horas[`${dia}_entrada`] = "0";
    horas[`${dia}_saida`] = "0";
  }
  return horas;
}

/** Texto do horário com os dias de escala. Sem escala nem folga em dia útil, fica o formato de sempre ("08:00 às 17:00"). */
function textoDaVaga(input: ModeloVaga, horas: ReturnType<typeof horasDaVaga>) {
  const escala = new Set(input.escala ?? []);
  const folga = new Set(input.folga ?? []);
  const especial = escala.size > 0 || ["segunda", "terca", "quarta", "quinta", "sexta"].some((dia) => folga.has(dia as DiaEscala));
  if (!especial) return `${horas.entrada} às ${horas.saida}`;
  return textoDoHorario(DIAS_ESCALA.map((dia) => ({
    modo: folga.has(dia) ? "folga" : escala.has(dia) ? "escala" : "fixo",
    entrada: horas[`${dia}_entrada`] ?? "",
    saida: horas[`${dia}_saida`] ?? "",
  })));
}

/** O modelo guarda sempre o texto por dia ("Segunda a sexta, 08:00 às 17:00; sábado, 08:00 às 12:00"): assim volta inteiro ao abrir. */
function textoDoModelo(input: ModeloVaga, horas: ReturnType<typeof horasDaVaga>) {
  const escala = new Set(input.escala ?? []);
  const folga = new Set(input.folga ?? []);
  return textoDoHorario(DIAS_ESCALA.map((dia) => ({
    modo: folga.has(dia) ? "folga" : escala.has(dia) ? "escala" : "fixo",
    entrada: horas[`${dia}_entrada`] ?? "",
    saida: horas[`${dia}_saida`] ?? "",
  })));
}

const TIPO_MODELO: Record<string, string> = { "1": "Estágio", "2": "CLT", "4": "Pessoa Jurídica" };

type RepetidaLinha = {
  id: string;
  vaga_id: string;
  empresa_id: string | null;
  grupo_id: string | null;
  tipo_vaga: string | number | null;
  cargo: string | null;
  salario: number | string | null;
  carga_horaria: string | null;
  sexo: string | null;
  idade: number | null;
  idade_ate: number | null;
  atividades: string | null;
  horario: string | null;
  cargo_id: string | null;
  descricao: string | null;
  requisitos: string | null;
  beneficios?: string | null;
  empresa_nome?: string | null;
};

function atividadesLegiveis(valor: string | null) {
  return (valor ?? "").replace(/,(\S)/g, ", $1").replace(/,\s*$/g, "").trim();
}

const CAMPOS_REPETIDA = "id, vaga_id, empresa_id, grupo_id, tipo_vaga, cargo, salario, carga_horaria, sexo, idade, idade_ate, atividades, horario, cargo_id, descricao, requisitos, beneficios";
const DIAS_HORARIO = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sab"] as const;
type DiaHorario = (typeof DIAS_HORARIO)[number];

function horarioPartes(horario: string | null) {
  const match = horario?.match(/(\d{2}:\d{2})\s*(?:às|as|-)\s*(\d{2}:\d{2})/i);
  return { entrada: match?.[1] ?? "", saida: match?.[2] ?? "" };
}

function agendaDoHorario(horario: string | null) {
  const vazio = { entrada: "", saida: "" };
  const agenda = Object.fromEntries(DIAS_HORARIO.map((dia) => [dia, { ...vazio }])) as Record<DiaHorario, { entrada: string; saida: string }>;
  const slots = [...(horario ?? "").matchAll(/(?:^|;)([1-7])=(\d{2}:\d{2})-(\d{2}:\d{2})/g)];
  if (slots.length) {
    for (const slot of slots) {
      const nome = DIAS_HORARIO[Number(slot[1]) - 1];
      if (nome) agenda[nome] = { entrada: slot[2] ?? "", saida: slot[3] ?? "" };
    }
  } else {
    const partes = horarioPartes(horario);
    if (partes.entrada) {
      for (const dia of ["segunda", "terca", "quarta", "quinta", "sexta"] as const) agenda[dia] = { ...partes };
    }
  }
  const base = agenda.segunda.entrada
    ? agenda.segunda
    : DIAS_HORARIO.map((dia) => agenda[dia]).find((dia) => dia.entrada) ?? vazio;
  return { agenda, base };
}

function minutosRelogio(hora: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function horasDaAgenda(agenda: Record<DiaHorario, { entrada: string; saida: string }>) {
  let minutos = 0;
  for (const dia of DIAS_HORARIO) {
    const inicio = minutosRelogio(agenda[dia].entrada);
    const fim = minutosRelogio(agenda[dia].saida);
    if (inicio == null || fim == null) continue;
    let diff = fim - inicio;
    if (diff <= 0) diff += 24 * 60;
    minutos += diff;
  }
  return minutos / 60;
}

function cargaCalculada(tipo: "clt" | "estagio", horas: number) {
  if (horas <= 0) return "";
  if (tipo === "clt") return horas >= 42 ? "44" : "40";
  return horas >= 25 ? "30" : "20";
}

function salarioTexto(valor: number | string | null) {
  if (valor == null || valor === "") return "";
  const numero = typeof valor === "number" ? valor : moneyToNumber(String(valor));
  return numero == null ? "" : formatMoneyLegacy(numero);
}

function formularioDaLinha(row: RepetidaLinha) {
  const porDia = diasDoTexto(row.horario);
  let { agenda, base } = agendaDoHorario(row.horario);
  let fixos = agenda;
  const escala: DiaEscala[] = [];
  const folga: DiaEscala[] = [];
  if (porDia) {
    // Texto por dia (modelos novos e vagas com escala): cada dia volta com o seu tipo.
    const vazio = { entrada: "", saida: "" };
    agenda = Object.fromEntries(DIAS_HORARIO.map((dia) => [dia, { ...vazio }])) as typeof agenda;
    fixos = Object.fromEntries(DIAS_HORARIO.map((dia) => [dia, { ...vazio }])) as typeof agenda;
    DIAS_ESCALA.forEach((dia, indice) => {
      const valor = porDia[indice];
      if (valor.modo === "folga") folga.push(dia);
      else agenda[dia] = { entrada: valor.entrada, saida: valor.saida };
      if (valor.modo === "escala") escala.push(dia);
      if (valor.modo === "fixo") fixos[dia] = { entrada: valor.entrada, saida: valor.saida };
    });
    base = DIAS_ESCALA.map((dia, indice) => porDia[indice].modo === "fixo" ? agenda[dia] : null).find((dia) => dia?.entrada)
      ?? DIAS_HORARIO.map((dia) => agenda[dia]).find((dia) => dia.entrada) ?? vazio;
  }
  const tipo = String(row.tipo_vaga) === "2" ? "clt" : "estagio";
  const cargaBruta = String(row.carga_horaria ?? "").match(/\d+/)?.[0] ?? "";
  const cargaGuardada = cargaBruta === "20" || cargaBruta === "30" || cargaBruta === "40" || cargaBruta === "44" ? cargaBruta : "";
  // Escala não é toda semana: a carga conta só os dias fixos.
  const carga = cargaCalculada(tipo, horasDaAgenda(fixos)) || cargaGuardada;
  return {
    tipo,
    carga_horaria: carga,
    cargo: row.cargo ?? "",
    cargo_id: row.cargo_id ?? null,
    descricao: row.descricao ?? "",
    requisitos: row.requisitos ?? "",
    salario: salarioTexto(row.salario),
    horario_entrada: base.entrada,
    horario_saida: base.saida,
    sexo: row.sexo === "M" || row.sexo === "F" ? row.sexo : "I",
    idade: row.idade == null ? "" : String(row.idade),
    idade_ate: row.idade_ate == null ? "" : String(row.idade_ate),
    atividades: atividadesLegiveis(row.atividades),
    beneficios: row.beneficios ?? "",
    segunda_entrada: agenda.segunda.entrada,
    segunda_saida: agenda.segunda.saida,
    terca_entrada: agenda.terca.entrada,
    terca_saida: agenda.terca.saida,
    quarta_entrada: agenda.quarta.entrada,
    quarta_saida: agenda.quarta.saida,
    quinta_entrada: agenda.quinta.entrada,
    quinta_saida: agenda.quinta.saida,
    sexta_entrada: agenda.sexta.entrada,
    sexta_saida: agenda.sexta.saida,
    sab_entrada: agenda.sab.entrada,
    sab_saida: agenda.sab.saida,
    domingo_entrada: agenda.domingo.entrada,
    domingo_saida: agenda.domingo.saida,
    escala,
    folga,
  };
}

export class CadastroService {
  private mirror: Promise<void> | null = null;

  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
    private readonly cargos: CargoService,
  ) {}

  private mysqlPool() {
    if (!this.mysql) throw new AppError(503, "MYSQL_NAO_CONFIGURADO", "Defina as credenciais DNA_WORK_DB.");
    return this.mysql;
  }

  private ensureMirror() {
    if (!this.mirror) {
      this.mirror = (async () => {
        for (const statement of MIRROR_SQL.split(";").map((item) => item.trim()).filter(Boolean)) {
          await this.db.query(statement);
        }
      })().catch((error: unknown) => {
        this.mirror = null;
        const message = error instanceof Error ? error.message : "Falha ao preparar o Postgres.";
        throw new AppError(503, "POSTGRES_ESPELHO", message);
      });
    }
    return this.mirror;
  }

  async listarGrupos() {
    await this.ensureMirror();
    const { rows } = await this.db.query<GrupoRow>(
      "SELECT id::text AS id, nome, email, telefone, criado_em FROM public.grupo ORDER BY nome LIMIT 500",
    );
    return rows;
  }

  async obterGrupo(id: string) {
    await this.ensureMirror();
    const grupos = await this.db.query<GrupoRow>(
      "SELECT id::text AS id, nome, email, telefone, criado_em FROM public.grupo WHERE id::text = $1",
      [id],
    );
    const grupo = grupos.rows[0];
    if (!grupo) throw new AppError(404, "GRUPO_NAO_ENCONTRADO", "Grupo não encontrado.");
    const empresas = await this.db.query<EmpresaRow>(
      `SELECT id::text AS id, grupo_id::text AS grupo_id, cnpj, razao_social, nome_fantasia, email, telefone, cep, logradouro, numero, complemento, local
       FROM public.empresa WHERE grupo_id::text = $1 ORDER BY nome_fantasia`,
      [id],
    );
    return { ...grupo, empresas: empresas.rows };
  }

  async listarEmpresas() {
    await this.ensureMirror();
    const { rows } = await this.db.query<EmpresaRow>(
      `SELECT id::text AS id, grupo_id::text AS grupo_id, cnpj, razao_social, nome_fantasia, email, telefone, local
       FROM public.empresa ORDER BY nome_fantasia LIMIT 500`,
    );
    return rows;
  }

  /** Modelos globais: um por cargo e modalidade, para qualquer empresa. */
  async listarModelos() {
    await this.ensureMirror();
    const consulta = await this.db.query<RepetidaLinha>(
      `SELECT ${CAMPOS_REPETIDA} FROM public.vaga_repetida ORDER BY lower(cargo), tipo_vaga`,
    );
    return consulta.rows.map((row) => ({ vagaId: row.vaga_id, formulario: formularioDaLinha(row) }));
  }

  async obterModelo(vagaId: string) {
    await this.ensureMirror();
    const consulta = await this.db.query<RepetidaLinha>(
      `SELECT ${CAMPOS_REPETIDA} FROM public.vaga_repetida WHERE vaga_id = $1 LIMIT 1`,
      [vagaId],
    );
    const row = consulta.rows[0];
    if (!row) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo não encontrado.");
    return { vagaId: row.vaga_id, formulario: formularioDaLinha(row) };
  }

  async opcoesModelos() {
    await this.ensureMirror();
    const cargos = await this.db.query<{ cargo: string }>(
      `SELECT DISTINCT btrim(cargo) AS cargo
       FROM public.vaga_repetida
       WHERE cargo IS NOT NULL AND btrim(cargo) <> ''
       ORDER BY 1`,
    );
    return {
      cargos: cargos.rows.map((row) => row.cargo),
    };
  }

  async criarGrupo(input: GrupoCreate) {
    await this.ensureMirror();
    const id = randomUUID();
    const row = { id, nome: input.nome, email: input.email ?? null, telefone: input.telefone ?? null };
    try {
      await this.db.query(
        "INSERT INTO public.grupo (id, nome, email, telefone) VALUES ($1, $2, $3, $4)",
        [id, row.nome, row.email, row.telefone],
      );
    } catch (error) {
      throw this.falhaGravacao(error, "Não foi possível gravar o grupo no Postgres.");
    }
    return row;
  }

  async criarEmpresa(input: EmpresaCadastro) {
    await this.ensureMirror();
    const grupos = await this.db.query("SELECT 1 FROM public.grupo WHERE id::text = $1", [input.grupo_id]);
    if (!grupos.rowCount) throw new AppError(422, "GRUPO_OBRIGATORIO", "Escolha um grupo cadastrado nesta tela.");

    const digits = input.cnpj;
    const masked = maskCnpj(digits);
    const jaNoPostgres = await this.db.query<{ id: string }>(
      "SELECT id FROM public.empresa WHERE regexp_replace(cnpj, '\\D', '', 'g') = $1 LIMIT 1",
      [digits],
    );
    if (jaNoPostgres.rows[0]) {
      throw new AppError(409, "CNPJ_JA_CADASTRADO", "Este CNPJ já está no Postgres. O cadastro não foi duplicado.");
    }

    const mysql = this.mysqlPool();
    const [existentes] = await mysql.query<RowDataPacket[]>(
      `SELECT id_empresa FROM empresa
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(cnpj, ''), '.', ''), '/', ''), '-', ''), ' ', '') = ?`,
      [digits],
    );
    if (existentes.length > 1) {
      throw new AppError(409, "CNPJ_AMBIGUO", "Há mais de uma empresa no Lightsail com este CNPJ. Nada foi gravado.");
    }

    const reativar = existentes.length === 1;
    const id = reativar ? String(existentes[0].id_empresa) : randomUUID();
    const geo = await this.geocode(input.cep!, {
      logradouro: input.logradouro, numero: input.numero, bairro: input.bairro, cidade: input.cidade, uf: input.uf,
    });
    const local = localDe(input.bairro, input.cidade, input.uf);
    const payload = {
      id,
      grupo_id: input.grupo_id,
      cnpj: digits,
      razao_social: input.razao_social,
      nome_fantasia: input.nome_fantasia,
      email: input.email ?? null,
      telefone: input.telefone ?? null,
      cep: input.cep!,
      logradouro: input.logradouro,
      numero: input.numero || null,
      complemento: input.complemento || null,
      bairro: input.bairro,
      cidade: input.cidade,
      uf: input.uf.toUpperCase(),
      local,
      latitude: geo.lat,
      longitude: geo.lng,
    };

    const previa = await this.db.query(
      `SELECT razao_social, nome_fantasia, email, telefone, cep, logradouro, numero, complemento, bairro, cidade, uf, status, sede, matriz, lat, lng
       FROM dna_work.empresa WHERE id_empresa = $1`,
      [id],
    );
    const conn = await mysql.getConnection();
    let postgresOk = false;
    try {
      await conn.beginTransaction();
      if (reativar) {
        await conn.query(
          `UPDATE empresa SET razao_social=?, nome_fantasia=?, email=?, telefone=?, cep=?, logradouro=?, numero=?,
            complemento=?, bairro=?, cidade=?, uf=?, status=1, sede=10, matriz=?, lat=?, lng=?,
            razao_sem_acento=?, fantasia_sem_acento=? WHERE id_empresa=?`,
          [
            payload.razao_social, payload.nome_fantasia, payload.email, payload.telefone, payload.cep, payload.logradouro,
            payload.numero, payload.complemento, payload.bairro, payload.cidade, payload.uf, id,
            String(payload.latitude), String(payload.longitude), semAcento(payload.razao_social), semAcento(payload.nome_fantasia), id,
          ],
        );
      } else {
        await conn.query(
          `INSERT INTO empresa (
            id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, cep, logradouro, numero, complemento,
            bairro, cidade, uf, status, sede, tipo_empresa, matriz, usa_agente, lat, lng, razao_sem_acento, fantasia_sem_acento
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,10,1,?,1,?,?,?,?)`,
          [
            id, payload.razao_social, payload.nome_fantasia, masked, payload.email, payload.telefone, payload.cep,
            payload.logradouro, payload.numero, payload.complemento, payload.bairro, payload.cidade, payload.uf, id,
            String(payload.latitude), String(payload.longitude), semAcento(payload.razao_social), semAcento(payload.nome_fantasia),
          ],
        );
        await conn.query(
          `INSERT INTO assinaturas_empresa (id_empresa, tipo, responsavel, administrativo, rh, financeiro, supervisor)
           VALUES (?, 'TCE', 0, 0, 0, 0, 0), (?, 'Convenio', 0, 0, 0, 0, 0)`,
          [id, id],
        );
      }

      const pg = await this.db.connect();
      try {
        await pg.query("BEGIN");
        await pg.query(
          `INSERT INTO public.empresa (
            id, grupo_id, cnpj, razao_social, nome_fantasia, email, telefone, cep, logradouro, numero, complemento, latitude, longitude, local
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            id, payload.grupo_id, digits, payload.razao_social, payload.nome_fantasia, payload.email, payload.telefone,
            payload.cep, payload.logradouro, payload.numero, payload.complemento, payload.latitude, payload.longitude, local,
          ],
        );
        await this.gravarEmpresaLightsailNoPostgres(pg, payload, masked);
        await pg.query("COMMIT");
        postgresOk = true;
      } catch (error) {
        await pg.query("ROLLBACK");
        throw error;
      } finally {
        pg.release();
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      if (postgresOk) await this.reverterEmpresaPostgres(id, previa.rows[0] ?? null);
      if (error instanceof AppError) throw error;
      throw this.falhaGravacao(error, "Não foi possível gravar a empresa no Lightsail e no Postgres.");
    } finally {
      conn.release();
    }

    return { ...payload, reativada: reativar };
  }

  async criarVaga(input: VagaCadastro, usuario: string) {
    await this.ensureMirror();
    const empresas = await this.db.query<EmpresaRow>(
      `SELECT id::text AS id, grupo_id::text AS grupo_id, cep, latitude, longitude, logradouro, numero, complemento, local,
              cnpj, razao_social, nome_fantasia, email, telefone
       FROM public.empresa WHERE id::text = $1`,
      [input.empresa_id],
    );
    const empresa = empresas.rows[0];
    if (!empresa) throw new AppError(422, "EMPRESA_FORA_DA_TELA", "A vaga só abre para uma empresa cadastrada nesta tela.");

    // Cargo da lista ou cargo novo: a vaga recebe o nome padronizado, a descrição e os requisitos do cargo.
    const { cargo, reaproveitado: cargoReaproveitado } = input.cargo_id
      ? { cargo: await this.cargos.obter(input.cargo_id), reaproveitado: false }
      : await this.cargos.resolverNovo(input.novo_cargo!);
    const endereco = await this.enderecoLightsail(input.empresa_id);
    const tipo = input.tipo === "estagio" ? 1 : 2;
    const salarioNumero = parseMoney(input.salario);
    const salario = formatMoneyLegacy(salarioNumero);
    const horas = horasDaVaga(input);
    const textoCarga = textoDaVaga(input, horas);
    // Dia sem horário é folga ("0"), como nas vagas antigas e no sync do Notion; vazio faria a grade usar o horário base.
    for (const dia of DIAS_ESCALA) {
      if (!horas[`${dia}_entrada`] || !horas[`${dia}_saida`]) {
        horas[`${dia}_entrada`] = "0";
        horas[`${dia}_saida`] = "0";
      }
    }
    // Mesmas colunas da grade que as vagas antigas têm no Lightsail; turno fica vazio e o intervalo é 00:00 (o formulário não tem esses campos).
    const colunasGrade = {
      horabase: horas.entrada, hora_saida_base: horas.saida, texto_carga: textoCarga, periodo: "", tempo_refeicao: "00:00",
      segunda_entrada: horas.segunda_entrada, segunda_saida: horas.segunda_saida, terca_entrada: horas.terca_entrada, terca_saida: horas.terca_saida,
      quarta_entrada: horas.quarta_entrada, quarta_saida: horas.quarta_saida, quinta_entrada: horas.quinta_entrada, quinta_saida: horas.quinta_saida,
      sexta_entrada: horas.sexta_entrada, sexta_saida: horas.sexta_saida, sab_entrada: horas.sab_entrada, sab_saida: horas.sab_saida,
      domindo_entrada: horas.domingo_entrada, domindo_saida: horas.domingo_saida,
    };
    const faixa = faixaDaSemana(colunasGrade);
    // public.vaga recebe a grade "turno;início-fim;intervalo;1=..;…;texto=…", igual ao sync de vagas abertas.
    const horario = horarioDe({ ...colunasGrade, semanas_inicio: faixa?.inicio ?? null, semanas_fim: faixa?.fim ?? null });
    // As vagas abertas juntas são iguais e da mesma empresa: mesmo vaga_id. Depois de gravar, o vaga_id é recalculado
    // para juntar com as vagas iguais que a empresa já tinha (empresa ou detalhe diferente, vaga_id diferente).
    const vagaIdDoLote = randomUUID();
    const comparador = await this.novoComparador();
    const codigo = await this.novoCodigo();
    const hoje = legacyToday();
    const ids = Array.from({ length: input.quantidade }, () => randomUUID());
    const localPartes = (empresa.local ?? "").split(" - ");
    const bairro = endereco?.bairro || localPartes[0] || "";
    const cidadeUf = (endereco?.cidade ? `${endereco.cidade} / ${endereco.uf ?? ""}` : localPartes[1] || "").trim();


    const linhas = ids.map((id) => ({
      id,
      vaga_id: vagaIdDoLote,
      grupo_id: empresa.grupo_id,
      empresa_id: empresa.id,
      tipo_vaga: tipo,
      cargo: cargo.nome,
      cargo_id: cargo.id,
      descricao: cargo.descricao,
      requisitos: cargo.requisitos,
      salario: salarioNumero,
      carga_horaria: input.carga_horaria,
      sexo: input.sexo,
      idade: input.idade,
      idade_ate: input.idade_ate ?? null,
      km: 30,
      atividades: input.atividades,
      horario,
      beneficios: input.beneficios?.trim() || null,
      cep: empresa.cep,
      latitude: empresa.latitude,
      longitude: empresa.longitude,
    }));

    const mysql = this.mysqlPool();
    const conn = await mysql.getConnection();
    let postgresOk = false;
    try {
      await conn.beginTransaction();
      await conn.query("INSERT INTO codigo_vaga (codigo) VALUES (?)", [codigo]);
      for (const id of ids) {
        await conn.query(
          `INSERT INTO vaga (
            id_vaga, comparador, id_empresa, cargo, salario, idade, idadeate, horabase, hora_saida_base,
            segunda_entrada, segunda_saida, terca_entrada, terca_saida, quarta_entrada, quarta_saida,
            quinta_entrada, quinta_saida, sexta_entrada, sexta_saida, sab_entrada, sab_saida, domindo_entrada, domindo_saida, atribuicaoes, atribu_contrato,
            sede, dataabertura, tipo_vaga, sexo, status, carga_horaria, publicar, codigo, km, faturar, texto_carga,
            periodo, semanas_inicio, semanas_fim, tempo_refeicao
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,10,?,?,?,0,?,1,?,?, 'S', ?,?,?,?,?)`,
          [
            id, comparador, empresa.id, cargo.nome, salario, String(input.idade), input.idade_ate ? String(input.idade_ate) : null,
            horas.entrada, horas.saida,
            horas.segunda_entrada, horas.segunda_saida, horas.terca_entrada, horas.terca_saida,
            horas.quarta_entrada, horas.quarta_saida, horas.quinta_entrada, horas.quinta_saida,
            horas.sexta_entrada, horas.sexta_saida, horas.sab_entrada, horas.sab_saida, horas.domingo_entrada, horas.domingo_saida,
            input.atividades, input.atividades, hoje, tipo, input.sexo, input.carga_horaria, codigo, "30", textoCarga,
            colunasGrade.periodo, faixa?.inicio ?? null, faixa?.fim ?? null, colunasGrade.tempo_refeicao,
          ],
        );
        await conn.query(
          `INSERT INTO etapa_vaga (
            id_vaga, avalia_comportamental, avalia_cultural, avalia_escolar, avalia_tecnico, avalia_basico, avalia_cargo,
            entrevista_agente, entrevista_agente_tipo, entrevista_empresa, entrevista_empresa_tipo, contratacao, convocacao_automatica
          ) VALUES (?,1,0,0,0,1,0,1,'P',1,'V','T',1)`,
          [id],
        );
        await conn.query(
          "INSERT INTO log_diversos (usuario, id_empresa, id_vaga, acao, data) VALUES (?,?,?,?,NOW())",
          [usuario.slice(0, 120), empresa.id, id, "Abertura de vaga ADM"],
        );
      }
      await conn.query(
        `INSERT INTO vaga_valores (
          comparador, cobra_selecao, tipo_selecao, valor_selecao, cobra_recorrente, tipo_recorrente, valor_recorrente,
          pro_rata, cobra_comissao, tipo_comissao, valor_comissao, treinamento, tipo_treinamento, valor_treinamento
        ) VALUES (?,0,'F','',0,'0','','0',0,'P','0',0,'F','0')`,
        [comparador],
      );
      await conn.query(
        `INSERT INTO vaga_endereco (comparador, logradouro, numero, complemento, bairro, cidade, uf, cep, empresa)
         VALUES (?,?,?,?,?,?,?,?,0)`,
        [
          comparador,
          endereco?.logradouro || empresa.logradouro,
          endereco?.numero || empresa.numero,
          endereco?.complemento || empresa.complemento,
          bairro || null,
          endereco?.cidade || cidadeUf.split("/")[0]?.trim() || null,
          endereco?.uf || cidadeUf.split("/")[1]?.trim() || null,
          endereco?.cep || empresa.cep,
        ],
      );

      const pg = await this.db.connect();
      try {
        await pg.query("BEGIN");
        for (const linha of linhas) {
          await pg.query(
            `INSERT INTO public.vaga (
              id, vaga_id, grupo_id, empresa_id, tipo_vaga, cargo, salario, carga_horaria, sexo, idade, idade_ate, km, atividades, horario, cep, latitude, longitude,
              cargo_id, descricao, requisitos, beneficios
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
            [
              linha.id, linha.vaga_id, linha.grupo_id, linha.empresa_id, linha.tipo_vaga, linha.cargo, linha.salario,
              linha.carga_horaria, linha.sexo, linha.idade, linha.idade_ate, linha.km, linha.atividades, linha.horario,
              linha.cep, linha.latitude, linha.longitude, linha.cargo_id, linha.descricao, linha.requisitos, linha.beneficios,
            ],
          );
        }
        await pg.query("INSERT INTO dna_work.codigo_vaga (codigo) VALUES ($1)", [codigo]);
        for (const id of ids) {
          await pg.query(
            `INSERT INTO dna_work.vaga (
              id_vaga, comparador, id_empresa, cargo, salario, idade, idadeate, horabase, hora_saida_base,
              segunda_entrada, segunda_saida, terca_entrada, terca_saida, quarta_entrada, quarta_saida,
              quinta_entrada, quinta_saida, sexta_entrada, sexta_saida, sab_entrada, sab_saida, domindo_entrada, domindo_saida, atribuicaoes, atribu_contrato,
              sede, dataabertura, tipo_vaga, sexo, status, carga_horaria, publicar, codigo, km, faturar, texto_carga, quantidade_posicoes, beneficios_texto,
              periodo, semanas_inicio, semanas_fim, tempo_refeicao, remoto, data_adicao
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,10,$26,$27,$28,0,$29,1,$30,'30','S',$31,1,$32,
              $33,$34,$35,$36,0,(now() AT TIME ZONE 'UTC'))`,
            [
              id, comparador, empresa.id, cargo.nome, salario, String(input.idade), input.idade_ate ? String(input.idade_ate) : null,
              horas.entrada, horas.saida,
              horas.segunda_entrada, horas.segunda_saida, horas.terca_entrada, horas.terca_saida,
              horas.quarta_entrada, horas.quarta_saida, horas.quinta_entrada, horas.quinta_saida,
              horas.sexta_entrada, horas.sexta_saida, horas.sab_entrada, horas.sab_saida, horas.domingo_entrada, horas.domingo_saida,
              input.atividades, input.atividades, hoje, tipo, input.sexo, input.carga_horaria, codigo, textoCarga,
              input.beneficios?.trim() || null,
              colunasGrade.periodo, faixa?.inicio ?? null, faixa?.fim ?? null, colunasGrade.tempo_refeicao,
            ],
          );
          await pg.query(
            `INSERT INTO dna_work.etapa_vaga (
              id_vaga, avalia_comportamental, avalia_cultural, avalia_escolar, avalia_tecnico, avalia_basico, avalia_cargo,
              entrevista_agente, entrevista_agente_tipo, entrevista_empresa, entrevista_empresa_tipo, contratacao, convocacao_automatica
            ) VALUES ($1,1,0,0,0,1,0,1,'P',1,'V','T',1)`,
            [id],
          );
          await pg.query(
            "INSERT INTO dna_work.log_diversos (usuario, id_empresa, id_vaga, acao, data) VALUES ($1,$2,$3,$4, now())",
            [usuario.slice(0, 120), empresa.id, id, "Abertura de vaga ADM"],
          );
        }
        await pg.query(
          `INSERT INTO dna_work.vaga_valores (
            comparador, cobra_selecao, tipo_selecao, valor_selecao, cobra_recorrente, tipo_recorrente, valor_recorrente,
            pro_rata, cobra_comissao, tipo_comissao, valor_comissao, treinamento, tipo_treinamento, valor_treinamento
          ) VALUES ($1,0,'F','',0,'0','','0',0,'P','0',0,'F','0')`,
          [comparador],
        );
        await pg.query(
          `INSERT INTO dna_work.vaga_endereco (comparador, logradouro, numero, complemento, bairro, cidade, uf, cep, empresa)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)`,
          [
            comparador,
            endereco?.logradouro || empresa.logradouro,
            endereco?.numero || empresa.numero,
            endereco?.complemento || empresa.complemento,
            bairro || null,
            endereco?.cidade || cidadeUf.split("/")[0]?.trim() || null,
            endereco?.uf || cidadeUf.split("/")[1]?.trim() || null,
            endereco?.cep || empresa.cep,
          ],
        );
        await pg.query("COMMIT");
        postgresOk = true;
      } catch (error) {
        await pg.query("ROLLBACK");
        throw error;
      } finally {
        pg.release();
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => undefined);
      if (postgresOk) await this.apagarVagaPostgres(ids, codigo, comparador);
      if (error instanceof AppError) throw error;
      throw this.falhaGravacao(error, "Não foi possível abrir a vaga no Lightsail e no Postgres. Nada ficou gravado.");
    } finally {
      conn.release();
    }

    // Junta com as vagas iguais que a empresa já tinha. Se falhar aqui, o sync de vagas abertas recalcula no próximo ciclo.
    await reagruparVagaIds(this.db).catch(() => undefined);
    return { codigo, comparador, quantidade: ids.length, ids, cargo: { nome: cargo.nome, reaproveitado: cargoReaproveitado } };
  }

  private async reverterEmpresaPostgres(id: string, previa: Record<string, unknown> | null) {
    await this.db.query("DELETE FROM public.empresa WHERE id = $1", [id]).catch(() => undefined);
    if (!previa) {
      await this.db.query("DELETE FROM dna_work.assinaturas_empresa WHERE id_empresa = $1 AND tipo IN ('TCE', 'Convenio')", [id]).catch(() => undefined);
      await this.db.query("DELETE FROM dna_work.empresa WHERE id_empresa = $1", [id]).catch(() => undefined);
      return;
    }
    await this.db.query(
      `UPDATE dna_work.empresa SET razao_social=$2, nome_fantasia=$3, email=$4, telefone=$5, cep=$6, logradouro=$7,
        numero=$8, complemento=$9, bairro=$10, cidade=$11, uf=$12, status=$13, sede=$14, matriz=$15, lat=$16, lng=$17
       WHERE id_empresa=$1`,
      [
        id, previa.razao_social, previa.nome_fantasia, previa.email, previa.telefone, previa.cep, previa.logradouro,
        previa.numero, previa.complemento, previa.bairro, previa.cidade, previa.uf, previa.status, previa.sede, previa.matriz, previa.lat, previa.lng,
      ],
    ).catch(() => undefined);
  }

  private async gravarEmpresaLightsailNoPostgres(
    pg: PoolClient,
    payload: {
      id: string;
      razao_social: string;
      nome_fantasia: string;
      email: string | null;
      telefone: string | null;
      cep: string;
      logradouro: string;
      numero: string | null;
      complemento: string | null;
      bairro: string;
      cidade: string;
      uf: string;
      latitude: number;
      longitude: number;
    },
    cnpjMascarado: string,
  ) {
    const atual = await pg.query("SELECT id_empresa FROM dna_work.empresa WHERE id_empresa = $1", [payload.id]);
    if (atual.rows[0]) {
      await pg.query(
        `UPDATE dna_work.empresa SET razao_social=$2, nome_fantasia=$3, email=$4, telefone=$5, cep=$6, logradouro=$7,
          numero=$8, complemento=$9, bairro=$10, cidade=$11, uf=$12, status=1, sede=10, matriz=$1, lat=$13, lng=$14,
          razao_sem_acento=$15, fantasia_sem_acento=$16 WHERE id_empresa=$1`,
        [
          payload.id, payload.razao_social, payload.nome_fantasia, payload.email, payload.telefone, payload.cep,
          payload.logradouro, payload.numero, payload.complemento, payload.bairro, payload.cidade, payload.uf,
          String(payload.latitude), String(payload.longitude), semAcento(payload.razao_social), semAcento(payload.nome_fantasia),
        ],
      );
      return;
    }
    await pg.query(
      `INSERT INTO dna_work.empresa (
        id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, cep, logradouro, numero, complemento,
        bairro, cidade, uf, status, sede, tipo_empresa, matriz, usa_agente, lat, lng, razao_sem_acento, fantasia_sem_acento
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,10,1,$1,1,$14,$15,$16,$17)`,
      [
        payload.id, payload.razao_social, payload.nome_fantasia, cnpjMascarado, payload.email, payload.telefone, payload.cep,
        payload.logradouro, payload.numero, payload.complemento, payload.bairro, payload.cidade, payload.uf,
        String(payload.latitude), String(payload.longitude), semAcento(payload.razao_social), semAcento(payload.nome_fantasia),
      ],
    );
    await pg.query(
      `INSERT INTO dna_work.assinaturas_empresa (id_empresa, tipo, responsavel, administrativo, rh, financeiro, supervisor)
       VALUES ($1, 'TCE', 0, 0, 0, 0, 0), ($1, 'Convenio', 0, 0, 0, 0, 0)`,
      [payload.id],
    );
  }

  private async enderecoLightsail(id: string) {
    const [rows] = await this.mysqlPool().query<RowDataPacket[]>(
      "SELECT logradouro, numero, complemento, bairro, cidade, uf, cep FROM empresa WHERE id_empresa = ? LIMIT 1",
      [id],
    );
    return rows[0] as {
      logradouro: string | null;
      numero: string | null;
      complemento: string | null;
      bairro: string | null;
      cidade: string | null;
      uf: string | null;
      cep: string | null;
    } | undefined;
  }

  private async novoCodigo() {
    const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let tentativa = 0; tentativa < 8; tentativa += 1) {
      const prefixo = Array.from({ length: 3 }, () => letras[randomInt(letras.length)]).join("");
      const codigo = `${prefixo}-${String(randomInt(10000)).padStart(4, "0")}`;
      const [mysqlRows] = await this.mysqlPool().query<RowDataPacket[]>(
        "SELECT codigo FROM codigo_vaga WHERE codigo = ? LIMIT 1",
        [codigo],
      );
      if (mysqlRows.length) continue;
      const pg = await this.db.query("SELECT codigo FROM dna_work.codigo_vaga WHERE codigo = $1 LIMIT 1", [codigo]);
      if (!pg.rows[0]) return codigo;
    }
    throw new AppError(503, "CODIGO_INDISPONIVEL", "Não foi possível gerar um código de vaga livre.");
  }

  private async novoComparador() {
    let valor = Math.floor(Date.now() / 1000);
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const texto = String(valor);
      const [rows] = await this.mysqlPool().query<RowDataPacket[]>("SELECT comparador FROM vaga WHERE comparador = ? LIMIT 1", [texto]);
      if (!rows.length) return texto;
      valor += 1;
    }
    return String(Date.now());
  }

  async consultarModelos(filtro: { cargo?: string; tipo?: string }) {
    await this.ensureMirror();
    const tipo = filtro.tipo === "estagio" ? "1" : filtro.tipo === "clt" ? "2" : filtro.tipo === "pj" ? "4" : null;
    const consulta = await this.db.query<RepetidaLinha>(
      `SELECT ${CAMPOS_REPETIDA}
       FROM public.vaga_repetida
       WHERE ($1::text IS NULL OR cargo ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR tipo_vaga = $2)
       ORDER BY lower(cargo) NULLS LAST, tipo_vaga`,
      [filtro.cargo || null, tipo],
    );
    return consulta.rows.map((row) => {
      const formulario = formularioDaLinha(row);
      // O texto guardado pode estar no formato do sync (";2-1;00:00;2=08:00-17:00"): mostra sempre o texto por dia.
      const horario = textoDoHorario(DIAS_ESCALA.map((dia) => ({
        modo: formulario.folga.includes(dia) ? "folga" : formulario.escala.includes(dia) ? "escala" : "fixo",
        entrada: formulario[`${dia}_entrada`],
        saida: formulario[`${dia}_saida`],
      })));
      return {
        vaga_id: row.vaga_id,
        cargo: row.cargo || "—",
        tipo_vaga: TIPO_MODELO[String(row.tipo_vaga)] ?? "Estágio",
        salario: salarioTexto(row.salario) || "—",
        carga_horaria: formulario.carga_horaria,
        horario,
      };
    });
  }

  /** O modelo global do cargo e da modalidade (tipo "1" estágio, "2" CLT), se já existe. */
  private async modeloDoCargo(cargo: string, tipo: string, ignorar?: string) {
    const consulta = await this.db.query<{ vaga_id: string; cargo: string | null }>(
      "SELECT vaga_id::text AS vaga_id, cargo FROM public.vaga_repetida WHERE tipo_vaga = $1",
      [tipo],
    );
    const chave = chaveCargo(cargo);
    return consulta.rows.find((row) => row.vaga_id !== ignorar && chaveCargo(row.cargo ?? "") === chave) ?? null;
  }

  private async linhaDoModelo(input: ModeloVaga) {
    const { cargo } = input.cargo_id
      ? { cargo: await this.cargos.obter(input.cargo_id) }
      : await this.cargos.resolverNovo(input.novo_cargo!);
    const tipo = input.tipo === "estagio" ? "1" : "2";
    const horas = horasDaVaga(input);
    return {
      cargo,
      linha: {
        tipo_vaga: tipo,
        cargo: cargo.nome,
        cargo_id: cargo.id,
        descricao: cargo.descricao,
        requisitos: cargo.requisitos,
        salario: parseMoney(input.salario),
        carga_horaria: input.carga_horaria,
        sexo: input.sexo,
        idade: input.idade,
        idade_ate: input.idade_ate ?? null,
        km: 30,
        atividades: input.atividades,
        horario: textoDoModelo(input, horas),
        beneficios: input.beneficios?.trim() || null,
      },
    };
  }

  private modeloRepetido(cargo: string, tipo: string): never {
    throw new AppError(409, "MODELO_JA_EXISTE", `Já existe um modelo de ${cargo} (${TIPO_MODELO[tipo] ?? tipo}). Edite esse modelo em vez de criar outro.`);
  }

  /** Cria o modelo global em public.vaga_repetida. */
  async criarModelo(input: ModeloVaga) {
    await this.ensureMirror();
    const { cargo, linha } = await this.linhaDoModelo(input);
    if (await this.modeloDoCargo(cargo.nome, linha.tipo_vaga)) this.modeloRepetido(cargo.nome, linha.tipo_vaga);
    const id = randomUUID();
    const modelo = { id, vaga_id: id, grupo_id: null, empresa_id: null, cep: null, latitude: null, longitude: null, ...linha };
    try {
      const pg = await this.db.connect();
      try {
        await pg.query(
          `INSERT INTO public.vaga_repetida (
            id, vaga_id, tipo_vaga, cargo, cargo_id, descricao, requisitos, salario, carga_horaria, sexo, idade, idade_ate, km, atividades, horario, beneficios
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            modelo.id, modelo.vaga_id, linha.tipo_vaga, linha.cargo, cargo.id, linha.descricao, linha.requisitos, linha.salario, linha.carga_horaria,
            linha.sexo, linha.idade, linha.idade_ate, linha.km, linha.atividades, linha.horario, linha.beneficios,
          ],
        );
      } finally {
        pg.release();
      }
    } catch (error) {
      throw this.falhaGravacao(error, "Não foi possível gravar o modelo no Postgres.");
    }
    return { vagaId: id, cargo: cargo.nome };
  }

  async editarModelo(vagaId: string, input: ModeloVaga) {
    await this.ensureMirror();
    const atual = await this.db.query<RepetidaLinha>(`SELECT ${CAMPOS_REPETIDA} FROM public.vaga_repetida WHERE vaga_id = $1 LIMIT 1`, [vagaId]);
    const anterior = atual.rows[0];
    if (!anterior) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo não encontrado.");
    const { cargo, linha } = await this.linhaDoModelo(input);
    if (await this.modeloDoCargo(cargo.nome, linha.tipo_vaga, vagaId)) this.modeloRepetido(cargo.nome, linha.tipo_vaga);
    try {
      const pg = await this.db.connect();
      try {
        await pg.query(
          `UPDATE public.vaga_repetida SET tipo_vaga=$2, cargo=$3, cargo_id=$4, descricao=$5, requisitos=$6, salario=$7, carga_horaria=$8,
             sexo=$9, idade=$10, idade_ate=$11, km=$12, atividades=$13, horario=$14, beneficios=$15
           WHERE vaga_id = $1`,
          [
            vagaId, linha.tipo_vaga, linha.cargo, cargo.id, linha.descricao, linha.requisitos, linha.salario, linha.carga_horaria,
            linha.sexo, linha.idade, linha.idade_ate, linha.km, linha.atividades, linha.horario, linha.beneficios,
          ],
        );
      } finally {
        pg.release();
      }
    } catch (error) {
      throw this.falhaGravacao(error, "Não foi possível gravar o modelo no Postgres.");
    }
    return { vagaId, cargo: cargo.nome };
  }

  /** Apaga só o modelo: as vagas já abertas continuam como estão. */
  async apagarModelo(vagaId: string) {
    await this.ensureMirror();
    await this.db.query("DELETE FROM public.vaga_repetida WHERE vaga_id = $1", [vagaId]);
    return { vagaId };
  }

  /**
   * Latitude e longitude da empresa pelo endereço completo (rua, número, bairro, cidade, UF e CEP).
   * Só o CEP não basta: em cidade de CEP único (ex.: Mongaguá, Capivari) o Google devolve o centro da cidade.
   * Sem resultado pelo endereço, cai para o CEP.
   */
  private async geocode(cep: string, endereco?: { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null }) {
    if (!this.config.GOOGLE_MAPS_API_KEY) {
      throw new AppError(503, "GOOGLE_NAO_CONFIGURADO", "Defina GOOGLE_MAPS_API_KEY para gravar a latitude e a longitude.");
    }
    const completo = endereco ? enderecoParaGeocode({ ...endereco, cep }) : "";
    for (const busca of [completo, cep].filter(Boolean)) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", busca);
      url.searchParams.set("components", "country:BR");
      url.searchParams.set("region", "br");
      url.searchParams.set("key", this.config.GOOGLE_MAPS_API_KEY);
      const response = await fetch(url);
      const body = await response.json() as { status?: string; results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
      const location = body.results?.[0]?.geometry?.location;
      if (response.ok && location && body.status === "OK") return location;
    }
    throw new AppError(502, "GEOCODE_FALHOU", "Não foi possível obter latitude e longitude a partir do endereço da empresa.");
  }


  private async apagarVagaPostgres(ids: string[], codigo: string, comparador: string) {
    await this.db.query("DELETE FROM public.vaga WHERE id = ANY($1::uuid[])", [ids]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.etapa_vaga WHERE id_vaga = ANY($1::varchar[])", [ids]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.log_diversos WHERE id_vaga = ANY($1::varchar[]) AND acao = 'Abertura de vaga ADM'", [ids]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.vaga WHERE id_vaga = ANY($1::varchar[])", [ids]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.vaga_valores WHERE comparador = $1", [comparador]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.vaga_endereco WHERE comparador = $1", [comparador]).catch(() => undefined);
    await this.db.query("DELETE FROM dna_work.codigo_vaga WHERE codigo = $1", [codigo]).catch(() => undefined);
  }

  private falhaGravacao(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    return new AppError(502, "GRAVACAO_FALHOU", message || fallback);
  }
}
