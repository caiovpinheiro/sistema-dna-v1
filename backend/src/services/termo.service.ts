import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { type ZapDoc, type ZapSignerResult } from "../lib/zapsign.js";
import { legacyToIso } from "../lib/dates.js";
import { one, many } from "../repositories/sql.js";

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

  async estagiariosMedio(busca: string) {
    const termo = busca.trim();
    if (termo.length < 2) return [];
    const temFlex = await one<{ ok: string | null }>(this.db, "SELECT to_regclass('dna_work.flex')::text AS ok");
    const nivel = temFlex?.ok
      ? `(coalesce(f.valor, '') ILIKE '%médio%' OR coalesce(f.valor, '') ILIKE '%medio%' OR (coalesce(f.valor, '') = '' AND v.escolaridade = '31'))`
      : `v.escolaridade = '31'`;
    const flex = temFlex?.ok
      ? "LEFT JOIN dna_work.flex f ON f.id_flex::text = c.modalidadecurso::text AND f.tipo::text = '2'"
      : "";
    return many<{ id: number; nome: string | null; empresa: string | null; cargo: string | null; situacao: string }>(this.db, `
      SELECT cv.id_contratacao AS id, c.nome, coalesce(e.nome_fantasia, e.razao_social) AS empresa, v.cargo,
             CASE WHEN cv.status = $2 THEN 'Ativo' ELSE 'Encerrado' END AS situacao
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      ${flex}
      WHERE v.tipo_vaga = 1 AND ${nivel}
        AND (c.nome ILIKE $1 OR e.razao_social ILIKE $1 OR coalesce(e.nome_fantasia, '') ILIKE $1 OR coalesce(v.cargo, '') ILIKE $1)
      ORDER BY CASE WHEN cv.status = $2 THEN 0 ELSE 1 END, cv.id_contratacao DESC
      LIMIT 20
    `, [`%${termo}%`, this.config.CONTRATACAO_STATUS_ATIVO]);
  }

  async estagiarioMedio(id: number) {
    const temFlex = await one<{ ok: string | null }>(this.db, "SELECT to_regclass('dna_work.flex')::text AS ok");
    const nivel = temFlex?.ok
      ? `(coalesce(f.valor, '') ILIKE '%médio%' OR coalesce(f.valor, '') ILIKE '%medio%' OR (coalesce(f.valor, '') = '' AND v.escolaridade = '31'))`
      : `v.escolaridade = '31'`;
    const flex = temFlex?.ok
      ? "LEFT JOIN dna_work.flex f ON f.id_flex::text = c.modalidadecurso::text AND f.tipo::text = '2'"
      : "";
    const temRescisao = await one<{ ok: string | null }>(this.db, "SELECT to_regclass('dna_work.rescisao_documento')::text AS ok");
    const rescisao = temRescisao?.ok
      ? "LEFT JOIN dna_work.rescisao_documento rd ON rd.id_contratacao = cv.id_contratacao"
      : "";
    const motivo = temRescisao?.ok ? "rd.motivo" : "NULL::text";
    const avaliacao = temRescisao?.ok ? "rd.avaliacao" : "NULL::text";
    const resumo = temRescisao?.ok ? "rd.resumo" : "NULL::text";
    const demissaoDoc = temRescisao?.ok ? "rd.data_demissao" : "NULL::text";
    const row = await one<Record<string, string | null>>(this.db, `
      SELECT c.nome, c.datanascimento, c.cpf, c.rg, c.logradouro, c.numero, c.complemento, c.bairro, c.cep, c.cidade, c.estado,
             c.curso, c.ano_escolar, c.periodo, c.celular, c.email,
             coalesce(nullif(c.nome_responsavel, ''), nullif(c.nomepai, ''), nullif(c.nomemae, '')) AS responsavel_nome,
             c.cpf_responsavel, c.celular_responsavel, c.email_responsavel,
             e.razao_social, e.cnpj, e.logradouro AS emp_logradouro, e.numero AS emp_numero, e.complemento AS emp_complemento,
             e.bairro AS emp_bairro, e.cidade AS emp_cidade, e.uf AS emp_uf, e.cep AS emp_cep, e.email AS emp_email, e.responsavel,
             c.escola::text AS escola_id, c.nome_escola, v.atribuicaoes,
             cv.datainicio, cv.datafim, cv.data_demicao, ${motivo} AS motivo, ${avaliacao} AS avaliacao, ${resumo} AS resumo, ${demissaoDoc} AS data_doc
      FROM dna_work.conratacaovaga cv
      JOIN dna_work.candidato c ON c.id_candidato = cv.id_candidato
      JOIN dna_work.empresa e ON e.id_empresa = cv.id_empresa
      JOIN dna_work.vaga v ON v.id_vaga = cv.id_vaga
      ${flex}
      ${rescisao}
      WHERE cv.id_contratacao = $1 AND v.tipo_vaga = 1 AND ${nivel}
    `, [id]);
    if (!row) throw new AppError(404, "NAO_ENCONTRADO", "Estagiário do ensino médio não encontrado.");
    const escola = await this.escolaDe(row.escola_id, row.nome_escola);
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return {
      estagiario_nome: (row.nome ?? "").trim(),
      estagiario_nascimento: legacyToIso(row.datanascimento) ?? "",
      estagiario_cpf: row.cpf ?? "",
      estagiario_rg: row.rg ?? "",
      estagiario_endereco: juntar(row.logradouro, row.numero, row.complemento, row.bairro),
      estagiario_cep: row.cep ?? "",
      estagiario_cidade: row.cidade ?? "",
      estagiario_estado: row.estado ?? "",
      estagiario_curso: row.curso ?? "",
      estagiario_periodo: row.ano_escolar ?? "",
      estagiario_turno: row.periodo ?? "",
      estagiario_contato: juntar(row.celular, row.email),
      tipo_estagio: "nao_obrigatorio" as const,
      responsavel_nome: (row.responsavel_nome ?? "").trim(),
      responsavel_nascimento: "",
      responsavel_cpf: row.cpf_responsavel ?? "",
      responsavel_rg: "",
      responsavel_endereco: "",
      responsavel_cep: "",
      responsavel_cidade: "",
      responsavel_estado: "",
      responsavel_contato: juntar(row.celular_responsavel, row.email_responsavel),
      concedente_razao: row.razao_social ?? "",
      concedente_endereco: juntar(row.emp_logradouro, row.emp_numero, row.emp_complemento, row.emp_bairro, row.emp_cidade, row.emp_uf, row.emp_cep ? `CEP ${row.emp_cep}` : ""),
      concedente_cnpj: row.cnpj ?? "",
      concedente_email: row.emp_email ?? "",
      concedente_representante: row.responsavel ?? "",
      escola_nome: escola.nome,
      escola_endereco: escola.endereco,
      escola_cidade: escola.cidade,
      escola_estado: escola.estado,
      escola_cep: escola.cep,
      escola_cnpj: escola.cnpj,
      escola_email: escola.email,
      escola_representante: escola.representante,
      data_tce: legacyToIso(row.datainicio) ?? hoje,
      data_rescisao: legacyToIso(row.data_doc) ?? legacyToIso(row.data_demicao) ?? legacyToIso(row.datafim) ?? hoje,
      atividades: limparTexto(row.resumo || row.atribuicaoes || ""),
      motivo: row.motivo ?? "",
      avaliacao: row.avaliacao ?? "",
    };
  }

  private async escolaDe(id: string | null, nomeCadastro: string | null) {
    const vazio = { nome: nomeCadastro ?? "", endereco: "", cidade: "", estado: "", cep: "", cnpj: "", email: "", representante: "" };
    if (!id) return vazio;
    const tem = await one<{ ok: string | null }>(this.db, "SELECT to_regclass('dna_work.instituicao')::text AS ok");
    if (!tem?.ok) return vazio;
    const row = await one<Record<string, string | null>>(this.db, `
      SELECT coalesce(nome_fantasia, razao_social) AS nome, logradouro, numero, complemento, bairro, cidade, uf, cep, cnpj, email,
             coalesce(nullif(btrim(representante_legal), ''), nullif(btrim(responsavel), '')) AS representante
      FROM dna_work.instituicao
      WHERE id_instiduicao::text = $1
      LIMIT 1
    `, [id]).catch(() => null);
    if (!row) return vazio;
    return {
      nome: row.nome || nomeCadastro || "",
      endereco: juntar(row.logradouro, row.numero, row.complemento, row.bairro),
      cidade: row.cidade ?? "",
      estado: row.uf ?? "",
      cep: row.cep ?? "",
      cnpj: row.cnpj ?? "",
      email: row.email ?? "",
      representante: row.representante ?? "",
    };
  }
}

function juntar(...partes: Array<string | null | undefined>) {
  return partes.map((parte) => (parte ?? "").trim()).filter(Boolean).join(", ");
}

function limparTexto(valor: string) {
  return valor
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .trim();
}
