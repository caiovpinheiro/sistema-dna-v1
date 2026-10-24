import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { enviarModelo, textoHtml } from "../lib/email-modelo.js";
import { AppError } from "../lib/errors.js";
import { datasDaRegua, LINK_CENTRAL, competenciaDe, dataIso } from "../lib/regua.js";

type Envio = {
  id: string;
  etapa: string;
  ordem: number;
  label: string;
  data_prevista: string;
  status: string;
  enviado_em: string | null;
  responsavel: string | null;
  pendentes: boolean;
  marco: boolean;
};

export type FaturaRegua = {
  id: string;
  id_cobranca: string;
  empresa: string;
  cnpj: string | null;
  email_cobranca: string | null;
  contato: string | null;
  competencia: string;
  vencimento: string;
  valor: number;
  link_cobranca: string | null;
  link_central: string;
  status_pagamento: string;
  comprovante: boolean;
  data_baixa: string | null;
  proximo_passo: string | null;
  envios: Envio[];
};

const LABELS = new Map(datasDaRegua(2000, 1).map((etapa) => [etapa.etapa, etapa]));

export class ReguaService {
  constructor(private readonly db: Pool, private readonly config: AppConfig) {}

  async listar(competencia: string): Promise<FaturaRegua[]> {
    const { ano, mes } = this.competencia(competencia);
    const inicio = dataIso(ano, mes, 1);
    const fim = mes === 12 ? dataIso(ano + 1, 1, 1) : dataIso(ano, mes + 1, 1);
    let cobrancas;
    try {
      cobrancas = await this.db.query<{
        id: string; id_empresa: string; valor: string; vencimento: string; situacao: string;
        url_pagamento: string | null; data_pagamento: string | null;
        razao_social: string | null; nome_fantasia: string | null; cnpj: string | null;
        email_financeiro: string | null; email: string | null; nome_financeiro: string | null;
      }>(`
        select c.id, c.id_empresa, c.valor::text, c.vencimento::text, c.situacao, c.url_pagamento,
               c.data_pagamento::text, e.razao_social, e.nome_fantasia, e.cnpj,
               e.email_financeiro, e.email, e.nome_financeiro
        from dna_work.cobranca_asaas c
        join dna_work.empresa e on e.id_empresa = c.id_empresa
        where c.vencimento >= $1 and c.vencimento < $2 and c.situacao <> 'cancelada'
        order by e.nome_fantasia, c.vencimento
      `, [inicio, fim]);
    } catch (error) {
      if (codigo(error) === "42P01") throw new AppError(503, "MIGRACAO_PENDENTE", "A régua ainda não está na base. Aplique as migrations.");
      throw error;
    }
    for (const cobranca of cobrancas.rows) await this.garantir(cobranca, ano, mes);
    const faturas = await this.db.query<{
      id: string; id_cobranca: string; empresa: string; cnpj: string | null; email_cobranca: string | null;
      contato: string | null; competencia: string; vencimento: string; valor: string; link_cobranca: string | null;
      link_central: string; status_pagamento: string; comprovante: boolean; data_baixa: string | null;
    }>(`
      select f.id, f.id_cobranca, coalesce(e.nome_fantasia, e.razao_social) as empresa, e.cnpj,
             f.email_cobranca, f.contato, f.competencia::text, f.vencimento::text, f.valor::text,
             f.link_cobranca, f.link_central, f.status_pagamento, f.comprovante, f.data_baixa::text
      from dna_work.fatura_regua f
      join dna_work.empresa e on e.id_empresa = f.id_empresa
      where f.competencia = $1
      order by empresa
    `, [inicio]);
    const envios = faturas.rows.length
      ? await this.db.query<Envio & { id_fatura: string }>(`
          select id, id_fatura, etapa, ordem, data_prevista::text, status, enviado_em::text, responsavel
          from dna_work.fatura_envio
          where id_fatura = any($1::uuid[])
          order by ordem
        `, [faturas.rows.map((fatura) => fatura.id)])
      : { rows: [] };
    return faturas.rows.map((fatura) => {
      const etapas = envios.rows.filter((envio) => envio.id_fatura === fatura.id).map((envio) => ({
        ...envio,
        label: LABELS.get(envio.etapa)?.label ?? envio.etapa,
        pendentes: LABELS.get(envio.etapa)?.pendentes ?? false,
        marco: LABELS.get(envio.etapa)?.marco ?? false,
      }));
      const proximo = fatura.status_pagamento === "pago"
        ? null
        : etapas.find((envio) => envio.status === "a_enviar")?.label ?? null;
      return { ...fatura, valor: Number(fatura.valor), proximo_passo: proximo, envios: etapas };
    });
  }

  async relatorio(idFatura: string, competencia: string) {
    const { ano, mes } = this.competencia(competencia);
    const fatura = await this.db.query<{ id_empresa: string }>(
      `select id_empresa from dna_work.fatura_regua where id = $1`,
      [idFatura],
    );
    const empresa = fatura.rows[0];
    if (!empresa) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
    const referencia = `${ano}/${String(mes).padStart(2, "0")}`;
    const linhas = await this.db.query<{
      nome: string | null; cargo: string | null; datainicio: string | null; modalidade: string | null; data_demicao: string | null;
    }>(`
      select c.nome, v.cargo, cv.datainicio, m.descricao as modalidade, cv.data_demicao
      from dna_work.conratacaovaga cv
      left join dna_work.candidato c on c.id_candidato = cv.id_candidato
      left join dna_work.vaga v on v.id_vaga = cv.id_vaga
      left join dna_work.modalidade_vaga m on m.id = v.tipo_vaga
      where cv.id_empresa = $1
        and (
          cv.data_demicao is null or cv.data_demicao = ''
          or cv.data_demicao like $2 || '%'
        )
      order by c.nome
    `, [empresa.id_empresa, referencia]);
    return linhas.rows.map((linha) => ({
      nome: linha.nome,
      cargo: linha.cargo,
      inicio: linha.datainicio,
      contrato: linha.modalidade,
      situacao: linha.data_demicao ? "desligado no mês" : "ativo",
      referencia: `${String(mes).padStart(2, "0")}/${ano}`,
    }));
  }

  async registrarEnvio(idEnvio: string, responsavel: string, status: "enviado" | "escalar" | "encaminhado") {
    const envio = await this.db.query<{ id_fatura: string; etapa: string; status_pagamento: string }>(`
      select e.id_fatura, e.etapa, f.status_pagamento
      from dna_work.fatura_envio e
      join dna_work.fatura_regua f on f.id = e.id_fatura
      where e.id = $1
    `, [idEnvio]);
    const atual = envio.rows[0];
    if (!atual) throw new AppError(404, "ENVIO_NAO_ENCONTRADO", "Envio não encontrado.");
    if (atual.status_pagamento === "pago") throw new AppError(409, "REGUA_ENCERRADA", "A régua parou porque o pagamento ou o comprovante já foi registrado.");
    await this.db.query(`
      update dna_work.fatura_envio
      set status = $2, enviado_em = now(), responsavel = $3
      where id = $1
    `, [idEnvio, status, responsavel]);
    if (atual.etapa === "encaminhar" || status === "encaminhado") {
      await this.db.query(`update dna_work.fatura_regua set status_pagamento = 'encaminhado' where id = $1 and status_pagamento = 'em_aberto'`, [atual.id_fatura]);
    }
    return { id: idEnvio, status };
  }

  async registrarComprovante(idFatura: string, data: string) {
    const result = await this.db.query(`update dna_work.fatura_regua set comprovante = true, data_baixa = $2 where id = $1`, [idFatura, data]);
    if (!result.rowCount) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
    await this.parar(idFatura);
    return { id: idFatura, comprovante: true };
  }

  async enviarRelatorio(idFatura: string, competencia: string, responsavel: string) {
    const { ano, mes } = this.competencia(competencia);
    const fatura = await this.db.query<{
      empresa: string; cnpj: string | null; email_cobranca: string | null; contato: string | null; valor: string;
    }>(`
      select coalesce(e.nome_fantasia, e.razao_social) as empresa, e.cnpj, f.email_cobranca, f.contato, f.valor::text
      from dna_work.fatura_regua f
      join dna_work.empresa e on e.id_empresa = f.id_empresa
      where f.id = $1
    `, [idFatura]);
    const atual = fatura.rows[0];
    if (!atual) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
    const email = (atual.email_cobranca || "").trim().toLowerCase();
    if (!email.includes("@")) throw new AppError(422, "EMAIL_AUSENTE", "A empresa não tem e-mail de cobrança.");
    const linhas = await this.relatorio(idFatura, competencia);
    const corpo = linhas.map((linha) => `
      <tr>
        <td>Mensalidade</td>
        <td>${textoHtml(linha.nome ?? "")}</td>
        <td>${textoHtml(linha.cargo ?? "")}</td>
        <td>${textoHtml(linha.contrato ?? "")}</td>
        <td>${textoHtml(linha.situacao)}</td>
      </tr>
    `).join("");
    const valor = Number(atual.valor).toFixed(2).replace(".", ",");
    const tabela = `<table style="width:1000px"><tr><td>Cobrança</td><td>Candidato</td><td>Cargo</td><td>Modalidade</td><td>Situação</td></tr>${corpo}<tr><td></td><td></td><td></td><td>Total</td><td>R$ ${valor}</td></tr></table>`;
    const envio = await enviarModelo(this.db, this.config, "Relatorio cobrança", {
      email,
      nome: atual.contato || atual.empresa,
    }, {
      "@Nome-Fantasia-Empresa": textoHtml(atual.empresa),
      "@CNPJ-Empresa": textoHtml(atual.cnpj ?? ""),
      "@tabela-cobranca": tabela,
    });
    await this.db.query(`
      update dna_work.fatura_envio
      set status = 'enviado', enviado_em = now(), responsavel = $2
      where id_fatura = $1 and etapa = 'relatorio'
    `, [idFatura, responsavel]);
    return { id: idFatura, competencia: `${ano}-${String(mes).padStart(2, "0")}`, enviados: envio.enviados };
  }

  private async garantir(cobranca: {
    id: string; id_empresa: string; valor: string; situacao: string; url_pagamento: string | null; data_pagamento: string | null;
    email_financeiro: string | null; email: string | null; nome_financeiro: string | null;
  }, ano: number, mes: number) {
    const pago = cobranca.situacao === "paga";
    const status = pago ? "pago" : "em_aberto";
    const fatura = await this.db.query<{ id: string }>(`
      insert into dna_work.fatura_regua (
        id, id_cobranca, id_empresa, competencia, vencimento, valor, email_cobranca, contato,
        link_cobranca, link_central, status_pagamento, comprovante, data_baixa
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12)
      on conflict (id_cobranca) do update set
        valor = excluded.valor,
        email_cobranca = excluded.email_cobranca,
        contato = excluded.contato,
        link_cobranca = excluded.link_cobranca,
        status_pagamento = case
          when dna_work.fatura_regua.status_pagamento = 'encaminhado' and excluded.status_pagamento <> 'pago' then dna_work.fatura_regua.status_pagamento
          else excluded.status_pagamento
        end,
        data_baixa = coalesce(dna_work.fatura_regua.data_baixa, excluded.data_baixa)
      returning id
    `, [
      randomUUID(), cobranca.id, cobranca.id_empresa, dataIso(ano, mes, 1), dataIso(ano, mes, 10),
      cobranca.valor, cobranca.email_financeiro || cobranca.email, cobranca.nome_financeiro,
      cobranca.url_pagamento, LINK_CENTRAL, status, pago ? cobranca.data_pagamento : null,
    ]);
    const id = fatura.rows[0].id;
    for (const etapa of datasDaRegua(ano, mes)) {
      await this.db.query(`
        insert into dna_work.fatura_envio (id, id_fatura, etapa, ordem, data_prevista, status)
        values ($1, $2, $3, $4, $5, $6)
        on conflict (id_fatura, etapa) do update set data_prevista = excluded.data_prevista
      `, [randomUUID(), id, etapa.etapa, etapa.ordem, etapa.data, etapa.marco ? "marco" : "a_enviar"]);
    }
    if (pago) await this.parar(id);
  }

  private async parar(idFatura: string) {
    await this.db.query(`
      update dna_work.fatura_envio
      set status = 'resolvido'
      where id_fatura = $1 and status = 'a_enviar'
    `, [idFatura]);
  }

  private competencia(valor: string) {
    try {
      return competenciaDe(valor);
    } catch {
      throw new AppError(422, "COMPETENCIA_INVALIDA", "Informe a competência como AAAA-MM.");
    }
  }
}

function codigo(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}
