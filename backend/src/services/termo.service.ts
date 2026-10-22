import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { buildTermoPdf } from "../lib/termo-pdf.js";
import { criarDocumentoZapSign, type ZapDoc, type ZapSignerResult } from "../lib/zapsign.js";
import { legacyToIso } from "../lib/dates.js";
import { moneyToNumber } from "../lib/money.js";
import { classifyRegime } from "../lib/normalize.js";
import { one, many } from "../repositories/sql.js";

type Origem = {
  id_contratacao: number;
  candidato_nome: string | null;
  candidato_email: string | null;
  candidato_id: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  empresa_email: string | null;
  cargo: string | null;
  salario: string | null;
  modalidade: string | null;
  datainicio: string | null;
  datafim: string | null;
};

export type Signatario = { nome: string; email: string; status: string; url: string | null };

export type TermoRow = {
  id: string;
  id_contratacao: number | null;
  nome: string;
  status: string;
  arquivo_assinado: string | null;
  signatarios: Signatario[];
  criado_em: Date | string;
  candidato_nome: string | null;
  empresa_nome: string | null;
  zapsign_token: string | null;
};

function signersFromZap(signers: ZapSignerResult[] | undefined): Signatario[] {
  return (signers ?? []).map((signer) => ({
    nome: signer.name ?? "",
    email: signer.email ?? "",
    status: signer.status ?? "new",
    url: signer.sign_url ?? null,
  }));
}

function mapStatus(eventType: string, status: string, signers: Signatario[]): string {
  const text = `${eventType} ${status}`.toLowerCase();
  if (text.includes("refus")) return "recusado";
  if (text.includes("cancel") || text.includes("delet")) return "cancelado";
  if (status.toLowerCase() === "signed" || (signers.length > 0 && signers.every((signer) => signer.status.toLowerCase() === "signed"))) {
    return "assinado";
  }
  return "enviado";
}

export class TermoService {
  constructor(private readonly db: Pool, private readonly config: AppConfig) {}

  async list(status?: string): Promise<TermoRow[]> {
    const params: unknown[] = [];
    const where = status ? (params.push(status), "WHERE t.status = $1") : "";
    return many<TermoRow>(this.db, `
      SELECT t.id, t.id_contratacao, t.nome, t.status, t.arquivo_assinado, t.signatarios,
             t.criado_em, t.zapsign_token, coalesce(c.nome, t.candidato_nome) AS candidato_nome,
             coalesce(e.nome_fantasia, e.razao_social, t.empresa_nome) AS empresa_nome
      FROM dna_work.termo_estagio t
      LEFT JOIN dna_work.conratacaovaga cv ON cv.id_contratacao = t.id_contratacao
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      ${where}
      ORDER BY t.criado_em DESC
      LIMIT 200
    `, params);
  }

  async get(id: string): Promise<TermoRow> {
    const row = await one<TermoRow>(this.db, `
      SELECT t.id, t.id_contratacao, t.nome, t.status, t.arquivo_assinado, t.signatarios,
             t.criado_em, t.zapsign_token, coalesce(c.nome, t.candidato_nome) AS candidato_nome,
             coalesce(e.nome_fantasia, e.razao_social, t.empresa_nome) AS empresa_nome
      FROM dna_work.termo_estagio t
      LEFT JOIN dna_work.conratacaovaga cv ON cv.id_contratacao = t.id_contratacao
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      WHERE t.id = $1
    `, [id]);
    if (!row) throw new AppError(404, "NAO_ENCONTRADO", "Termo não encontrado.");
    return row;
  }

  async criar(idContratacao: number): Promise<TermoRow> {
    const origem = await one<Origem>(this.db, `
      SELECT cv.id_contratacao, c.nome AS candidato_nome, c.email AS candidato_email, c.id_candidato AS candidato_id,
             e.id_empresa AS empresa_id, coalesce(e.nome_fantasia, e.razao_social) AS empresa_nome, e.email AS empresa_email,
             v.cargo, v.salario, m.descricao AS modalidade, cv.datainicio, cv.datafim
      FROM dna_work.conratacaovaga cv
      LEFT JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      LEFT JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      LEFT JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      LEFT JOIN dna_work.modalidade_vaga m ON m.id = v.tipo_vaga
      WHERE cv.id_contratacao = $1
    `, [idContratacao]);
    if (!origem) throw new AppError(404, "NAO_ENCONTRADO", "Contratação não encontrada.");
    if (classifyRegime(origem.modalidade) !== "estagio") {
      throw new AppError(422, "NAO_E_ESTAGIO", "O termo de estágio só é gerado para contratação de estágio.");
    }
    const candidatoEmail = origem.candidato_email?.trim().toLowerCase() ?? "";
    const empresaEmail = origem.empresa_email?.trim().toLowerCase() ?? "";
    if (!candidatoEmail || !empresaEmail) {
      throw new AppError(422, "EMAIL_AUSENTE", "Candidato e empresa precisam ter e-mail para assinar o termo.");
    }
    const aberto = await one<{ id: string }>(this.db, `
      SELECT id FROM dna_work.termo_estagio
      WHERE id_contratacao = $1 AND status = 'enviado'
      LIMIT 1
    `, [idContratacao]);
    if (aberto) throw new AppError(409, "TERMO_JA_ENVIADO", "Já existe um termo aguardando assinatura nesta contratação.", { id: aberto.id });

    const nome = `Termo de estágio - ${origem.candidato_nome ?? "candidato"}`;
    const bolsa = moneyToNumber(origem.salario);
    const pdf = buildTermoPdf([
      "DNAWORK",
      "Termo de compromisso de estágio",
      "",
      `Estagiário: ${origem.candidato_nome ?? ""}`,
      `E-mail do estagiário: ${candidatoEmail}`,
      `Concedente: ${origem.empresa_nome ?? ""}`,
      `E-mail da concedente: ${empresaEmail}`,
      `Cargo: ${origem.cargo ?? ""}`,
      `Bolsa: ${bolsa == null ? "não informada" : bolsa.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      `Início: ${legacyToIso(origem.datainicio) ?? "não informado"}`,
      `Previsão de fim: ${legacyToIso(origem.datafim) ?? "não informada"}`,
      "",
      "As partes assinam este termo por meio da ZapSign.",
      `Contratação ${origem.id_contratacao}.`,
    ]);
    const doc = await criarDocumentoZapSign({
      apiUrl: this.config.ZAPSIGN_API_URL,
      apiToken: this.config.ZAPSIGN_API_TOKEN,
      name: nome,
      externalId: String(origem.id_contratacao),
      pdf,
      signers: [
        { name: origem.candidato_nome ?? "Estagiário", email: candidatoEmail, external_id: origem.candidato_id ?? undefined },
        { name: origem.empresa_nome ?? "Concedente", email: empresaEmail, external_id: origem.empresa_id ?? undefined },
      ],
    });
    const id = randomUUID();
    await this.db.query(`
      INSERT INTO dna_work.termo_estagio
        (id, id_contratacao, id_candidato, id_empresa, nome, zapsign_token, status, signatarios)
      VALUES ($1, $2, $3, $4, $5, $6, 'enviado', $7::jsonb)
    `, [id, origem.id_contratacao, origem.candidato_id, origem.empresa_id, nome, doc.token, JSON.stringify(signersFromZap(doc.signers))]);
    return this.get(id);
  }

  async receberWebhook(payload: Record<string, unknown>): Promise<{ atualizado: boolean }> {
    const token = String(payload.token ?? "");
    if (!token) throw new AppError(400, "TOKEN_AUSENTE", "Evento sem token do documento.");
    const doc = payload as ZapDoc & { event_type?: string; status?: string };
    const signers = signersFromZap(doc.signers);
    const status = mapStatus(String(doc.event_type ?? ""), String(doc.status ?? ""), signers);
    const result = await this.db.query(`
      UPDATE dna_work.termo_estagio
      SET status = $2,
          arquivo_assinado = COALESCE($3, arquivo_assinado),
          signatarios = CASE WHEN $4::jsonb = '[]'::jsonb THEN signatarios ELSE $4::jsonb END,
          atualizado_em = now()
      WHERE zapsign_token = $1
    `, [token, status, doc.signed_file ?? null, JSON.stringify(signers)]);
    return { atualizado: (result.rowCount ?? 0) > 0 };
  }
}
