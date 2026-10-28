import { randomUUID, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RowDataPacket } from "mysql2";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { legacyToday } from "../lib/dates.js";
import { AppError } from "../lib/errors.js";
import { formatMoneyLegacy, moneyToNumber, parseMoney } from "../lib/money.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import type { EmpresaCadastro, GrupoCreate, VagaCadastro } from "../schemas/cadastro.js";

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
`;

function maskCnpj(digits: string) {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function semAcento(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function localDe(bairro: string, cidade: string, uf: string) {
  return `${bairro} - ${cidade} / ${uf.toUpperCase()}`;
}

function horaInformada(input: VagaCadastro, nome: string, fallback: string | null) {
  const value = (input as unknown as Record<string, string | undefined>)[nome];
  return value || fallback;
}

function horasDaVaga(input: VagaCadastro) {
  const entrada = input.horario_entrada;
  const saida = input.horario_saida;
  return {
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
}

function modeloAusente(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /schema cache|PGRST205|does not exist|não existe/i.test(message);
}

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
  empresa_nome?: string | null;
};

function atividadesLegiveis(valor: string | null) {
  return (valor ?? "").replace(/,(\S)/g, ", $1").replace(/,\s*$/g, "").trim();
}

const CAMPOS_REPETIDA = "id, vaga_id, empresa_id, grupo_id, tipo_vaga, cargo, salario, carga_horaria, sexo, idade, idade_ate, atividades, horario";
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

function horarioEquivalente(armazenado: string | null, alvo: string) {
  if ((armazenado ?? "") === alvo) return true;
  const partes = horarioPartes(alvo);
  if (!partes.entrada) return false;
  const { base } = agendaDoHorario(armazenado);
  return base.entrada === partes.entrada && base.saida === partes.saida;
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
  const { agenda, base } = agendaDoHorario(row.horario);
  const tipo = String(row.tipo_vaga) === "2" ? "clt" : "estagio";
  const cargaBruta = String(row.carga_horaria ?? "").match(/\d+/)?.[0] ?? "";
  const cargaGuardada = cargaBruta === "20" || cargaBruta === "30" || cargaBruta === "40" || cargaBruta === "44" ? cargaBruta : "";
  const carga = cargaCalculada(tipo, horasDaAgenda(agenda)) || cargaGuardada;
  return {
    tipo,
    carga_horaria: carga,
    cargo: row.cargo ?? "",
    salario: salarioTexto(row.salario),
    horario_entrada: base.entrada,
    horario_saida: base.saida,
    sexo: row.sexo === "M" || row.sexo === "F" ? row.sexo : "I",
    idade: row.idade == null ? "" : String(row.idade),
    idade_ate: row.idade_ate == null ? "" : String(row.idade_ate),
    atividades: atividadesLegiveis(row.atividades),
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
  };
}

export class CadastroService {
  private mirror: Promise<void> | null = null;

  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
  ) {}

  private rest() {
    if (!this.config.SUPABASE_URL || !this.config.SUPABASE_SERVICE_ROLE_KEY) {
      throw new AppError(503, "SUPABASE_NAO_CONFIGURADO", "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
    }
    return supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
  }

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
    const rows = await this.rest().get<GrupoRow[]>("grupo?select=id,nome,email,telefone,criado_em&order=nome.asc&limit=500");
    return rows;
  }

  async obterGrupo(id: string) {
    await this.ensureMirror();
    const grupos = await this.rest().get<GrupoRow[]>(`grupo?id=eq.${id}&select=id,nome,email,telefone,criado_em`);
    const grupo = grupos[0];
    if (!grupo) throw new AppError(404, "GRUPO_NAO_ENCONTRADO", "Grupo não encontrado.");
    const empresas = await this.rest().get<EmpresaRow[]>(
      `empresa?grupo_id=eq.${id}&select=id,grupo_id,cnpj,razao_social,nome_fantasia,email,telefone,cep,logradouro,numero,complemento,local&order=nome_fantasia.asc`,
    );
    return { ...grupo, empresas };
  }

  async listarEmpresas() {
    await this.ensureMirror();
    return this.rest().get<EmpresaRow[]>(
      "empresa?select=id,grupo_id,cnpj,razao_social,nome_fantasia,email,telefone,local&order=nome_fantasia.asc&limit=500",
    );
  }

  async listarModelos(empresaId: string) {
    await this.ensureMirror();
    const rows = await this.linhasRepetida(empresaId);
    const vistos = new Set<string>();
    const conteudos = new Set<string>();
    const modelos = [];
    for (const row of rows) {
      if (!row.vaga_id || vistos.has(row.vaga_id)) continue;
      const formulario = formularioDaLinha(row);
      const chave = JSON.stringify(formulario);
      if (conteudos.has(chave)) continue;
      vistos.add(row.vaga_id);
      conteudos.add(chave);
      modelos.push({ vagaId: row.vaga_id, empresaNome: row.empresa_nome ?? "", formulario });
    }
    return modelos;
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
    const empresas = await this.db.query<{ nome: string }>(
      `SELECT DISTINCT btrim(coalesce(nullif(nome_fantasia, ''), razao_social)) AS nome
       FROM public.empresa
       WHERE btrim(coalesce(nome_fantasia, razao_social, '')) <> ''
       ORDER BY 1`,
    );
    const cargos = await this.db.query<{ cargo: string }>(
      `SELECT DISTINCT btrim(cargo) AS cargo
       FROM public.vaga_repetida
       WHERE cargo IS NOT NULL AND btrim(cargo) <> ''
       ORDER BY 1`,
    );
    return {
      empresas: empresas.rows.map((row) => row.nome),
      cargos: cargos.rows.map((row) => row.cargo),
    };
  }

  async criarGrupo(input: GrupoCreate) {
    await this.ensureMirror();
    const id = randomUUID();
    const row = { id, nome: input.nome, email: input.email ?? null, telefone: input.telefone ?? null };
    const sb = this.rest();
    await sb.insert("grupo", row);
    try {
      await this.db.query(
        "INSERT INTO public.grupo (id, nome, email, telefone) VALUES ($1, $2, $3, $4)",
        [id, row.nome, row.email, row.telefone],
      );
    } catch (error) {
      await sb.remove(`grupo?id=eq.${id}`);
      throw this.falhaGravacao(error, "Não foi possível gravar o grupo no Postgres.");
    }
    return row;
  }

  async criarEmpresa(input: EmpresaCadastro) {
    await this.ensureMirror();
    const sb = this.rest();
    const grupos = await sb.get<Array<{ id: string }>>(`grupo?id=eq.${input.grupo_id}&select=id`);
    if (!grupos[0]) throw new AppError(422, "GRUPO_OBRIGATORIO", "Escolha um grupo cadastrado nesta tela.");

    const digits = input.cnpj;
    const masked = maskCnpj(digits);
    const jaNoSupabase = await sb.get<Array<{ id: string }>>(
      `empresa?or=(cnpj.eq.${encodeURIComponent(digits)},cnpj.eq.${encodeURIComponent(masked)})&select=id&limit=1`,
    );
    if (jaNoSupabase.length) {
      throw new AppError(409, "CNPJ_JA_CADASTRADO", "Este CNPJ já está no Supabase. O cadastro não foi duplicado.");
    }
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
    const geo = await this.geocode(input.cep!);
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
    let supabaseOk = false;
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

      await sb.insert("empresa", {
        id, grupo_id: payload.grupo_id, cnpj: digits, razao_social: payload.razao_social, nome_fantasia: payload.nome_fantasia,
        email: payload.email, telefone: payload.telefone, cep: payload.cep, logradouro: payload.logradouro,
        numero: payload.numero, complemento: payload.complemento, local, latitude: payload.latitude, longitude: payload.longitude,
      });
      supabaseOk = true;

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
      if (supabaseOk) await sb.remove(`empresa?id=eq.${id}`).catch(() => undefined);
      if (postgresOk) await this.reverterEmpresaPostgres(id, previa.rows[0] ?? null);
      if (error instanceof AppError) throw error;
      throw this.falhaGravacao(error, "Não foi possível gravar a empresa nos três bancos.");
    } finally {
      conn.release();
    }

    return { ...payload, reativada: reativar };
  }

  async criarVaga(input: VagaCadastro, usuario: string) {
    await this.ensureMirror();
    const sb = this.rest();
    const empresas = await sb.get<EmpresaRow[]>(`empresa?id=eq.${input.empresa_id}&select=id,grupo_id,cep,latitude,longitude,logradouro,numero,complemento,local,cnpj,razao_social,nome_fantasia,email,telefone`);
    const empresa = empresas[0];
    if (!empresa) throw new AppError(422, "EMPRESA_FORA_DA_TELA", "A vaga só abre para uma empresa cadastrada nesta tela.");

    const endereco = await this.enderecoLightsail(input.empresa_id);
    const tipo = input.tipo === "estagio" ? 1 : 2;
    const salarioNumero = parseMoney(input.salario);
    const salario = formatMoneyLegacy(salarioNumero);
    const horas = horasDaVaga(input);
    const horario = `${horas.entrada} às ${horas.saida}`;
    const igual = empresa.grupo_id
      ? await this.buscarModeloIgual(empresa.grupo_id, {
        tipo, cargo: input.cargo, carga: input.carga_horaria, salario: salarioNumero, sexo: input.sexo,
        idade: input.idade, idadeAte: input.idade_ate ?? null, atividades: input.atividades, horario,
      })
      : null;
    const reutilizou = Boolean(igual);
    const repetidaId = igual?.id ?? randomUUID();
    const modeloId = igual?.vaga_id ?? repetidaId;
    const comparador = await this.novoComparador();
    const codigo = await this.novoCodigo();
    const hoje = legacyToday();
    const ids = Array.from({ length: input.quantidade }, () => randomUUID());
    const localPartes = (empresa.local ?? "").split(" - ");
    const bairro = endereco?.bairro || localPartes[0] || "";
    const cidadeUf = (endereco?.cidade ? `${endereco.cidade} / ${endereco.uf ?? ""}` : localPartes[1] || "").trim();

    const modelo = {
      id: repetidaId,
      vaga_id: modeloId,
      grupo_id: igual?.grupo_id || empresa.grupo_id,
      empresa_id: igual?.empresa_id || empresa.id,
      tipo_vaga: String(tipo),
      cargo: input.cargo,
      salario: salarioNumero,
      carga_horaria: input.carga_horaria,
      sexo: input.sexo,
      idade: input.idade,
      idade_ate: input.idade_ate ?? null,
      km: 30,
      atividades: input.atividades,
      horario,
      cep: empresa.cep,
      latitude: empresa.latitude,
      longitude: empresa.longitude,
    };

    const linhas = ids.map((id) => ({
      id,
      vaga_id: modeloId,
      grupo_id: empresa.grupo_id,
      empresa_id: empresa.id,
      tipo_vaga: tipo,
      cargo: input.cargo,
      salario: salarioNumero,
      carga_horaria: input.carga_horaria,
      sexo: input.sexo,
      idade: input.idade,
      idade_ate: input.idade_ate ?? null,
      km: 30,
      atividades: input.atividades,
      horario,
      cep: empresa.cep,
      latitude: empresa.latitude,
      longitude: empresa.longitude,
    }));

    const mysql = this.mysqlPool();
    const conn = await mysql.getConnection();
    let supabaseOk = false;
    let postgresOk = false;
    let gravouModeloNovo = false;
    try {
      await conn.beginTransaction();
      await conn.query("INSERT INTO codigo_vaga (codigo) VALUES (?)", [codigo]);
      for (const id of ids) {
        await conn.query(
          `INSERT INTO vaga (
            id_vaga, comparador, id_empresa, cargo, salario, idade, idadeate, horabase, hora_saida_base,
            segunda_entrada, segunda_saida, terca_entrada, terca_saida, quarta_entrada, quarta_saida,
            quinta_entrada, quinta_saida, sexta_entrada, sexta_saida, sab_entrada, sab_saida, domindo_entrada, domindo_saida, atribuicaoes, atribu_contrato,
            sede, dataabertura, tipo_vaga, sexo, status, carga_horaria, publicar, codigo, km, faturar, texto_carga
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,10,?,?,?,0,?,1,?,?, 'S', ?)`,
          [
            id, comparador, empresa.id, input.cargo, salario, String(input.idade), input.idade_ate ? String(input.idade_ate) : null,
            horas.entrada, horas.saida,
            horas.segunda_entrada, horas.segunda_saida, horas.terca_entrada, horas.terca_saida,
            horas.quarta_entrada, horas.quarta_saida, horas.quinta_entrada, horas.quinta_saida,
            horas.sexta_entrada, horas.sexta_saida, horas.sab_entrada, horas.sab_saida, horas.domingo_entrada, horas.domingo_saida,
            input.atividades, input.atividades, hoje, tipo, input.sexo, input.carga_horaria, codigo, "30", horario,
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

      try {
        if (!reutilizou) {
          await sb.insert("vaga_repetida", modelo);
          gravouModeloNovo = true;
        }
      } catch (error) {
        if (!modeloAusente(error)) throw error;
      }
      await sb.insert("vaga", linhas);
      supabaseOk = true;

      const pg = await this.db.connect();
      try {
        await pg.query("BEGIN");
        if (!reutilizou) {
          await pg.query(
            `INSERT INTO public.vaga_repetida (
              id, vaga_id, grupo_id, empresa_id, tipo_vaga, cargo, salario, carga_horaria, sexo, idade, idade_ate, km, atividades, horario, cep, latitude, longitude
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              modelo.id, modelo.vaga_id, modelo.grupo_id, modelo.empresa_id, modelo.tipo_vaga, modelo.cargo, modelo.salario,
              modelo.carga_horaria, modelo.sexo, modelo.idade, modelo.idade_ate, modelo.km, modelo.atividades, modelo.horario,
              modelo.cep, modelo.latitude, modelo.longitude,
            ],
          );
        }
        for (const linha of linhas) {
          await pg.query(
            `INSERT INTO public.vaga (
              id, vaga_id, grupo_id, empresa_id, tipo_vaga, cargo, salario, carga_horaria, sexo, idade, idade_ate, km, atividades, horario, cep, latitude, longitude
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              linha.id, linha.vaga_id, linha.grupo_id, linha.empresa_id, linha.tipo_vaga, linha.cargo, linha.salario,
              linha.carga_horaria, linha.sexo, linha.idade, linha.idade_ate, linha.km, linha.atividades, linha.horario,
              linha.cep, linha.latitude, linha.longitude,
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
              sede, dataabertura, tipo_vaga, sexo, status, carga_horaria, publicar, codigo, km, faturar, texto_carga, quantidade_posicoes
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,10,$26,$27,$28,0,$29,1,$30,'30','S',$31,1)`,
            [
              id, comparador, empresa.id, input.cargo, salario, String(input.idade), input.idade_ate ? String(input.idade_ate) : null,
              horas.entrada, horas.saida,
              horas.segunda_entrada, horas.segunda_saida, horas.terca_entrada, horas.terca_saida,
              horas.quarta_entrada, horas.quarta_saida, horas.quinta_entrada, horas.quinta_saida,
              horas.sexta_entrada, horas.sexta_saida, horas.sab_entrada, horas.sab_saida, horas.domingo_entrada, horas.domingo_saida,
              input.atividades, input.atividades, hoje, tipo, input.sexo, input.carga_horaria, codigo, horario,
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
      if (supabaseOk) {
        await sb.remove(`vaga?id=in.(${ids.join(",")})`).catch(() => undefined);
        if (gravouModeloNovo) await sb.remove(`vaga_repetida?id=eq.${repetidaId}`).catch(() => undefined);
      }
      if (postgresOk) await this.apagarVagaPostgres(ids, gravouModeloNovo ? repetidaId : null, codigo, comparador);
      if (error instanceof AppError) throw error;
      throw this.falhaGravacao(error, "Não foi possível abrir a vaga nos três bancos. Nada ficou gravado.");
    } finally {
      conn.release();
    }

    return { codigo, comparador, quantidade: ids.length, ids };
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

  private async linhasDoGrupo(grupoId: string): Promise<RepetidaLinha[]> {
    const consulta = await this.db.query<RepetidaLinha>(
      `SELECT r.id, r.vaga_id, r.empresa_id, r.grupo_id, r.tipo_vaga, r.cargo, r.salario, r.carga_horaria, r.sexo, r.idade, r.idade_ate, r.atividades, r.horario,
              coalesce(nullif(btrim(e.nome_fantasia), ''), e.razao_social) AS empresa_nome
       FROM public.vaga_repetida r
       LEFT JOIN public.empresa e ON e.id = r.empresa_id
       WHERE r.grupo_id = $1
          OR r.empresa_id IN (SELECT id FROM public.empresa WHERE grupo_id = $1)`,
      [grupoId],
    );
    return consulta.rows;
  }

  private async linhasRepetida(empresaId: string): Promise<RepetidaLinha[]> {
    const grupo = await this.db.query<{ grupo_id: string | null }>(
      "SELECT grupo_id FROM public.empresa WHERE id = $1",
      [empresaId],
    );
    const grupoId = grupo.rows[0]?.grupo_id;
    if (grupoId) return this.linhasDoGrupo(grupoId);
    const consulta = await this.db.query<RepetidaLinha>(
      `SELECT r.id, r.vaga_id, r.empresa_id, r.grupo_id, r.tipo_vaga, r.cargo, r.salario, r.carga_horaria, r.sexo, r.idade, r.idade_ate, r.atividades, r.horario,
              coalesce(nullif(btrim(e.nome_fantasia), ''), e.razao_social) AS empresa_nome
       FROM public.vaga_repetida r
       LEFT JOIN public.empresa e ON e.id = r.empresa_id
       WHERE r.empresa_id = $1`,
      [empresaId],
    );
    return consulta.rows;
  }

  async consultarModelos(filtro: { nome?: string; cargo?: string; tipo?: string }) {
    await this.ensureMirror();
    const tipo = filtro.tipo === "estagio" ? "1" : filtro.tipo === "clt" ? "2" : filtro.tipo === "pj" ? "4" : null;
    const consulta = await this.db.query<{
      vaga_id: string;
      cargo: string | null;
      tipo_vaga: string | null;
      carga_horaria: string | null;
      salario: number | string | null;
      empresa_id: string | null;
      nome_fantasia: string | null;
      razao_social: string | null;
    }>(
      `SELECT r.vaga_id, r.cargo, r.tipo_vaga, r.carga_horaria, r.salario, r.empresa_id, e.nome_fantasia, e.razao_social
       FROM public.vaga_repetida r
       LEFT JOIN public.empresa e ON e.id = r.empresa_id
       WHERE ($1::text IS NULL OR coalesce(e.nome_fantasia, '') ILIKE '%' || $1 || '%' OR coalesce(e.razao_social, '') ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR r.cargo ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR r.tipo_vaga = $3)
       ORDER BY r.cargo NULLS LAST
       LIMIT 200`,
      [filtro.nome || null, filtro.cargo || null, tipo],
    );
    return consulta.rows.map((row) => ({
      vaga_id: row.vaga_id,
      nome: row.nome_fantasia || row.razao_social || row.cargo || "—",
      cargo: row.cargo || "—",
      tipo_vaga: row.tipo_vaga === "2" ? "CLT" : row.tipo_vaga === "4" ? "Pessoa Juridica" : "Estágio",
      salario: salarioTexto(row.salario) || "—",
      carga_horaria: row.carga_horaria,
      empresa_id: row.empresa_id,
    }));
  }

  private async buscarModeloIgual(grupoId: string, alvo: {
    tipo: number;
    cargo: string;
    carga: string;
    salario: number;
    sexo: string;
    idade: number;
    idadeAte: number | null;
    atividades: string;
    horario: string;
  }) {
    const rows = await this.linhasDoGrupo(grupoId);
    return rows.find((row) => {
      const salario = row.salario == null || row.salario === "" ? null : Number(row.salario);
      const idadeAte = row.idade_ate == null ? null : Number(row.idade_ate);
      const carga = String(row.carga_horaria ?? "").match(/\d+/)?.[0] ?? "";
      return String(row.tipo_vaga) === String(alvo.tipo)
        && (row.cargo ?? "").trim() === alvo.cargo.trim()
        && carga === alvo.carga
        && (row.sexo ?? "") === alvo.sexo
        && Number(row.idade) === alvo.idade
        && idadeAte === alvo.idadeAte
        && (row.atividades ?? "").trim() === alvo.atividades.trim()
        && horarioEquivalente(row.horario, alvo.horario)
        && salario != null
        && Math.abs(salario - alvo.salario) < 0.001;
    }) ?? null;
  }

  private async geocode(cep: string) {
    if (!this.config.GOOGLE_MAPS_API_KEY) {
      throw new AppError(503, "GOOGLE_NAO_CONFIGURADO", "Defina GOOGLE_MAPS_API_KEY para gravar a latitude e a longitude.");
    }
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", cep);
    url.searchParams.set("components", "country:BR");
    url.searchParams.set("region", "br");
    url.searchParams.set("key", this.config.GOOGLE_MAPS_API_KEY);
    const response = await fetch(url);
    const body = await response.json() as { status?: string; results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
    const location = body.results?.[0]?.geometry?.location;
    if (!response.ok || !location || body.status !== "OK") {
      throw new AppError(502, "GEOCODE_FALHOU", "Não foi possível obter latitude e longitude a partir do CEP.");
    }
    return location;
  }

  private async apagarVagaPostgres(ids: string[], repetidaId: string | null, codigo: string, comparador: string) {
    await this.db.query("DELETE FROM public.vaga WHERE id = ANY($1::uuid[])", [ids]).catch(() => undefined);
    if (repetidaId) await this.db.query("DELETE FROM public.vaga_repetida WHERE id = $1", [repetidaId]).catch(() => undefined);
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
