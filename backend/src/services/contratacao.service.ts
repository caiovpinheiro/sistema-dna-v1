import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import type { SchemaCapabilities } from "../db/capabilities.js";
import { AppError, migrationRequired } from "../lib/errors.js";
import { isoToLegacy, legacyToIso, legacyToday } from "../lib/dates.js";
import { classifyRegime } from "../lib/normalize.js";
import { CandidatoRepository } from "../repositories/candidato.repository.js";
import { ContratacaoRepository } from "../repositories/contratacao.repository.js";
import { one } from "../repositories/sql.js";
import { VagaRepository } from "../repositories/vaga.repository.js";
import type { ContratacaoCreate, ContratacaoEncerrar, ContratacaoListQuery } from "../schemas/contratacao.js";
import { buildRescisaoPdf, type RescisaoPdfDados } from "../lib/rescisao-pdf.js";
import { consultarDocumentoZapSign, criarDocumentoZapSign, type ZapDoc } from "../lib/zapsign.js";
import { moneyToNumber } from "../lib/money.js";
import { presentContratacao, vagaSituacao } from "./presenters.js";
import type { ProcessoService } from "./processo.service.js";

type StoredResponse = { statusCode: number; body: unknown };

type ParteAssinatura = {
  papel: string;
  nome: string;
  email: string;
  status: string;
  url: string | null;
  assinado_em: string | null;
};

type DocRescisao = {
  nome: string;
  motivo: string;
  avaliacao: string | null;
  resumo: string | null;
  data_demissao: string;
  assinatura: string | null;
  signatarios: string | null;
  preview_url: string | null;
  enviado_em: string | null;
  zapsign_token: string | null;
};

export class ContratacaoService {
  constructor(
    private readonly db: Pool,
    private readonly repo: ContratacaoRepository,
    private readonly vagas: VagaRepository,
    private readonly candidatos: CandidatoRepository,
    private readonly config: AppConfig,
    private readonly capabilities: SchemaCapabilities,
    private readonly processos: ProcessoService,
  ) {}

  private ensureReady() {
    if (this.capabilities.missing.length) throw migrationRequired(this.capabilities.missing);
  }

  private present(row: NonNullable<Awaited<ReturnType<ContratacaoRepository["findById"]>>>) {
    return presentContratacao(row, this.config.CONTRATACAO_STATUS_ATIVO, this.config.CONTRATACAO_STATUS_ENCERRADO);
  }

  async list(query: ContratacaoListQuery) {
    const result = await this.repo.list(this.db, query);
    return {
      data: result.rows.map((row) => this.present(row)),
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    };
  }

  async get(id: number) {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    return this.present(row);
  }

  async listByCandidato(idCandidato: string, page: number, pageSize: number) {
    const candidato = await this.candidatos.findById(this.db, idCandidato);
    if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
    return this.list({ page, pageSize, order: "desc", id_candidato: idCandidato });
  }

  async listByEmpresa(idEmpresa: string, page: number, pageSize: number) {
    return this.list({ page, pageSize, order: "desc", id_empresa: idEmpresa });
  }

  async listByVaga(idVaga: string, page: number, pageSize: number) {
    const vaga = await this.vagas.findById(this.db, idVaga);
    if (!vaga) throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
    return this.list({ page, pageSize, order: "desc", id_vaga: idVaga });
  }

  async create(input: ContratacaoCreate, idempotencyKey: string) {
    this.ensureReady();
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const replay = await this.claimIdempotency(client, idempotencyKey, hash);
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.id_candidato]);
      const vaga = await this.vagas.lockById(client, input.id_vaga);
      if (!vaga || !vaga.id_empresa) {
        throw new AppError(404, "VAGA_NAO_ENCONTRADA", "Vaga não encontrada.");
      }
      if (input.id_empresa && input.id_empresa !== vaga.id_empresa) {
        throw new AppError(409, "EMPRESA_DIVERGENTE", "A empresa informada não é a dona da vaga.", {
          id_empresa: vaga.id_empresa,
        });
      }
      const situacao = vagaSituacao(vaga, this.config.vagaStatusBloqueadas);
      if (situacao === "encerrada") {
        throw new AppError(409, "VAGA_ENCERRADA", "A vaga não está habilitada para contratação.");
      }
      if (situacao === "capacidade_pendente") {
        throw new AppError(409, "CAPACIDADE_NAO_CONFIGURADA", "Defina a quantidade de posições da vaga antes de contratar.");
      }
      const regime = classifyRegime(vaga.modalidade);
      if (regime === "outro") {
        throw new AppError(422, "MODALIDADE_NAO_SUPORTADA", "Esta versão contrata apenas vagas de CLT ou estágio.", {
          modalidade: vaga.modalidade,
        });
      }
      const candidato = await this.candidatos.findById(client, input.id_candidato);
      if (!candidato) throw new AppError(404, "CANDIDATO_NAO_ENCONTRADO", "Candidato não encontrado.");
      const duplicate = await this.repo.findActiveDuplicate(
        client, vaga.id_vaga, candidato.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO,
      );
      if (duplicate) {
        throw new AppError(409, "VINCULO_DUPLICADO", "O candidato já possui vínculo ativo nesta vaga.", {
          id_contratacao: duplicate.id_contratacao,
        });
      }
      if (!this.config.ALLOW_MULTIPLE_ACTIVE_LINKS) {
        const other = await this.repo.findOtherActive(client, candidato.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO);
        if (other) {
          throw new AppError(409, "CANDIDATO_JA_ATIVO", "O candidato já possui um vínculo ativo. A liberação de vínculos simultâneos ainda não foi confirmada.", {
            id_contratacao: other.id_contratacao,
          });
        }
      }
      if (situacao === "preenchida") {
        throw new AppError(409, "VAGA_SEM_POSICAO", "Todas as posições desta vaga já estão ocupadas.");
      }
      const ocupadas = await this.repo.countActiveByVaga(client, vaga.id_vaga, this.config.CONTRATACAO_STATUS_ATIVO);
      if (vaga.quantidade_posicoes == null || ocupadas.total >= vaga.quantidade_posicoes) {
        throw new AppError(409, "VAGA_SEM_POSICAO", "Todas as posições desta vaga já estão ocupadas.");
      }
      const idContratacao = await this.repo.insert(client, {
        idVaga: vaga.id_vaga,
        idCandidato: candidato.id_candidato,
        idEmpresa: vaga.id_empresa,
        dataContratacao: legacyToday(),
        dataInicio: isoToLegacy(input.data_inicio),
        dataFim: input.data_fim ? isoToLegacy(input.data_fim) : null,
        status: this.config.CONTRATACAO_STATUS_ATIVO,
        contador: candidato.contador,
        comparador: vaga.comparador,
      });
      const idColaborador = randomUUID();
      await this.repo.insertColaborador(client, {
        idColaborador,
        idCandidato: candidato.id_candidato,
        idEmpresa: vaga.id_empresa,
        dataInicio: isoToLegacy(input.data_inicio),
        cargo: vaga.cargo,
        tipoVaga: vaga.tipo_vaga,
        salario: vaga.salario,
        cargaHoraria: vaga.carga_horaria,
        dataCadastro: legacyToday(),
        status: this.config.COLABORADOR_STATUS_ATIVO,
        idContratacao,
      });
      await this.repo.atualizarFlagCandidato(client, candidato.id_candidato, vaga.id_empresa, true, legacyToday());
      await this.processos.vincularContratacao(client, {
        idProcesso: input.id_processo,
        idCandidato: candidato.id_candidato,
        idVaga: vaga.id_vaga,
        idContratacao,
      });
      const depois = ocupadas.total + 1;
      if (vaga.quantidade_posicoes != null && depois >= vaga.quantidade_posicoes) {
        await this.vagas.setStatus(client, vaga.id_vaga, this.config.VAGA_STATUS_OCUPADA);
      }
      const saved = await this.repo.findById(client, idContratacao);
      const body = {
        success: true,
        data: {
          ...this.present(saved!),
          id_colaborador: idColaborador,
          regime,
        },
        meta: {},
      };
      await client.query(
        "UPDATE dna_work.api_idempotencia SET status_code = 201, response = $2::jsonb WHERE chave = $1",
        [idempotencyKey, JSON.stringify(body)],
      );
      await client.query("COMMIT");
      return { statusCode: 201, body };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async documentos(id: number) {
    this.ensureReady();
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    const docs = await this.repo.listarRescisoes(this.db, id);
    const gerados = docs.map((item) => ({
      id: item.id,
      nome: item.nome,
      vaga: item.cargo,
      empresa: item.empresa,
      data: item.data_demissao,
      devolvido_por: "—",
      assinatura: item.assinatura || "Não assina digitalmente",
      sign_url: item.sign_url,
      pode_assinar: !item.zapsign_token,
      status: "Demitido",
      motivo: item.motivo,
      motivo_interno: item.motivo_interno,
      avaliacao: item.avaliacao,
      resumo: item.resumo,
      texto: item.texto,
      origem: "rescisao" as const,
      signatarios: lerPartes(item.signatarios),
      preview_url: item.preview_url,
      enviado_em: item.enviado_em,
    }));
    const historicos = await this.repo.listarContratosGerados(this.db, row.id_candidato, row.id_vaga);
    return [
      ...gerados,
      ...historicos.map((item) => ({
        ...item,
        sign_url: null,
        pode_assinar: false,
        origem: "historico" as const,
        signatarios: [] as ParteAssinatura[],
        preview_url: null,
        enviado_em: null,
      })),
    ];
  }

  async pdfRescisao(id: number): Promise<Buffer> {
    this.ensureReady();
    const doc = await this.rescisaoAtual(id);
    return buildRescisaoPdf(await this.dadosPdf(id, doc));
  }

  async acompanharAssinatura(id: number) {
    this.ensureReady();
    const doc = await this.rescisaoAtual(id);
    if (doc.zapsign_token) {
      const remoto = await consultarDocumentoZapSign({
        apiUrl: this.config.ZAPSIGN_API_URL,
        apiToken: this.config.ZAPSIGN_API_TOKEN,
        token: doc.zapsign_token,
      });
      if (remoto) await this.persistirZap(id, doc, remoto);
    }
    const atual = await this.rescisaoAtual(id);
    const locais = lerPartes(atual.signatarios);
    return {
      nome: atual.nome,
      status: atual.assinatura || "Não assina digitalmente",
      enviado_em: atual.enviado_em,
      preview_url: atual.preview_url,
      signatarios: locais.length ? locais : await this.partesLocais(id),
    };
  }

  async solicitarAssinatura(id: number) {
    this.ensureReady();
    const doc = await this.rescisaoAtual(id);
    if (doc.zapsign_token) return this.acompanharAssinatura(id);
    const partes = await this.partesLocais(id);
    const signers = partes.filter((item) => item.email.includes("@"));
    if (!signers.length) {
      throw new AppError(422, "EMAIL_AUSENTE", "Candidato ou empresa precisam ter e-mail para a assinatura digital.");
    }
    const pdf = await buildRescisaoPdf(await this.dadosPdf(id, doc));
    const enviado = await criarDocumentoZapSign({
      apiUrl: this.config.ZAPSIGN_API_URL,
      apiToken: this.config.ZAPSIGN_API_TOKEN,
      userToken: this.config.ZAPSIGN_USER_TOKEN || undefined,
      folderPath: this.config.ZAPSIGN_AGENTE_ID ? `/${this.config.ZAPSIGN_AGENTE_ID}` : undefined,
      name: doc.nome,
      externalId: `rescisao-${id}`,
      pdf,
      signers: signers.map((item) => ({ name: item.nome, email: item.email, external_id: item.papel })),
    });
    await this.persistirZap(id, doc, enviado, partes);
    return this.acompanharAssinatura(id);
  }

  async receberAssinatura(payload: Record<string, unknown>): Promise<boolean> {
    const token = String(payload.token ?? "");
    const status = `${payload.event_type ?? ""} ${payload.status ?? ""}`.toLowerCase();
    if (!token) return false;
    const assinatura = status.includes("refus") ? "Recusado" : status.includes("signed") ? "Assinado" : "";
    if (!assinatura) return false;
    return this.repo.marcarAssinaturaPorToken(this.db, token, assinatura);
  }

  async encerrar(id: number, input: ContratacaoEncerrar) {
    this.ensureReady();
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const current = await this.repo.lockById(client, id);
      if (!current) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
      if (current.status === this.config.CONTRATACAO_STATUS_ENCERRADO || current.data_demicao) {
        throw new AppError(409, "JA_ENCERRADA", "Esta contratação já está encerrada.");
      }
      if (current.status !== this.config.CONTRATACAO_STATUS_ATIVO) {
        throw new AppError(409, "STATUS_NAO_ENCERRAVEL", "Somente um vínculo ativo pode ser encerrado.");
      }
      if (current.id_vaga) await this.vagas.lockById(client, current.id_vaga);
      const data = isoToLegacy(input.data_encerramento);
      await this.repo.encerrar(client, id, this.config.CONTRATACAO_STATUS_ENCERRADO, data);
      if (input.motivo) {
        const empresa = current.empresa_fantasia || current.empresa_razao;
        const nome = current.tipo_vaga === 1 ? "Rescisão de estágio" : "Rescisão CLT";
        await this.repo.salvarRescisao(client, {
          idContratacao: id,
          nome,
          motivo: input.motivo,
          motivoInterno: input.motivo_interno || null,
          avaliacao: input.avaliacao || null,
          resumo: input.resumo || null,
          dataDemissao: data,
          cargo: current.cargo,
          empresa,
          texto: [
            nome,
            `Candidato: ${current.candidato_nome ?? "—"}`,
            `Empresa: ${empresa ?? "—"}`,
            `Cargo: ${current.cargo ?? "—"}`,
            `Motivo: ${input.motivo}`,
            `Data de demissão: ${input.data_encerramento.split("-").reverse().join("/")}`,
            `Avaliação: ${input.avaliacao || "—"}`,
            "",
            "Resumo das atividades",
            input.resumo || "—",
            input.motivo_interno ? `\nMotivo interno\n${input.motivo_interno}` : "",
          ].join("\n"),
        });
      }
      await this.repo.encerrarColaborador(client, id, this.config.COLABORADOR_STATUS_INATIVO);
      if (current.id_candidato) {
        const other = await this.repo.findOtherActive(client, current.id_candidato, this.config.CONTRATACAO_STATUS_ATIVO);
        if (!other) await this.repo.atualizarFlagCandidato(client, current.id_candidato, null, false, legacyToday());
      }
      const saved = await this.repo.findById(client, id);
      await client.query("COMMIT");
      return this.present(saved!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async rescisaoAtual(id: number): Promise<DocRescisao> {
    const row = await this.repo.findById(this.db, id);
    if (!row) throw new AppError(404, "CONTRATACAO_NAO_ENCONTRADA", "Contratação não encontrada.");
    const doc = (await this.repo.listarRescisoes(this.db, id))[0];
    if (!doc) throw new AppError(404, "RESCISAO_NAO_ENCONTRADA", "Gere a rescisão antes de pedir a assinatura.");
    return doc;
  }

  private async partesLocais(id: number): Promise<ParteAssinatura[]> {
    const base = await one<{
      candidato_nome: string | null;
      candidato_email: string | null;
      empresa_nome: string | null;
      empresa_email: string | null;
      empresa_responsavel: string | null;
      escola_id: string | null;
      nome_escola: string | null;
    }>(this.db, `
      SELECT c.nome AS candidato_nome, c.email AS candidato_email,
             coalesce(e.nome_fantasia, e.razao_social) AS empresa_nome, e.email AS empresa_email,
             e.responsavel AS empresa_responsavel, c.escola::text AS escola_id, c.nome_escola
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      WHERE cv.id_contratacao = $1
    `, [id]);
    const partes: ParteAssinatura[] = [];
    const candidatoEmail = limparEmail(base?.candidato_email);
    if (base?.candidato_nome || candidatoEmail) {
      partes.push(parte("Candidato", base?.candidato_nome || "Candidato", candidatoEmail));
    }
    const empresaEmail = limparEmail(base?.empresa_email);
    if (base?.empresa_nome || empresaEmail) {
      partes.push(parte("Empresa", base?.empresa_responsavel || base?.empresa_nome || "Empresa", empresaEmail));
    }
    const escola = await this.instituicao(base?.escola_id, base?.nome_escola);
    if (escola) partes.push(parte("Instituição de Ensino Diretor", escola.diretor || escola.nome, escola.email));
    const agente = await this.agente();
    if (agente) partes.push(parte("Agente", agente.nome, agente.email));
    return partes;
  }

  private async instituicao(id: string | null | undefined, nomeCadastro: string | null | undefined) {
    if (!id && !nomeCadastro) return null;
    const tem = await one<{ ok: string | null }>(this.db, `SELECT to_regclass('dna_work.instituicao')::text AS ok`);
    if (!tem?.ok || !id) {
      return nomeCadastro ? { nome: nomeCadastro, diretor: "", email: "" } : null;
    }
    const row = await one<{ nome: string | null; email: string | null; diretor: string | null }>(this.db, `
      SELECT coalesce(nome_fantasia, razao_social) AS nome, email,
             coalesce(representante_legal, responsavel) AS diretor
      FROM dna_work.instituicao
      WHERE id_instiduicao::text = $1
      LIMIT 1
    `, [id]).catch(() => null);
    if (!row) return nomeCadastro ? { nome: nomeCadastro, diretor: "", email: "" } : null;
    return {
      nome: row.nome || nomeCadastro || "Instituição de ensino",
      diretor: row.diretor || "",
      email: limparEmail(row.email),
    };
  }

  private async agente() {
    try {
      const tem = await one<{ ok: string | null }>(this.db, `SELECT to_regclass('dna_work.agente_integracao')::text AS ok`);
      if (!tem?.ok) return { nome: "DNA Work", email: "" };
      const colunas = await one<{ email: string | null }>(this.db, `
        SELECT column_name AS email FROM information_schema.columns
        WHERE table_schema = 'dna_work' AND table_name = 'agente_integracao' AND column_name = 'email'
      `);
      if (!colunas?.email) return { nome: "DNA Work", email: "" };
      const row = await one<{ nome: string | null; email: string | null }>(this.db, `
        SELECT coalesce(nome_fantasia, razao_social, 'DNA Work') AS nome, email
        FROM dna_work.agente_integracao
        LIMIT 1
      `);
      return { nome: row?.nome || "DNA Work", email: limparEmail(row?.email) };
    } catch {
      return { nome: "DNA Work", email: "" };
    }
  }

  private async dadosPdf(id: number, doc: DocRescisao): Promise<RescisaoPdfDados> {
    const row = await one<{
      candidato_nome: string | null;
      candidato_cpf: string | null;
      candidato_email: string | null;
      celular: string | null;
      empresa_nome: string | null;
      cnpj: string | null;
      responsavel: string | null;
      cidade: string | null;
      cargo: string | null;
      salario: string | null;
      modalidade: string | null;
      carga_horaria: string | null;
      datainicio: string | null;
      datafim: string | null;
      escola_id: string | null;
      nome_escola: string | null;
    }>(this.db, `
      SELECT c.nome AS candidato_nome, c.cpf AS candidato_cpf, c.email AS candidato_email, c.celular,
             coalesce(e.nome_fantasia, e.razao_social) AS empresa_nome, e.cnpj, e.responsavel, e.cidade,
             v.cargo, v.salario, m.descricao AS modalidade, v.carga_horaria, cv.datainicio, cv.datafim,
             c.escola::text AS escola_id, c.nome_escola
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      WHERE cv.id_contratacao = $1
    `, [id]);
    const escola = await this.instituicao(row?.escola_id, row?.nome_escola);
    const bolsa = moneyToNumber(row?.salario ?? null);
    return {
      titulo: doc.nome,
      candidato: row?.candidato_nome || "—",
      cpf: row?.candidato_cpf || "—",
      emailCandidato: row?.candidato_email || "—",
      celular: row?.celular || "—",
      empresa: row?.empresa_nome || "—",
      cnpj: row?.cnpj || "—",
      responsavelEmpresa: row?.responsavel || "—",
      instituicao: escola?.nome || "—",
      diretor: escola?.diretor || "—",
      cargo: row?.cargo || "—",
      modalidade: row?.modalidade || "—",
      cargaHoraria: row?.carga_horaria || "—",
      salario: bolsa == null ? "—" : bolsa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
      inicio: dataBr(row?.datainicio),
      fimPrevisto: dataBr(row?.datafim),
      demissao: dataBr(doc.data_demissao),
      motivo: doc.motivo,
      avaliacao: doc.avaliacao || "—",
      atividades: doc.resumo || "—",
      cidade: row?.cidade || "São Paulo",
    };
  }

  private async persistirZap(id: number, doc: DocRescisao, remoto: ZapDoc, base?: ParteAssinatura[]) {
    const locais = base ?? lerPartes(doc.signatarios);
    const signatarios = (remoto.signers ?? []).map((signer) => {
      const email = limparEmail(signer.email);
      const conhecido = locais.find((item) => item.email && item.email === email);
      return {
        papel: conhecido?.papel || "Signatário",
        nome: signer.name || conhecido?.nome || email || "Signatário",
        email,
        status: rotuloAssinatura(signer.status),
        url: signer.sign_url || null,
        assinado_em: signer.signed_at || null,
      };
    });
    const lista = signatarios.length ? signatarios : locais;
    const todos = lista.length > 0 && lista.every((item) => item.status === "Assinado");
    const assinatura = todos || remoto.status?.toLowerCase() === "signed" ? "Assinado" : "Aguardando";
    const url = lista.find((item) => item.status !== "Assinado" && item.url)?.url ?? lista.find((item) => item.url)?.url ?? null;
    await this.repo.gravarAssinatura(this.db, id, {
      assinatura,
      token: remoto.token || doc.zapsign_token || "",
      url,
      signatarios: JSON.stringify(lista),
      preview: remoto.signed_file || remoto.original_file || doc.preview_url,
    });
  }

  private async claimIdempotency(client: PoolClient, key: string, hash: string): Promise<StoredResponse | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inserted = await client.query(
        `INSERT INTO dna_work.api_idempotencia (chave, request_hash)
         VALUES ($1, $2)
         ON CONFLICT (chave) DO NOTHING
         RETURNING chave`,
        [key, hash],
      );
      if (inserted.rowCount === 1) return null;
      const current = await one<{ request_hash: string; status_code: number | null; response: unknown }>(
        client,
        "SELECT request_hash, status_code, response FROM dna_work.api_idempotencia WHERE chave = $1 FOR UPDATE",
        [key],
      );
      if (!current) continue;
      if (current.request_hash !== hash) {
        throw new AppError(409, "IDEMPOTENCIA_DIVERGENTE", "A chave de idempotência já foi usada com outro conteúdo.");
      }
      if (current.response && current.status_code) {
        return { statusCode: current.status_code, body: current.response };
      }
      throw new AppError(409, "IDEMPOTENCIA_EM_ANDAMENTO", "Já existe uma contratação em processamento com esta chave.");
    }
    throw new AppError(409, "IDEMPOTENCIA_EM_ANDAMENTO", "Não foi possível reservar a chave de idempotência.");
  }
}

function parte(papel: string, nome: string, email: string): ParteAssinatura {
  return { papel, nome, email, status: "Pendente", url: null, assinado_em: null };
}

function limparEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function rotuloAssinatura(status: string | undefined) {
  const texto = (status ?? "").toLowerCase();
  if (texto.includes("sign")) return "Assinado";
  if (texto.includes("refus")) return "Recusado";
  return "Pendente";
}

function lerPartes(value: string | null): ParteAssinatura[] {
  if (!value) return [];
  try {
    const lista = JSON.parse(value) as unknown;
    if (!Array.isArray(lista)) return [];
    return lista.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const parteItem = item as Partial<ParteAssinatura>;
      return [{
        papel: parteItem.papel || "Signatário",
        nome: parteItem.nome || "Signatário",
        email: limparEmail(parteItem.email),
        status: parteItem.status || "Pendente",
        url: parteItem.url || null,
        assinado_em: parteItem.assinado_em || null,
      }];
    });
  } catch {
    return [];
  }
}

function dataBr(value: string | null | undefined) {
  const iso = legacyToIso(value);
  if (!iso) return value || "—";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
