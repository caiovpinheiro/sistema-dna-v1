import type { RowDataPacket } from "mysql2";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { supabaseRest } from "../lib/supabase-rest.js";
import { formatarLocal, lerNotion, turnosDe, type LocalPartes, type Turnos, type VagaNotion } from "../lib/triagem-notion.js";

export type Logger = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
};

/** Colunas da grade no Lightsail, na numeração 1 domingo … 7 sábado. O Lightsail escreve "domindo". */
const COLUNAS_DIA: Record<number, string> = { 1: "domindo", 2: "segunda", 3: "terca", 4: "quarta", 5: "quinta", 6: "sexta", 7: "sab" };
const CAMPOS_GRADE = Object.values(COLUNAS_DIA).flatMap((dia) => [`${dia}_entrada`, `${dia}_saida`]);

type VagaLightsail = RowDataPacket & {
  id_vaga: string;
  codigo: string | null;
  id_empresa: string;
  texto_carga: string | null;
  horabase: string | null;
  hora_saida_base: string | null;
  semanas_inicio: number | null;
  semanas_fim: number | null;
  tempo_refeicao: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
} & Record<string, unknown>;

type VagaEspelho = { id: string; vaga_id: string | null; empresa_id: string | null; horario: string | null };

type CamposHorario = Record<string, string | number>;

export type MudancaVaga = {
  codigo: string;
  id_vaga: string;
  id_empresa: string;
  antes: CamposHorario;
  depois: CamposHorario;
  horario_espelho: { antes_supabase: string | null; antes_postgres: string | null; depois: string };
};

export type MudancaEmpresa = { id_empresa: string; codigo: string; antes: LocalPartes; depois: LocalPartes; local: string };

export type ResultadoSync = {
  dry: boolean;
  notion: "ok" | "sem-token" | "falhou";
  lidas: number;
  aplicadas: number;
  iguais: number;
  pendentes: number;
  locais: number;
  erros: number;
  vagas: MudancaVaga[];
  empresas: MudancaEmpresa[];
};

function vazio(valor: unknown) {
  const texto = valor == null ? "" : String(valor).trim();
  return texto === "" ? "0" : texto;
}

function camposAtuais(row: VagaLightsail): CamposHorario {
  const campos: CamposHorario = {
    texto_carga: row.texto_carga ?? "",
    horabase: row.horabase ?? "",
    hora_saida_base: row.hora_saida_base ?? "",
    semanas_inicio: Number(row.semanas_inicio ?? 0),
    semanas_fim: Number(row.semanas_fim ?? 0),
    tempo_refeicao: row.tempo_refeicao ?? "",
  };
  for (const campo of CAMPOS_GRADE) campos[campo] = vazio(row[campo]);
  return campos;
}

/** Horário do dia pelo primeiro turno do Notion que cobre esse dia; sem turno, '0'. */
function horaDoDia(turnos: Turnos, numero: number) {
  const turno = turnos.turnos.find((item) => item.dias.includes(numero));
  return turno ? { entrada: turno.entrada, saida: turno.saida } : null;
}

function camposNovos(turnos: Turnos, atual: CamposHorario): CamposHorario {
  const { principal } = turnos;
  const campos: CamposHorario = {
    texto_carga: turnos.texto.slice(0, 255),
    horabase: principal.entrada,
    hora_saida_base: principal.saida,
    semanas_inicio: principal.semanasInicio,
    semanas_fim: principal.semanasFim,
    tempo_refeicao: turnos.refeicao ?? (String(atual.tempo_refeicao || "") || "00:00"),
  };
  for (const [numero, dia] of Object.entries(COLUNAS_DIA)) {
    const horas = horaDoDia(turnos, Number(numero));
    campos[`${dia}_entrada`] = horas?.entrada ?? "0";
    campos[`${dia}_saida`] = horas?.saida ?? "0";
  }
  return campos;
}

function iguais(a: CamposHorario, b: CamposHorario) {
  return Object.keys(b).every((campo) => String(a[campo] ?? "") === String(b[campo] ?? ""));
}

/** Mesmo formato que o cadastro grava em public.vaga.horario: turno;início-fim;refeição;1=..;…;7=..;texto=… */
export function horarioEspelho(turnos: Turnos, refeicao: string, anterior: string | null): string {
  const turno = anterior && /^[^;]*;\d-\d;/.test(anterior) ? anterior.split(";")[0] : "";
  const dias = [1, 2, 3, 4, 5, 6, 7].map((numero) => {
    const horas = horaDoDia(turnos, numero);
    return `${numero}=${horas ? `${horas.entrada}-${horas.saida}` : ""}`;
  });
  return [turno, `${turnos.principal.semanasInicio}-${turnos.principal.semanasFim}`, refeicao, ...dias, `texto=${turnos.texto}`].join(";");
}

function resumoGrade(campos: CamposHorario) {
  return Object.entries(COLUNAS_DIA)
    .map(([, dia]) => `${dia}=${campos[`${dia}_entrada`]}-${campos[`${dia}_saida`]}`)
    .join(" ");
}

function mesmoTexto(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export class NotionSyncService {
  private rodando: Promise<ResultadoSync> | null = null;

  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  emAndamento() {
    return this.rodando !== null;
  }

  /** Um ciclo por vez. Quem chamar durante um ciclo recebe o resultado dele. */
  executar(dry: boolean): Promise<ResultadoSync> {
    this.rodando ??= this.ciclo(dry).finally(() => {
      this.rodando = null;
    });
    return this.rodando;
  }

  private async ciclo(dry: boolean): Promise<ResultadoSync> {
    const resultado: ResultadoSync = { dry, notion: "ok", lidas: 0, aplicadas: 0, iguais: 0, pendentes: 0, locais: 0, erros: 0, vagas: [], empresas: [] };
    if (!this.config.NOTION_TOKEN) {
      resultado.notion = "sem-token";
      this.log.warn({ notion: "sem-token" }, "sync notion: sem NOTION_TOKEN, nada gravado");
      return resultado;
    }
    if (!this.mysql) {
      resultado.notion = "falhou";
      this.log.error({ notion: "falhou" }, "sync notion: MySQL não configurado");
      return resultado;
    }

    let notion: Map<string, VagaNotion>;
    try {
      notion = await lerNotion(this.config.NOTION_TOKEN);
    } catch (error) {
      resultado.notion = "falhou";
      this.log.error({ notion: "falhou", erro: error instanceof Error ? error.message : String(error) }, "sync notion: leitura do Notion falhou, nada gravado");
      return resultado;
    }

    const { supabase, postgres } = await this.vagasDoSistema();
    const ids = [...new Set([...supabase.keys(), ...postgres.keys()])];
    if (!ids.length) return this.fim(resultado);

    const [linhas] = await this.mysql.query<VagaLightsail[]>(
      `SELECT v.id_vaga, v.codigo, v.id_empresa, v.texto_carga, v.horabase, v.hora_saida_base, v.semanas_inicio, v.semanas_fim,
              v.tempo_refeicao, ${CAMPOS_GRADE.map((campo) => `v.${campo}`).join(", ")}, e.bairro, e.cidade, e.uf
       FROM vaga v JOIN empresa e ON e.id_empresa = v.id_empresa
       WHERE v.status = 0 AND e.sede = 10 AND v.id_vaga IN (?)`,
      [ids],
    );

    const empresasVistas = new Set<string>();
    for (const vaga of linhas) {
      resultado.lidas += 1;
      const codigo = String(vaga.codigo ?? "").trim().toUpperCase();
      const doNotion = /^[A-Z]{2,5}-\d{3,5}$/.test(codigo) ? notion.get(codigo) : undefined;
      // O Notion manda: com dois turnos, os dois entram no texto e a grade usa o primeiro.
      const turnos = doNotion ? turnosDe(doNotion.linhasHorario) : null;
      if (!doNotion || !turnos) {
        resultado.pendentes += 1;
        continue;
      }
      try {
        const mudou = await this.aplicarVaga(vaga, codigo, turnos, supabase.get(vaga.id_vaga) ?? null, postgres.get(vaga.id_vaga) ?? null, dry, resultado);
        if (doNotion.localPartes && !empresasVistas.has(vaga.id_empresa)) {
          empresasVistas.add(vaga.id_empresa);
          await this.aplicarEmpresa(vaga, codigo, doNotion.localPartes, dry, resultado);
        }
        if (mudou) resultado.aplicadas += 1;
        else resultado.iguais += 1;
      } catch (error) {
        resultado.erros += 1;
        this.log.error({ codigo, id_vaga: vaga.id_vaga, erro: error instanceof Error ? error.message : String(error) }, "sync notion: falha ao aplicar vaga");
      }
    }
    return this.fim(resultado);
  }

  private fim(resultado: ResultadoSync) {
    const { dry, notion, lidas, aplicadas, iguais, pendentes, locais, erros } = resultado;
    this.log.info({ dry, notion, lidas, aplicadas, iguais, pendentes, locais, erros }, "sync notion: fim do ciclo");
    return resultado;
  }

  private async vagasDoSistema() {
    const supabase = new Map<string, VagaEspelho>();
    const postgres = new Map<string, VagaEspelho>();
    if (this.config.SUPABASE_URL && this.config.SUPABASE_SERVICE_ROLE_KEY) {
      const rest = supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
      for (let offset = 0; ; offset += 1000) {
        const pagina = await rest.get<VagaEspelho[]>(`vaga?select=id,vaga_id,empresa_id,horario&order=id&limit=1000&offset=${offset}`);
        for (const row of pagina) supabase.set(row.id, row);
        if (pagina.length < 1000) break;
      }
    }
    const { rows } = await this.db.query<VagaEspelho>("SELECT id::text AS id, vaga_id::text AS vaga_id, empresa_id::text AS empresa_id, horario FROM public.vaga")
      .catch(() => ({ rows: [] as VagaEspelho[] }));
    for (const row of rows) postgres.set(row.id, row);
    return { supabase, postgres };
  }

  private async aplicarVaga(
    vaga: VagaLightsail,
    codigo: string,
    turnos: Turnos,
    supabase: VagaEspelho | null,
    postgres: VagaEspelho | null,
    dry: boolean,
    resultado: ResultadoSync,
  ) {
    const antes = camposAtuais(vaga);
    const depois = camposNovos(turnos, antes);
    const novoHorario = horarioEspelho(turnos, String(depois.tempo_refeicao), supabase?.horario ?? postgres?.horario ?? null);
    const lightsailIgual = iguais(antes, depois);
    const supabaseIgual = !supabase || supabase.horario === novoHorario;
    const postgresIgual = !postgres || postgres.horario === novoHorario;
    if (lightsailIgual && supabaseIgual && postgresIgual) return false;

    const mudanca: MudancaVaga = {
      codigo, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, antes, depois,
      horario_espelho: { antes_supabase: supabase?.horario ?? null, antes_postgres: postgres?.horario ?? null, depois: novoHorario },
    };
    resultado.vagas.push(mudanca);
    this.log.info({
      dry, codigo, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa,
      antes: { texto: antes.texto_carga, base: `${antes.horabase}-${antes.hora_saida_base}`, semanas: `${antes.semanas_inicio}-${antes.semanas_fim}`, grade: resumoGrade(antes) },
      depois: { texto: depois.texto_carga, base: `${depois.horabase}-${depois.hora_saida_base}`, semanas: `${depois.semanas_inicio}-${depois.semanas_fim}`, grade: resumoGrade(depois) },
    }, "sync notion: horário da vaga");
    if (dry) return true;

    if (!lightsailIgual) {
      const campos = Object.keys(depois);
      await this.mysql!.query(
        `UPDATE vaga SET ${campos.map((campo) => `${campo} = ?`).join(", ")} WHERE id_vaga = ? AND status = 0`,
        [...campos.map((campo) => depois[campo]), vaga.id_vaga],
      );
    }
    if (supabase && !supabaseIgual) {
      const rest = supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY });
      await rest.update(`vaga?id=eq.${vaga.id_vaga}`, { horario: novoHorario });
      if (supabase.vaga_id && supabase.horario != null) {
        await rest.update(`vaga_repetida?vaga_id=eq.${supabase.vaga_id}&horario=eq.${encodeURIComponent(supabase.horario)}`, { horario: novoHorario });
      }
    }
    if (postgres && !postgresIgual) {
      await this.db.query("UPDATE public.vaga SET horario = $1 WHERE id = $2", [novoHorario, vaga.id_vaga]);
      if (postgres.vaga_id && postgres.horario != null) {
        await this.db.query("UPDATE public.vaga_repetida SET horario = $1 WHERE vaga_id = $2 AND horario = $3", [novoHorario, postgres.vaga_id, postgres.horario]);
      }
    }
    return true;
  }

  private async aplicarEmpresa(vaga: VagaLightsail, codigo: string, partes: LocalPartes, dry: boolean, resultado: ResultadoSync) {
    const antes: LocalPartes = { bairro: vaga.bairro ?? "", cidade: vaga.cidade ?? "", uf: vaga.uf ?? "" };
    // Só troca o que o Notion trouxe; cidade e UF ausentes ficam como estão.
    const depois: LocalPartes = {
      bairro: partes.bairro.slice(0, 50),
      cidade: (partes.cidade || antes.cidade).slice(0, 100),
      uf: (partes.uf || antes.uf).slice(0, 5),
    };
    if (mesmoTexto(antes.bairro, depois.bairro) && mesmoTexto(antes.cidade, depois.cidade) && mesmoTexto(antes.uf, depois.uf)) return;
    const local = formatarLocal(depois);
    resultado.empresas.push({ id_empresa: vaga.id_empresa, codigo, antes, depois, local });
    resultado.locais += 1;
    this.log.info({ dry, codigo, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, antes, depois }, "sync notion: bairro da empresa");
    if (dry) return;
    await this.mysql!.query("UPDATE empresa SET bairro = ?, cidade = ?, uf = ? WHERE id_empresa = ?", [depois.bairro, depois.cidade, depois.uf, vaga.id_empresa]);
    if (this.config.SUPABASE_URL && this.config.SUPABASE_SERVICE_ROLE_KEY) {
      await supabaseRest({ url: this.config.SUPABASE_URL, key: this.config.SUPABASE_SERVICE_ROLE_KEY })
        .update(`empresa?id=eq.${vaga.id_empresa}`, { local })
        .catch((error: unknown) => this.log.error({ codigo, id_empresa: vaga.id_empresa, erro: error instanceof Error ? error.message : String(error) }, "sync notion: falha no local do Supabase"));
    }
    await this.db.query("UPDATE public.empresa SET local = $1 WHERE id = $2", [local, vaga.id_empresa])
      .catch((error: unknown) => this.log.error({ codigo, id_empresa: vaga.id_empresa, erro: error instanceof Error ? error.message : String(error) }, "sync notion: falha no local do Postgres"));
  }
}
