import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AsaasClient } from "../lib/asaas.js";
import { AppError } from "../lib/errors.js";
import { onlyDigits } from "../lib/normalize.js";

type EmpresaAsaas = {
  id_empresa: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  celular: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  id_asaas: string | null;
};

export type Cobranca = {
  id: string;
  id_empresa: string;
  empresa_razao: string | null;
  empresa_fantasia: string | null;
  empresa_cnpj: string | null;
  descricao: string;
  valor: number;
  valor_liquido: number | null;
  vencimento: string;
  forma: string;
  status: string;
  situacao: string;
  url_pagamento: string | null;
  data_pagamento: string | null;
  notas: Array<{ id: string; tipo: string; valor: number; status: string; pdf_url: string | null }>;
};

function situacaoDe(status: string) {
  const value = status.toUpperCase();
  if (value === "RECEIVED" || value === "CONFIRMED" || value === "RECEIVED_IN_CASH") return "paga";
  if (value === "DELETED" || value === "REFUNDED") return "cancelada";
  return "aberta";
}

export class AsaasService {
  constructor(private readonly db: Pool, private readonly config: AppConfig) {}

  private client() {
    return new AsaasClient(this.config.ASAAS_API_URL, this.config.ASAAS_API_KEY);
  }

  async listar(filtro: { situacao?: string; de?: string; ate?: string; idEmpresa?: string }) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filtro.situacao) where.push(`c.situacao = $${params.push(filtro.situacao)}`);
    if (filtro.de) where.push(`c.vencimento >= $${params.push(filtro.de)}`);
    if (filtro.ate) where.push(`c.vencimento <= $${params.push(filtro.ate)}`);
    if (filtro.idEmpresa) where.push(`c.id_empresa = $${params.push(filtro.idEmpresa)}`);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const cobrancas = await this.db.query<Omit<Cobranca, "notas"> & { valor: string; valor_liquido: string | null }>(`
      SELECT c.id, c.id_empresa, e.razao_social AS empresa_razao, e.nome_fantasia AS empresa_fantasia, e.cnpj AS empresa_cnpj,
             c.descricao, c.valor::float8 AS valor, c.valor_liquido::float8 AS valor_liquido, c.vencimento::text AS vencimento,
             c.forma, c.status, c.situacao, c.url_pagamento, c.data_pagamento::text AS data_pagamento
      FROM dna_work.cobranca_asaas c
      LEFT JOIN dna_work.empresa e ON e.id_empresa = c.id_empresa
      ${clause}
      ORDER BY c.vencimento DESC
      LIMIT 200
    `, params);
    const ids = cobrancas.rows.map((row) => row.id);
    const notas = ids.length
      ? await this.db.query<{ id: string; id_cobranca: string; tipo: string; valor: number; status: string; pdf_url: string | null }>(`
          SELECT id, id_cobranca, tipo, valor::float8 AS valor, status, pdf_url
          FROM dna_work.nota_asaas WHERE id_cobranca = ANY($1::uuid[])
        `, [ids])
      : { rows: [] };
    return cobrancas.rows.map((row) => ({
      ...row,
      valor: Number(row.valor),
      valor_liquido: row.valor_liquido == null ? null : Number(row.valor_liquido),
      notas: notas.rows.filter((nota) => nota.id_cobranca === row.id).map(({ id_cobranca: _id, ...nota }) => nota),
    }));
  }

  async criar(input: { idEmpresa: string; valor: number; vencimento: string; descricao: string; forma: string }) {
    const empresa = await this.empresa(input.idEmpresa);
    const asaas = this.client();
    const customerId = await this.garantirCliente(asaas, empresa);
    const id = randomUUID();
    const payment = await asaas.criarCobranca({
      billingType: input.forma,
      customer: customerId,
      value: input.valor,
      dueDate: input.vencimento,
      description: input.descricao,
      externalReference: id,
      daysAfterDueDateToCancellationRegistration: 30,
    });
    await this.db.query(`
      INSERT INTO dna_work.cobranca_asaas
        (id, id_empresa, asaas_payment_id, asaas_customer_id, descricao, valor, valor_liquido, vencimento, forma, status, situacao, url_pagamento, invoice_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      id, empresa.id_empresa, payment.id, customerId, input.descricao, input.valor, payment.netValue ?? null,
      input.vencimento, input.forma, payment.status ?? "PENDING", situacaoDe(payment.status ?? "PENDING"),
      payment.invoiceUrl ?? null, payment.invoiceNumber ?? null,
    ]);
    return (await this.listar({})).find((item) => item.id === id);
  }

  async sincronizar(id: string) {
    const cobranca = await this.cobranca(id);
    const payment = await this.client().consultarCobranca(cobranca.asaas_payment_id);
    await this.aplicarStatus(cobranca.asaas_payment_id, payment.status ?? cobranca.status, payment.paymentDate ?? null, payment.netValue ?? null, payment.invoiceUrl ?? null);
    return (await this.listar({})).find((item) => item.id === id);
  }

  async receber(id: string, data: string, valor?: number) {
    const cobranca = await this.cobranca(id);
    const payment = await this.client().receberEmDinheiro(cobranca.asaas_payment_id, data, valor ?? Number(cobranca.valor));
    await this.aplicarStatus(cobranca.asaas_payment_id, payment.status ?? "RECEIVED_IN_CASH", payment.paymentDate ?? data, null, null);
    return (await this.listar({})).find((item) => item.id === id);
  }

  async excluir(id: string) {
    const cobranca = await this.cobranca(id);
    await this.client().excluirCobranca(cobranca.asaas_payment_id);
    await this.aplicarStatus(cobranca.asaas_payment_id, "DELETED", null, null, null);
    return { id, situacao: "cancelada" };
  }

  async emitirNota(id: string, input: { tipo: string; valor: number; codigoServico: string; iss: number; descricao: string }) {
    const cobranca = await this.cobranca(id);
    const asaas = this.client();
    const agendada = await asaas.agendarNota({
      customer: cobranca.asaas_customer_id,
      payment: cobranca.asaas_payment_id,
      serviceDescription: input.descricao,
      observations: "",
      value: input.valor,
      effectiveDate: new Date().toISOString().slice(0, 10),
      municipalServiceCode: input.codigoServico,
      taxes: { retainIss: false, cofins: 0, inss: 0, ir: 0, pis: 0, iss: input.iss },
    });
    const emitida = await asaas.emitirNota(agendada.id);
    const notaId = randomUUID();
    await this.db.query(`
      INSERT INTO dna_work.nota_asaas (id, id_cobranca, asaas_invoice_id, tipo, valor, status, pdf_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [notaId, id, agendada.id, input.tipo, input.valor, emitida.status ?? agendada.status ?? "SCHEDULED", emitida.pdfUrl ?? null]);
    return (await this.listar({})).find((item) => item.id === id);
  }

  async cancelarNota(idNota: string) {
    const nota = await this.db.query<{ asaas_invoice_id: string }>("SELECT asaas_invoice_id FROM dna_work.nota_asaas WHERE id = $1", [idNota]);
    const asaasId = nota.rows[0]?.asaas_invoice_id;
    if (!asaasId) throw new AppError(404, "NAO_ENCONTRADO", "Nota fiscal não encontrada.");
    const resposta = await this.client().cancelarNota(asaasId);
    await this.db.query("UPDATE dna_work.nota_asaas SET status = $2 WHERE id = $1", [idNota, resposta.status ?? "CANCELED"]);
    return { id: idNota, status: resposta.status ?? "CANCELED" };
  }

  async receberWebhook(payload: Record<string, unknown>) {
    const payment = payload.payment as { id?: string; status?: string; paymentDate?: string | null; netValue?: number; invoiceUrl?: string } | undefined;
    if (!payment?.id) return { atualizado: false };
    const status = String(payment.status ?? "");
    const atualizado = await this.aplicarStatus(payment.id, status, payment.paymentDate ?? null, payment.netValue ?? null, payment.invoiceUrl ?? null);
    return { atualizado };
  }

  private async aplicarStatus(paymentId: string, status: string, paymentDate: string | null, netValue: number | null, invoiceUrl: string | null) {
    const result = await this.db.query(`
      UPDATE dna_work.cobranca_asaas
      SET status = $2,
          situacao = $3,
          data_pagamento = COALESCE($4::date, data_pagamento),
          valor_liquido = COALESCE($5, valor_liquido),
          url_pagamento = COALESCE($6, url_pagamento),
          atualizado_em = now()
      WHERE asaas_payment_id = $1
    `, [paymentId, status, situacaoDe(status), paymentDate, netValue, invoiceUrl]);
    return (result.rowCount ?? 0) > 0;
  }

  private async cobranca(id: string) {
    const result = await this.db.query<{ asaas_payment_id: string; asaas_customer_id: string; valor: number; status: string }>(`
      SELECT asaas_payment_id, asaas_customer_id, valor::float8 AS valor, status
      FROM dna_work.cobranca_asaas WHERE id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row?.asaas_payment_id) throw new AppError(404, "NAO_ENCONTRADO", "Cobrança não encontrada.");
    return row;
  }

  private async empresa(id: string) {
    try {
      const result = await this.db.query<EmpresaAsaas>(`
        SELECT id_empresa, razao_social, nome_fantasia, cnpj, email, telefone, celular, cep,
               logradouro, numero, complemento, bairro, id_asaas
        FROM dna_work.empresa WHERE id_empresa = $1
      `, [id]);
      const row = result.rows[0];
      if (!row) throw new AppError(404, "NAO_ENCONTRADO", "Empresa não encontrada.");
      return row;
    } catch (error) {
      if ((error as { code?: string }).code === "42703") {
        throw new AppError(503, "MIGRACAO_PENDENTE", "A coluna id_asaas ainda não existe na empresa.");
      }
      throw error;
    }
  }

  private async garantirCliente(asaas: AsaasClient, empresa: EmpresaAsaas) {
    const body = {
      name: empresa.razao_social || empresa.nome_fantasia,
      cpfCnpj: onlyDigits(empresa.cnpj ?? ""),
      email: empresa.email ?? undefined,
      phone: onlyDigits(empresa.telefone ?? ""),
      mobilePhone: onlyDigits(empresa.celular ?? ""),
      postalCode: onlyDigits(empresa.cep ?? ""),
      address: empresa.logradouro ?? undefined,
      addressNumber: empresa.numero ?? undefined,
      complement: empresa.complemento ?? undefined,
      province: empresa.bairro ?? undefined,
    };
    if (empresa.id_asaas) {
      await asaas.atualizarCliente(empresa.id_asaas, body);
      return empresa.id_asaas;
    }
    const criado = await asaas.criarCliente(body);
    await this.db.query("UPDATE dna_work.empresa SET id_asaas = $2 WHERE id_empresa = $1", [empresa.id_empresa, criado.id]);
    return criado.id;
  }
}
