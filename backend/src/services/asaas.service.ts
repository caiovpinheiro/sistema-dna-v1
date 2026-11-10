import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AsaasClient } from "../lib/asaas.js";
import { enviarModelo, textoHtml } from "../lib/email-modelo.js";
import { AppError } from "../lib/errors.js";
import { onlyDigits, primeiroEmail } from "../lib/normalize.js";

type EmpresaAsaas = {
  id_empresa: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email: string | null;
  email_financeiro: string | null;
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
  envio: string | null;
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
             c.forma, c.status, c.situacao, c.url_pagamento, c.data_pagamento::text AS data_pagamento,
             (
               SELECT ce.data::text
               FROM dna_work.cobranca_email ce
               WHERE ce.id_empresa::text = c.id_empresa::text
                 AND c.descricao ~ '^Faturamento [0-9]+/[0-9]{4}$'
                 AND ltrim(split_part(regexp_replace(c.descricao, '^Faturamento ', ''), '/', 1), '0') = ltrim(ce.mes::text, '0')
                 AND split_part(regexp_replace(c.descricao, '^Faturamento ', ''), '/', 2) = ce.ano::text
               ORDER BY ce.id DESC
               LIMIT 1
             ) AS envio
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

  async aReceber() {
    const asaas = this.client();
    const [pendente, vencido] = await Promise.all([
      asaas.estatisticas({ status: "PENDING" }),
      asaas.estatisticas({ status: "OVERDUE" }),
    ]);
    return {
      valor: Number(pendente.value ?? 0) + Number(vencido.value ?? 0),
      quantidade: Number(pendente.quantity ?? 0) + Number(vencido.quantity ?? 0),
    };
  }

  async boletosDoMes(mes: string, ano: string) {
    const linhas = await this.db.query<{
      id_fatura: number; id_empresa: string; valor: string; vencimento: string | null; nome: string | null;
    }>(`
      SELECT f.id_fatura, f.id_empresa::text AS id_empresa, f.valor_final AS valor,
             f.vencimento_fatura AS vencimento, coalesce(e.nome_fantasia, e.razao_social) AS nome
      FROM dna_work.fatura f
      JOIN dna_work.empresa e ON e.id_empresa = f.id_empresa
      WHERE ltrim(f.mes::text, '0') = ltrim($1, '0')
        AND f.ano::text = $2
        AND f.status_fatura IS DISTINCT FROM 1
        AND coalesce(f.tipo_fatura, '') <> 'Subfatura'
        AND nullif(btrim(f.id_asaas::text), '') IS NULL
        AND replace(coalesce(f.valor_final, ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
        AND replace(f.valor_final, ',', '.')::numeric > 0
      ORDER BY e.razao_social
    `, [mes, ano]);
    const gerados: Array<{ empresa: string | null; valor: number; vencimento: string }> = [];
    const falhas: Array<{ empresa: string | null; motivo: string }> = [];
    for (const linha of linhas.rows) {
      const vencimento = (linha.vencimento ?? "").slice(0, 10).replaceAll("/", "-");
      const valor = Number(String(linha.valor).replace(",", "."));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) {
        falhas.push({ empresa: linha.nome, motivo: "Vencimento inválido." });
        continue;
      }
      try {
        const cobranca = await this.criar({
          idEmpresa: linha.id_empresa,
          valor,
          vencimento,
          descricao: `Faturamento ${mes}/${ano}`,
          forma: "BOLETO",
        });
        const pagamento = await this.db.query<{ asaas_payment_id: string }>(
          "SELECT asaas_payment_id FROM dna_work.cobranca_asaas WHERE id = $1",
          [cobranca.id],
        );
        const asaasId = pagamento.rows[0]?.asaas_payment_id;
        if (asaasId) await this.db.query("UPDATE dna_work.fatura SET id_asaas = $2 WHERE id_fatura = $1", [linha.id_fatura, asaasId]);
        gerados.push({ empresa: linha.nome, valor, vencimento });
      } catch (error) {
        falhas.push({ empresa: linha.nome, motivo: error instanceof AppError ? error.message : "O Asaas não gerou o boleto." });
      }
    }
    return { gerados: gerados.length, falhas, itens: gerados };
  }

  async criar(input: { idEmpresa: string; valor: number; vencimento: string; descricao: string; forma: string; avisar?: boolean }) {
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
    const cobranca = (await this.listar({ idEmpresa: input.idEmpresa })).find((item) => item.id === id);
    if (!cobranca) throw new AppError(404, "NAO_ENCONTRADO", "Cobrança não encontrada.");
    if (input.avisar === false) return { ...cobranca, emailEnviado: false };
    try {
      await this.enviarFatura(id);
      return { ...cobranca, emailEnviado: true };
    } catch {
      return { ...cobranca, emailEnviado: false };
    }
  }

  async boletoDoFaturamento(input: { idEmpresa: string; valor: number; vencimento: string; descricao: string }) {
    const existente = await this.db.query<{ id: string; url_pagamento: string | null; vencimento: string; asaas_payment_id: string | null }>(`
      SELECT id, url_pagamento, vencimento::text AS vencimento, asaas_payment_id
      FROM dna_work.cobranca_asaas
      WHERE id_empresa::text = $1
        AND situacao = 'aberta'
        AND descricao ~ '^Faturamento [0-9]+/[0-9]{4}$'
        AND ltrim(split_part(regexp_replace(descricao, '^Faturamento ', ''), '/', 1), '0') = ltrim(split_part(regexp_replace($2, '^Faturamento ', ''), '/', 1), '0')
        AND split_part(regexp_replace(descricao, '^Faturamento ', ''), '/', 2) = split_part(regexp_replace($2, '^Faturamento ', ''), '/', 2)
      ORDER BY vencimento DESC
      LIMIT 1
    `, [input.idEmpresa, input.descricao]);
    const atual = existente.rows[0];
    if (atual) {
      let url = atual.url_pagamento;
      if (!url && atual.asaas_payment_id) {
        const payment = await this.client().consultarCobranca(atual.asaas_payment_id);
        url = payment.invoiceUrl ?? null;
        if (url) await this.db.query("UPDATE dna_work.cobranca_asaas SET url_pagamento = $2 WHERE id = $1", [atual.id, url]);
      }
      if (!url) throw new AppError(502, "BOLETO_SEM_LINK", "O boleto deste mês já existe e o Asaas não devolveu o link. Nenhuma cobrança nova foi criada.");
      return { id: atual.id, url, vencimento: atual.vencimento.slice(0, 10) };
    }
    const cobranca = await this.criar({ ...input, forma: "BOLETO", avisar: false });
    return { id: cobranca.id, url: cobranca.url_pagamento, vencimento: input.vencimento };
  }

  async enviarFatura(id: string) {
    const result = await this.db.query<{
      valor: number; vencimento: string; url_pagamento: string | null;
      nome_fantasia: string | null; razao_social: string | null; cnpj: string | null;
      email_financeiro: string | null; email: string | null; nome_financeiro: string | null;
    }>(`
      SELECT c.valor::float8 AS valor, c.vencimento::text AS vencimento, c.url_pagamento,
             e.nome_fantasia, e.razao_social, e.cnpj, e.email_financeiro, e.email, e.nome_financeiro
      FROM dna_work.cobranca_asaas c
      JOIN dna_work.empresa e ON e.id_empresa = c.id_empresa
      WHERE c.id = $1
    `, [id]);
    const fatura = result.rows[0];
    if (!fatura) throw new AppError(404, "NAO_ENCONTRADO", "Cobrança não encontrada.");
    const email = (fatura.email_financeiro || fatura.email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new AppError(422, "EMAIL_AUSENTE", "A empresa não tem e-mail financeiro.");
    const nome = fatura.nome_fantasia || fatura.razao_social || "Empresa";
    return enviarModelo(this.db, this.config, "Geração de cobrança Asaas", {
      email,
      nome: fatura.nome_financeiro || nome,
    }, {
      "@Nome-Fantasia-Empresa": textoHtml(nome),
      "@Valor": fatura.valor.toFixed(2).replace(".", ","),
      "@Vencimento": dataBr(fatura.vencimento),
      "@link-pg": fatura.url_pagamento || "",
    });
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
    const consultada = emitida.pdfUrl ? emitida : await this.aguardarPdf(agendada.id);
    const notaId = randomUUID();
    await this.db.query(`
      INSERT INTO dna_work.nota_asaas (id, id_cobranca, asaas_invoice_id, tipo, valor, status, pdf_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
    `, [notaId, id, agendada.id, input.tipo, input.valor, consultada.status ?? emitida.status ?? agendada.status ?? "SCHEDULED", consultada.pdfUrl || null]);
    return (await this.listar({})).find((item) => item.id === id);
  }

  async baixarNota(idNota: string) {
    const nota = await this.db.query<{ asaas_invoice_id: string; pdf_url: string | null }>(
      "SELECT asaas_invoice_id, pdf_url FROM dna_work.nota_asaas WHERE id = $1",
      [idNota],
    );
    const row = nota.rows[0];
    if (!row?.asaas_invoice_id) throw new AppError(404, "NAO_ENCONTRADO", "Nota fiscal não encontrada.");
    if (row.pdf_url) return { id: idNota, pdf_url: row.pdf_url };
    const atual = await this.aguardarPdf(row.asaas_invoice_id);
    await this.db.query(
      "UPDATE dna_work.nota_asaas SET status = $2, pdf_url = COALESCE($3, pdf_url) WHERE id = $1",
      [idNota, atual.status ?? "SCHEDULED", atual.pdfUrl || null],
    );
    if (!atual.pdfUrl) {
      throw new AppError(409, "NOTA_SEM_PDF", atual.status === "ERROR"
        ? "A prefeitura recusou esta nota. Ela não tem PDF."
        : "A prefeitura ainda está autorizando a nota. Tente baixar de novo em alguns segundos.");
    }
    return { id: idNota, pdf_url: atual.pdfUrl };
  }

  private async aguardarPdf(asaasId: string) {
    let nota = await this.client().consultarNota(asaasId);
    for (let tentativa = 0; tentativa < 4 && !nota.pdfUrl && nota.status !== "ERROR" && nota.status !== "CANCELED"; tentativa += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      nota = await this.client().consultarNota(asaasId);
    }
    return nota;
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

  async resumoNota(id: string) {
    const result = await this.db.query<{ id_empresa: string; descricao: string; valor: number }>(`
      SELECT id_empresa::text AS id_empresa, descricao, valor::float8 AS valor
      FROM dna_work.cobranca_asaas WHERE id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) throw new AppError(404, "NAO_ENCONTRADO", "Cobrança não encontrada.");
    return { ...row, valor: Number(row.valor) };
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
        SELECT id_empresa, razao_social, nome_fantasia, cnpj, email, email_financeiro, telefone, celular, cep,
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
      email: primeiroEmail(empresa.email_financeiro, empresa.email) || undefined,
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

function dataBr(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}
