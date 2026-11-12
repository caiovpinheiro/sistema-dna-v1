import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { MysqlPool } from "../db/mysql.js";
import { moneyToNumber } from "../lib/money.js";
import { reagruparVagaIds, type MudancaVagaId } from "../lib/vaga-id.js";
import { sincronizarEnderecoEmpresas, type EnderecoAtualizado } from "../lib/empresa-endereco.js";
import type { Logger } from "./notion-sync.service.js";

/** Colunas da grade no Lightsail, na numeração 1 domingo … 7 sábado. O Lightsail escreve "domindo". */
const COLUNAS_DIA: Record<number, string> = { 1: "domindo", 2: "segunda", 3: "terca", 4: "quarta", 5: "quinta", 6: "sexta", 7: "sab" };
const TIPO_BENEFICIO: Record<string, string> = { M: "Mensal", D: "Diário", S: "Semanal" };
const JORNADA: Record<number, string> = { 0: "fixa", 1: "escala" };
const TIPO_TRABALHO: Record<number, string> = { 0: "presencial", 1: "remoto", 2: "hibrido" };

type VagaLightsail = RowDataPacket & Record<string, unknown> & {
  id_vaga: string;
  id_empresa: string;
  comparador: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
};

type EmpresaNova = { id: string; grupo_id: string | null; cep: string | null; latitude: number | null; longitude: number | null };
type Espelho = { id: string; vaga_id: string | null };

export type LinhaVaga = {
  id: string;
  vaga_id: string;
  grupo_id: string | null;
  empresa_id: string;
  tipo_vaga: number;
  cargo: string;
  salario: number | null;
  carga_horaria: string | null;
  escolaridade: string | null;
  sexo: string | null;
  idade: number | null;
  idade_ate: number | null;
  km: number | null;
  atividades: string | null;
  tempo: null;
  horario: string;
  turno: string | null;
  beneficios: string | null;
  conducoes: null;
  jornada: string | null;
  tipo_trabalho: string | null;
  cep: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type EmpresaPendenteSync = { nome: string; cnpj: string; vagas: number };

export type ResultadoAbertas = {
  dry: boolean;
  lidas: number;
  novas: number;
  jaExistiam: number;
  fora: number;
  erros: number;
  pendentes: EmpresaPendenteSync[];
  inseridas: string[];
  apagadas: string[];
  /** Vagas abertas que já estavam em public.vaga e foram alinhadas ao cadastro (grade, turno, idade, salário, benefícios). */
  atualizadas: Array<{ id_vaga: string; codigo: string; campos: string[] }>;
  /** Vagas que mudaram de vaga_id: o mesmo só para vagas repetidas da mesma empresa com todos os detalhes iguais. */
  reagrupadas: MudancaVagaId[];
  /** Empresas cujo endereço mudou na ficha: a triagem passa a medir a distância pelo endereço novo. */
  enderecos: EnderecoAtualizado[];
};

const COLUNAS_INSERT = [
  "id", "vaga_id", "grupo_id", "empresa_id", "tipo_vaga", "cargo", "salario", "carga_horaria", "escolaridade", "sexo", "idade", "idade_ate",
  "km", "atividades", "tempo", "horario", "turno", "beneficios", "conducoes", "jornada", "tipo_trabalho", "cep", "latitude", "longitude",
] as const;

function texto(valor: unknown): string {
  return valor == null ? "" : String(valor).trim();
}

function hora(valor: unknown): string | null {
  const raw = texto(valor);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

function inteiro(valor: unknown): number | null {
  const numero = Number.parseInt(texto(valor), 10);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Faixa de dias da semana (1 domingo … 7 sábado), como as vagas antigas gravam: começa no primeiro dia com horário
 * a partir de segunda e termina no último ("2-6" segunda a sexta, "2-1" segunda a domingo). Sem dia com horário, null.
 */
export function faixaDaSemana(vaga: Record<string, unknown>): { inicio: number; fim: number } | null {
  const ordem = [2, 3, 4, 5, 6, 7, 1];
  const comHora = ordem.filter((numero) => hora(vaga[`${COLUNAS_DIA[numero]}_entrada`]) && hora(vaga[`${COLUNAS_DIA[numero]}_saida`]));
  if (!comHora.length) return null;
  return { inicio: comHora[0], fim: comHora[comHora.length - 1] };
}

/**
 * Grade no formato do cadastro: turno;início-fim;intervalo;1=..;…;7=..;texto=…
 * Cada dia usa as próprias colunas; dia sem hora (vazio ou "0") dentro da faixa usa horabase/hora_saida_base, como no Lightsail.
 * O intervalo é o tempo_refeicao da vaga (00:00 quando vazio).
 */
export function horarioDe(vaga: Record<string, unknown>): string {
  const inicio = inteiro(vaga.semanas_inicio) ?? 0;
  const fim = inteiro(vaga.semanas_fim) ?? 0;
  const naFaixa = (numero: number) => inicio > 0 && fim > 0 && (fim >= inicio ? numero >= inicio && numero <= fim : numero >= inicio || numero <= fim);
  const base = { entrada: hora(vaga.horabase), saida: hora(vaga.hora_saida_base) };
  const dias = [1, 2, 3, 4, 5, 6, 7].map((numero) => {
    const coluna = COLUNAS_DIA[numero];
    const entrada = hora(vaga[`${coluna}_entrada`]);
    const saida = hora(vaga[`${coluna}_saida`]);
    if (entrada && saida) return `${numero}=${entrada}-${saida}`;
    if (naFaixa(numero) && base.entrada && base.saida) return `${numero}=${base.entrada}-${base.saida}`;
    return `${numero}=`;
  });
  const partes = [texto(vaga.periodo), `${inicio}-${fim}`, hora(vaga.tempo_refeicao) ?? "00:00", ...dias];
  const carga = texto(vaga.texto_carga);
  if (carga) partes.push(`texto=${carga}`);
  return partes.join(";");
}

/** "Auxílio Transporte — R$ 10,00 — Diário", em ordem alfabética, uma linha por benefício. */
export function beneficiosDe(lista: Array<{ nome: string; valor: string; tipo: string }>): string | null {
  const linhas = lista
    .filter((item) => item.nome.trim())
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((item) => [item.nome.trim(), item.valor.trim() ? `R$ ${item.valor.trim()}` : "", TIPO_BENEFICIO[item.tipo] ?? ""].filter(Boolean).join(" — "));
  return linhas.length ? linhas.join("\n") : null;
}

type CamposEspelho = { id: string; vaga_id: string | null; horario: string | null; turno: string | null; idade: number | null; idade_ate: number | null; salario: number | string | null; beneficios: string | null };

/** Texto do espelho com cada caractere fora do Latin-1 (emoji) trocado por "?", como o Lightsail grava. */
function comoLightsail(valor: string) {
  return Array.from(valor, (caractere) => ((caractere.codePointAt(0) ?? 0) > 0xff ? "?" : caractere)).join("");
}

/**
 * Grade do Lightsail com o texto do espelho quando é o mesmo texto: o Lightsail troca emoji por "?" e corta em 255 caracteres.
 * Devolve o novo valor, ou null quando o espelho já está igual.
 */
export function horarioAlinhado(espelho: string | null, doLightsail: string): string | null {
  const [gradeNova, ...restoNovo] = doLightsail.split(";texto=");
  const textoNovo = restoNovo.join(";texto=");
  const textoAtual = (espelho ?? "").split(";texto=").slice(1).join(";texto=");
  const manterTexto = Boolean(textoAtual && textoNovo && comoLightsail(textoAtual).startsWith(textoNovo.trimEnd()));
  const texto = manterTexto ? textoAtual : textoNovo;
  const novo = texto ? `${gradeNova};texto=${texto}` : gradeNova;
  return novo === (espelho ?? "") ? null : novo;
}

/** Campos do espelho que diferem do Lightsail. Benefícios, idade e salário só mudam quando o Lightsail tem valor. */
export function diferencasEspelho(atual: CamposEspelho, linha: LinhaVaga): Record<string, unknown> {
  const mudar: Record<string, unknown> = {};
  const horario = horarioAlinhado(atual.horario, linha.horario);
  if (horario !== null) mudar.horario = horario;
  if ((atual.turno ?? null) !== (linha.turno ?? null)) mudar.turno = linha.turno;
  if (linha.idade != null && Number(atual.idade) !== linha.idade) mudar.idade = linha.idade;
  if (linha.idade_ate != null && Number(atual.idade_ate) !== linha.idade_ate) mudar.idade_ate = linha.idade_ate;
  if (linha.salario != null && linha.salario > 0 && Math.abs(Number(atual.salario ?? 0) - linha.salario) >= 0.01) mudar.salario = linha.salario;
  if (linha.beneficios && linha.beneficios !== (atual.beneficios ?? "")) mudar.beneficios = linha.beneficios;
  return mudar;
}

export class VagasAbertasSyncService {
  constructor(
    private readonly db: Pool,
    private readonly mysql: MysqlPool | null,
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {}

  async executar(dry: boolean, slot: string): Promise<ResultadoAbertas> {
    const resultado: ResultadoAbertas = { dry, lidas: 0, novas: 0, jaExistiam: 0, fora: 0, erros: 0, pendentes: [], inseridas: [], apagadas: [], atualizadas: [], reagrupadas: [], enderecos: [] };
    if (!this.mysql) {
      this.log.error({ slot }, "sync vagas: MySQL não configurado");
      return resultado;
    }

    // 0) Endereço da ficha que mudou volta para public.empresa e public.vaga, antes de copiar vagas novas com a coordenada da empresa.
    try {
      resultado.enderecos = await sincronizarEnderecoEmpresas(this.db, this.config.GOOGLE_MAPS_API_KEY, this.log, { dry });
    } catch (error) {
      resultado.erros += 1;
      this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao conferir o endereço das empresas");
    }

    const [postgres, empresas] = await Promise.all([
      this.db.query<Espelho>("SELECT id::text AS id, vaga_id::text AS vaga_id FROM public.vaga").then((r) => r.rows),
      this.db.query<EmpresaNova>(
        "SELECT id::text AS id, grupo_id::text AS grupo_id, cep, latitude, longitude FROM public.empresa",
      ).then((r) => r.rows),
    ]);
    const noSistema = new Map<string, string | null>();
    for (const row of postgres) noSistema.set(row.id, row.vaga_id);
    const empresaPorId = new Map(empresas.map((empresa) => [empresa.id, empresa]));

    // 1) Copiar as novas.
    const [abertas] = await this.mysql.query<VagaLightsail[]>(`
      SELECT v.*, e.nome_fantasia, e.razao_social, e.cnpj
      FROM vaga v
      INNER JOIN empresa e ON e.id_empresa = v.id_empresa
      WHERE e.sede = 10 AND v.status = 0 AND v.tipo_vaga IN (1, 2, 4)
    `);
    resultado.lidas = abertas.length;
    const pendentes = new Map<string, EmpresaPendenteSync>();
    const novas: VagaLightsail[] = [];
    for (const vaga of abertas) {
      if (noSistema.has(vaga.id_vaga)) {
        resultado.jaExistiam += 1;
        continue;
      }
      if (!empresaPorId.has(vaga.id_empresa)) {
        const atual = pendentes.get(vaga.id_empresa) ?? { nome: texto(vaga.nome_fantasia) || texto(vaga.razao_social), cnpj: texto(vaga.cnpj), vagas: 0 };
        atual.vagas += 1;
        pendentes.set(vaga.id_empresa, atual);
        continue;
      }
      novas.push(vaga);
    }
    resultado.pendentes = [...pendentes.values()];

    if (novas.length) {
      const beneficios = await this.beneficios(novas.map((vaga) => vaga.id_vaga));
      for (const vaga of novas) {
        const empresa = empresaPorId.get(vaga.id_empresa)!;
        const linha = this.linhaDe(vaga, empresa, beneficios.get(vaga.id_vaga) ?? []);
        // Provisório: no fim do sync o vaga_id é recalculado (vagas repetidas da mesma empresa, com tudo igual, dividem o mesmo).
        linha.vaga_id = randomUUID();
        resultado.novas += 1;
        this.log.info({ dry, slot, id_vaga: linha.id, empresa_id: linha.empresa_id, vaga_id: linha.vaga_id, cargo: linha.cargo }, "sync vagas: nova");
        if (dry) {
          resultado.inseridas.push(linha.id);
          continue;
        }
        try {
          await this.inserir(linha);
          noSistema.set(linha.id, linha.vaga_id);
          resultado.inseridas.push(linha.id);
        } catch (error) {
          resultado.erros += 1;
          resultado.novas -= 1;
          this.log.error({ slot, id_vaga: linha.id, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: cópia falhou, vaga não foi gravada");
        }
      }
    }

    // 1b) Alinhar public.vaga das abertas que já estavam no sistema (o cadastro ou a grade podem ter mudado no Lightsail).
    try {
      await this.alinharEspelho(abertas, empresaPorId, dry, slot, resultado);
    } catch (error) {
      resultado.erros += 1;
      this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao alinhar as vagas");
    }

    // 2) Apagar as fechadas (só a linha de public.vaga).
    const ids = [...noSistema.keys()];
    if (ids.length) {
      const [status] = await this.mysql.query<RowDataPacket[]>("SELECT id_vaga, status FROM vaga WHERE id_vaga IN (?)", [ids]);
      for (const row of status) {
        const valor = row.status;
        if (typeof valor !== "number" || !Number.isInteger(valor) || valor === 0) continue;
        resultado.fora += 1;
        this.log.info({ dry, slot, id_vaga: row.id_vaga, status: valor }, "sync vagas: fechada, sai do sistema");
        if (dry) {
          resultado.apagadas.push(String(row.id_vaga));
          continue;
        }
        try {
          await this.db.query("DELETE FROM public.vaga WHERE id = $1", [row.id_vaga]);
          resultado.apagadas.push(String(row.id_vaga));
        } catch (error) {
          resultado.erros += 1;
          resultado.fora -= 1;
          this.log.error({ slot, id_vaga: row.id_vaga, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao apagar");
        }
      }
    }

    // 3) vaga_id no Postgres: o mesmo só para vagas repetidas da mesma empresa com todos os detalhes iguais.
    try {
      resultado.reagrupadas = await reagruparVagaIds(this.db, dry);
    } catch (error) {
      resultado.erros += 1;
      this.log.error({ slot, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao recalcular o vaga_id");
    }

    const { lidas, novas: inseridas, jaExistiam, fora, erros } = resultado;
    this.log.info({
      dry, slot, lidas, novas: inseridas, jaExistiam, fora, erros, atualizadas: resultado.atualizadas.length,
      reagrupadas: resultado.reagrupadas.length, enderecos: resultado.enderecos.length,
      pendentes: resultado.pendentes.map((item) => `${item.nome} | ${item.cnpj} | ${item.vagas}`),
    }, "sync vagas: fim");
    return resultado;
  }

  /** Abertas que já estão em public.vaga: alinha ao cadastro do Postgres (dna_work.vaga; sem ele, o Lightsail). */
  private async alinharEspelho(abertas: VagaLightsail[], empresaPorId: Map<string, EmpresaNova>, dry: boolean, slot: string, resultado: ResultadoAbertas) {
    const lista = abertas.filter((vaga) => empresaPorId.has(vaga.id_empresa));
    if (!lista.length) return;
    const ids = lista.map((vaga) => vaga.id_vaga);
    const doPostgres = (await this.db.query<CamposEspelho>(
      "SELECT id::text AS id, vaga_id::text AS vaga_id, horario, turno, idade, idade_ate, salario, beneficios FROM public.vaga WHERE id::text = ANY($1)",
      [ids],
    )).rows;
    const postgresPorId = new Map(doPostgres.map((row) => [row.id, row]));
    const presentes = lista.filter((vaga) => postgresPorId.has(vaga.id_vaga));
    if (!presentes.length) return;
    const beneficios = await this.beneficios(presentes.map((vaga) => vaga.id_vaga));
    // Referência do cadastro: dna_work.vaga (o que o sistema mostra e a tela Editar vaga grava).
    // Sem a linha lá, vale o Lightsail. O id da empresa e o status sempre vêm do Lightsail.
    const { rows: doCadastro } = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM dna_work.vaga WHERE id_vaga = ANY($1)",
      [presentes.map((vaga) => vaga.id_vaga)],
    );
    const cadastroPorId = new Map(doCadastro.map((row) => [String(row.id_vaga), row]));

    for (const vaga of presentes) {
      const cadastro = cadastroPorId.get(vaga.id_vaga);
      const fonte = (cadastro ? { ...vaga, ...cadastro, id_vaga: vaga.id_vaga, id_empresa: vaga.id_empresa, status: vaga.status } : vaga) as VagaLightsail;
      const linha = this.linhaDe(fonte, empresaPorId.get(vaga.id_empresa)!, beneficios.get(vaga.id_vaga) ?? []);
      const atual = postgresPorId.get(vaga.id_vaga)!;
      const codigo = texto(vaga.codigo);
      try {
        const mudar = diferencasEspelho(atual, linha);
        const nomes = Object.keys(mudar);
        if (!nomes.length) continue;
        resultado.atualizadas.push({ id_vaga: vaga.id_vaga, codigo, campos: nomes });
        this.log.info({ dry, slot, id_vaga: vaga.id_vaga, codigo, campos: nomes }, "sync vagas: vaga alinhada ao cadastro");
        if (dry) continue;
        const sets = nomes.map((nome, indice) => `${nome} = $${indice + 2}`).join(", ");
        await this.db.query(`UPDATE public.vaga SET ${sets} WHERE id::text = $1`, [vaga.id_vaga, ...nomes.map((nome) => mudar[nome])]);
      } catch (error) {
        resultado.erros += 1;
        this.log.error({ slot, id_vaga: vaga.id_vaga, codigo, erro: error instanceof Error ? error.message : String(error) }, "sync vagas: falha ao alinhar a vaga");
      }
    }
  }

  private async beneficios(ids: string[]) {
    const [rows] = await this.mysql!.query<RowDataPacket[]>(
      `SELECT bv.id_vaga, bv.valor, bv.tipo, b.beneficios AS nome
       FROM beneficio_vaga bv JOIN beneficio b ON b.id = bv.id_beneficio
       WHERE bv.id_vaga IN (?)`,
      [ids],
    );
    const porVaga = new Map<string, Array<{ nome: string; valor: string; tipo: string }>>();
    for (const row of rows) {
      const lista = porVaga.get(String(row.id_vaga)) ?? [];
      lista.push({ nome: texto(row.nome), valor: texto(row.valor), tipo: texto(row.tipo) });
      porVaga.set(String(row.id_vaga), lista);
    }
    return new Map([...porVaga].map(([id, lista]) => [id, lista]));
  }

  private linhaDe(vaga: VagaLightsail, empresa: EmpresaNova, beneficios: Array<{ nome: string; valor: string; tipo: string }>): LinhaVaga {
    const jornada = inteiro(vaga.jornada);
    const remoto = inteiro(vaga.remoto);
    const km = Number(texto(vaga.km).replace(",", "."));
    return {
      id: vaga.id_vaga,
      vaga_id: "",
      grupo_id: empresa.grupo_id,
      empresa_id: vaga.id_empresa,
      tipo_vaga: inteiro(vaga.tipo_vaga) ?? 0,
      cargo: texto(vaga.cargo),
      salario: moneyToNumber(texto(vaga.salario)),
      carga_horaria: texto(vaga.carga_horaria) || null,
      escolaridade: texto(vaga.escolaridade) || null,
      sexo: texto(vaga.sexo) || null,
      idade: inteiro(vaga.idade),
      idade_ate: inteiro(vaga.idadeate),
      km: texto(vaga.km) && Number.isFinite(km) ? km : null,
      atividades: texto(vaga.atribuicaoes) || null,
      tempo: null,
      horario: horarioDe(vaga),
      turno: texto(vaga.periodo) || null,
      beneficios: beneficiosDe(beneficios),
      conducoes: null,
      jornada: jornada == null ? null : JORNADA[jornada] ?? null,
      tipo_trabalho: remoto == null ? null : TIPO_TRABALHO[remoto] ?? null,
      cep: empresa.cep,
      latitude: empresa.latitude,
      longitude: empresa.longitude,
    };
  }

  /** Grava a vaga nova em public.vaga. */
  private async inserir(linha: LinhaVaga) {
    const colunas = COLUNAS_INSERT.join(", ");
    const marcadores = COLUNAS_INSERT.map((_, indice) => `$${indice + 1}`).join(", ");
    await this.db.query(`INSERT INTO public.vaga (${colunas}) VALUES (${marcadores})`, COLUNAS_INSERT.map((coluna) => linha[coluna]));
  }
}
