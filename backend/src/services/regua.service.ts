import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { enviarModelo, textoHtml } from "../lib/email-modelo.js";
import { enviarEmailMailjet } from "../lib/mailjet.js";
import { AppError } from "../lib/errors.js";
import { dispararRegua } from "../lib/regua-execucao.js";
import { BLOQUEIOS } from "../lib/regua-bloqueio.js";
import {
  INICIO_REGUA,
  LINK_CENTRAL,
  agruparRegua,
  competenciaDe,
  consolidarEnvios,
  dataIso,
  encerrarEnvios,
  etapasNoVencimento,
  htmlDaEtapa,
  planejarRegua,
  type AcaoPlanejada,
  type EnvioRegua,
  type FaturaAgrupada,
  type GrupoRegua,
  type ItemPlanejado,
} from "../lib/regua.js";

type Cobranca = {
  id: string;
  asaas_payment_id: string | null;
  id_empresa: string;
  valor: string;
  vencimento: string;
  situacao: string;
  url_pagamento: string | null;
  data_pagamento: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  email_financeiro: string | null;
  email: string | null;
  nome_financeiro: string | null;
  matriz_id: string | null;
  matriz_nome: string | null;
  matriz_cnpj: string | null;
  email_matriz: string | null;
  usa_asaas: string | null;
};

type FaturaSalva = {
  id: string;
  id_cobranca: string;
  status_pagamento: string;
  comprovante: boolean;
  data_baixa: string | null;
  email_cobranca: string | null;
  contato: string | null;
  link_central: string;
  envios: EnvioRegua[];
};

const LABELS = new Map(etapasNoVencimento("2000-01-10").map((etapa) => [etapa.etapa, etapa]));

export class ReguaService {
  constructor(private readonly db: Pool, private readonly config: AppConfig) {}

  async listar(competencia: string): Promise<GrupoRegua[]> {
    return agruparRegua(await this.linhas(competencia));
  }

  async simular(competencia: string, data?: string) {
    const hoje = data ?? hojeSp();
    const linhas = await this.linhas(competencia);
    const acoes = consolidarEnvios(planejarRegua(hoje, linhas.map(itemPlanejado), { inicio: this.inicio() }));
    return { data: hoje, simular: true, envio_real: false, inicio: this.inicio(), confirmacao: BLOQUEIOS, acoes };
  }

  async relatorio(id: string, competencia: string) {
    const { ano, mes } = this.competencia(competencia);
    const empresa = await this.empresaDoRegistro(id);
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
    `, [empresa, referencia]);
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
    const envio = await this.db.query<{ id_fatura: string; etapa: string; status: string; status_pagamento: string }>(`
      select e.id_fatura, e.etapa, e.status, f.status_pagamento
      from dna_work.fatura_envio e
      join dna_work.fatura_regua f on f.id = e.id_fatura
      where e.id = $1
    `, [idEnvio]);
    const atual = envio.rows[0];
    if (!atual) throw new AppError(404, "ENVIO_NAO_ENCONTRADO", "Envio não encontrado.");
    if (atual.status_pagamento === "pago") throw new AppError(409, "REGUA_ENCERRADA", "A régua parou porque o pagamento já foi registrado.");
    if (atual.status_pagamento === "suspenso") throw new AppError(409, "REGUA_SUSPENSA", "A régua está suspensa até a validação do comprovante.");
    if (atual.status === status) return { id: idEnvio, status };
    await this.db.query(`
      update dna_work.fatura_envio
      set status = $2, enviado_em = now(), responsavel = $3
      where id = $1 and status <> $2
    `, [idEnvio, status, responsavel]);
    if (atual.etapa === "encaminhar" || status === "encaminhado") {
      await this.db.query(`update dna_work.fatura_regua set status_pagamento = 'encaminhado' where id = $1 and status_pagamento = 'em_aberto'`, [atual.id_fatura]);
    }
    await this.log(atual.id_fatura, idEnvio, atual.etapa, status, responsavel);
    return { id: idEnvio, status };
  }

  async registrarComprovante(idFatura: string, data: string) {
    const atual = await this.statusFatura(idFatura);
    if (!atual) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
    if (atual === "pago") throw new AppError(409, "REGUA_ENCERRADA", "A cobrança já está encerrada.");
    if (atual !== "suspenso") {
      await this.db.query(`update dna_work.fatura_regua set comprovante = true, data_baixa = $2, status_pagamento = 'suspenso' where id = $1`, [idFatura, data]);
      await this.db.query(`
        update dna_work.fatura_envio
        set status = 'suspenso'
        where id_fatura = $1 and status in ('a_enviar', 'falha', 'enviando')
      `, [idFatura]);
      await this.log(idFatura, null, null, "suspenso", "Comprovante recebido");
    }
    return { id: idFatura, comprovante: true, status_pagamento: "suspenso" };
  }

  async validarComprovante(idFatura: string, responsavel: string) {
    const atual = await this.statusFatura(idFatura);
    if (!atual) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
    if (atual !== "suspenso") throw new AppError(409, "COMPROVANTE_AUSENTE", "Não há comprovante aguardando validação.");
    await this.db.query(`update dna_work.fatura_regua set status_pagamento = 'pago' where id = $1`, [idFatura]);
    await this.db.query(`
      update dna_work.fatura_envio
      set status = 'resolvido'
      where id_fatura = $1 and status in ('a_enviar', 'falha', 'enviando', 'suspenso')
    `, [idFatura]);
    await this.log(idFatura, null, null, "pago", `Comprovante validado por ${responsavel}`);
    return { id: idFatura, status_pagamento: "pago" };
  }

  async enviarRelatorio(idFatura: string, competencia: string, responsavel: string) {
    const reserva = await this.db.query<{ id: string }>(`
      update dna_work.fatura_envio
      set status = 'enviando'
      where id_fatura = $1 and etapa = 'relatorio' and status in ('a_enviar', 'falha')
      returning id
    `, [idFatura]);
    if (!reserva.rows[0]) {
      const atual = await this.db.query<{ status: string }>(`select status from dna_work.fatura_envio where id_fatura = $1 and etapa = 'relatorio'`, [idFatura]);
      if (atual.rows[0]?.status === "enviado") throw new AppError(409, "REGUA_JA_ENVIADA", "O relatório desta fatura já foi enviado.");
      throw new AppError(404, "ENVIO_NAO_ENCONTRADO", "A etapa de relatório ainda não está gravada. A régua automática não foi ativada.");
    }
    try {
      const enviados = await this.enviarEmailRelatorio(idFatura, competencia);
      await this.db.query(`
        update dna_work.fatura_envio
        set status = 'enviado', enviado_em = now(), responsavel = $2
        where id = $1
      `, [reserva.rows[0].id, responsavel]);
      await this.log(idFatura, reserva.rows[0].id, "relatorio", "enviado", responsavel);
      return { id: idFatura, competencia, enviados };
    } catch (error) {
      await this.db.query(`update dna_work.fatura_envio set status = 'falha' where id = $1`, [reserva.rows[0].id]);
      await this.log(idFatura, reserva.rows[0].id, "relatorio", "falha", error instanceof Error ? error.message : "Falha ao enviar.");
      throw error;
    }
  }

  async encerrarPorPaymentId(paymentId: string, data?: string | null) {
    try {
      const faturas = await this.db.query<{ id: string }>(`
        update dna_work.fatura_regua f
        set status_pagamento = 'pago', data_baixa = coalesce(f.data_baixa, $2::date)
        from dna_work.cobranca_asaas c
        where c.id = f.id_cobranca and c.asaas_payment_id = $1 and f.status_pagamento <> 'pago'
        returning f.id
      `, [paymentId, data ?? null]);
      for (const fatura of faturas.rows) await this.resolverPendentes(fatura.id, "Pagamento confirmado no Asaas");
      return { encerradas: faturas.rows.length };
    } catch (error) {
      if (codigo(error) === "42P01") return { encerradas: 0 };
      throw error;
    }
  }

  async encerrarPorCobrancaId(idCobranca: string, data?: string | null) {
    try {
      const faturas = await this.db.query<{ id: string }>(`
        update dna_work.fatura_regua
        set status_pagamento = 'pago', data_baixa = coalesce(data_baixa, $2::date)
        where id_cobranca = $1 and status_pagamento <> 'pago'
        returning id
      `, [idCobranca, data ?? null]);
      for (const fatura of faturas.rows) await this.resolverPendentes(fatura.id, "Pagamento confirmado no Asaas");
      return { encerradas: faturas.rows.length };
    } catch (error) {
      if (codigo(error) === "42P01") return { encerradas: 0 };
      throw error;
    }
  }

  async executarReal(hoje = hojeSp()) {
    if (this.config.REGUA_ENVIO_REAL !== "1") {
      throw new AppError(403, "REGUA_DESLIGADA", "A régua automática não está autorizada. Simule o processamento com as faturas reais antes de ligar o envio.");
    }
    const competencias = competenciasDaData(hoje);
    const linhas: FaturaAgrupada[] = [];
    for (const competencia of competencias) linhas.push(...await this.linhas(competencia));
    await this.materializar(linhas);
    const gravadas = (await Promise.all(competencias.map((competencia) => this.linhas(competencia)))).flat();
    const acoes = consolidarEnvios(planejarRegua(hoje, gravadas.filter((linha) => linha.persistida).map(itemPlanejado), { inicio: this.inicio() }));
    const reservados = new Map<string, string>();
    const alvos = new Map(acoes.flatMap((acao) => acao.faturas.map((fatura) => [fatura.chave, { ...fatura, etapa: acao.etapa }])));
    return dispararRegua(acoes, {
      reservar: async (chave) => {
        const alvo = alvos.get(chave);
        if (!alvo) return false;
        const id = await this.reservar(alvo.id_cobranca, alvo.etapa, alvo.empresa);
        if (!id) return false;
        reservados.set(chave, id);
        return true;
      },
      enviar: (acao) => this.enviarEtapa(acao),
      concluir: async (acao, status, detalhe) => {
        const id = reservados.get(acao.chave);
        if (!id) return;
        await this.concluir(id, acao, status, detalhe);
      },
    });
  }

  private async linhas(competencia: string): Promise<FaturaAgrupada[]> {
    const { ano, mes } = this.competencia(competencia);
    const inicio = dataIso(ano, mes, 1);
    const fim = mes === 12 ? dataIso(ano + 1, 1, 1) : dataIso(ano, mes + 1, 1);
    const cobrancas = await this.cobrancas(inicio, fim);
    const salvas = await this.salvas(cobrancas.map((cobranca) => cobranca.id));
    return cobrancas.map((cobranca) => this.montar(cobranca, salvas.get(cobranca.id) ?? null, inicio));
  }

  private async cobrancas(inicio: string, fim: string) {
    try {
      const result = await this.db.query<Cobranca>(`
        select c.id, c.asaas_payment_id, c.id_empresa::text, c.valor::text, c.vencimento::text, c.situacao,
               c.url_pagamento, c.data_pagamento::text,
               e.razao_social, e.nome_fantasia, e.cnpj, e.email_financeiro, e.email, e.nome_financeiro,
               nullif(btrim(e.matriz::text), '') as matriz_id,
               coalesce(em.nome_fantasia, em.razao_social) as matriz_nome,
               em.cnpj as matriz_cnpj,
               em.email_financeiro as email_matriz,
               e.usa_asaas::text as usa_asaas
        from dna_work.cobranca_asaas c
        join dna_work.empresa e on e.id_empresa = c.id_empresa
        left join dna_work.empresa em on em.id_empresa = nullif(btrim(e.matriz::text), '')
        where c.vencimento >= $1 and c.vencimento < $2 and c.situacao <> 'cancelada'
        order by e.nome_fantasia, c.vencimento
      `, [inicio, fim]);
      return result.rows;
    } catch (error) {
      if (codigo(error) === "42P01") return [];
      throw error;
    }
  }

  private async salvas(ids: string[]) {
    const mapa = new Map<string, FaturaSalva>();
    if (!ids.length) return mapa;
    try {
      const faturas = await this.db.query<Omit<FaturaSalva, "envios">>(
        `select id, id_cobranca, status_pagamento, comprovante, data_baixa::text, email_cobranca, contato, link_central
         from dna_work.fatura_regua where id_cobranca = any($1::uuid[])`,
        [ids],
      );
      const envios = faturas.rows.length
        ? await this.db.query<EnvioRegua & { id_fatura: string }>(`
            select id, id_fatura, etapa, ordem, data_prevista::text, status, enviado_em::text, responsavel
            from dna_work.fatura_envio
            where id_fatura = any($1::uuid[])
            order by ordem
          `, [faturas.rows.map((fatura) => fatura.id)])
        : { rows: [] };
      for (const fatura of faturas.rows) {
        mapa.set(fatura.id_cobranca, {
          ...fatura,
          envios: envios.rows.filter((envio) => envio.id_fatura === fatura.id).map((envio) => ({
            ...envio,
            label: LABELS.get(envio.etapa)?.label ?? envio.etapa,
            pendentes: LABELS.get(envio.etapa)?.pendentes ?? false,
            marco: LABELS.get(envio.etapa)?.marco ?? false,
          })),
        });
      }
      return mapa;
    } catch (error) {
      if (codigo(error) === "42P01") return mapa;
      throw error;
    }
  }

  private montar(cobranca: Cobranca, salva: FaturaSalva | null, competencia: string): FaturaAgrupada {
    const empresa = cobranca.nome_fantasia || cobranca.razao_social || "Empresa";
    const status = cobranca.situacao === "paga" ? "pago" : cobranca.situacao === "cancelada" ? "cancelada" : salva?.status_pagamento ?? "em_aberto";
    const previstas = etapasNoVencimento(cobranca.vencimento.slice(0, 10)).map((etapa) => ({
      id: "",
      etapa: etapa.etapa,
      ordem: etapa.ordem,
      label: etapa.label,
      data_prevista: etapa.data,
      status: status === "pago" ? "resolvido" : status === "suspenso" ? "suspenso" : "prevista",
      enviado_em: null,
      responsavel: null,
      pendentes: etapa.pendentes,
      marco: etapa.marco ?? false,
    }));
    const envios = status === "pago" && salva?.envios.length ? encerrarEnvios(salva.envios) : salva?.envios.length ? salva.envios : previstas;
    const hoje = hojeSp();
    const proximo = status === "pago" || status === "cancelada" ? null : status === "suspenso" ? "Validar comprovante" : envios.find((envio) => (envio.status === "a_enviar" || envio.status === "falha" || envio.status === "prevista") && envio.data_prevista >= hoje)?.label ?? null;
    const emailUnidade = salva?.email_cobranca || cobranca.email_financeiro || cobranca.email;
    const emailDestino = cobranca.usa_asaas === "2" && cobranca.email_matriz?.includes("@") ? cobranca.email_matriz : emailUnidade;
    return {
      id: salva?.id ?? cobranca.id,
      id_cobranca: cobranca.id,
      asaas_payment_id: cobranca.asaas_payment_id,
      id_empresa: cobranca.id_empresa,
      empresa,
      cnpj: cobranca.cnpj,
      email_cobranca: salva?.email_cobranca ?? cobranca.email_financeiro ?? cobranca.email,
      contato: salva?.contato ?? cobranca.nome_financeiro,
      competencia,
      vencimento: cobranca.vencimento.slice(0, 10),
      valor: Number(cobranca.valor),
      link_cobranca: cobranca.url_pagamento,
      link_central: salva?.link_central ?? LINK_CENTRAL,
      status_pagamento: status,
      comprovante: salva?.comprovante ?? false,
      data_baixa: salva?.data_baixa ?? cobranca.data_pagamento,
      proximo_passo: proximo,
      persistida: Boolean(salva),
      envios,
      matriz_id: cobranca.matriz_id || cobranca.id_empresa,
      matriz_nome: cobranca.matriz_nome || empresa,
      matriz_cnpj: cobranca.matriz_id ? cobranca.matriz_cnpj : cobranca.cnpj,
      email_destino: emailDestino,
    };
  }

  private async materializar(linhas: FaturaAgrupada[]) {
    for (const linha of linhas) {
      const pago = linha.status_pagamento === "pago";
      const fatura = await this.db.query<{ id: string }>(`
        insert into dna_work.fatura_regua (
          id, id_cobranca, id_empresa, competencia, vencimento, valor, email_cobranca, contato,
          link_cobranca, link_central, status_pagamento, comprovante, data_baixa
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        on conflict (id_cobranca) do update set
          valor = excluded.valor,
          vencimento = excluded.vencimento,
          email_cobranca = excluded.email_cobranca,
          contato = excluded.contato,
          link_cobranca = excluded.link_cobranca,
          status_pagamento = case
            when dna_work.fatura_regua.status_pagamento = 'suspenso' and excluded.status_pagamento <> 'pago' then dna_work.fatura_regua.status_pagamento
            when dna_work.fatura_regua.status_pagamento = 'encaminhado' and excluded.status_pagamento <> 'pago' then dna_work.fatura_regua.status_pagamento
            when dna_work.fatura_regua.status_pagamento = 'cancelada' and excluded.status_pagamento <> 'pago' then dna_work.fatura_regua.status_pagamento
            else excluded.status_pagamento
          end,
          data_baixa = coalesce(dna_work.fatura_regua.data_baixa, excluded.data_baixa)
        returning id
      `, [
        randomUUID(), linha.id_cobranca, linha.id_empresa, linha.competencia, linha.vencimento, linha.valor,
        linha.email_cobranca, linha.contato, linha.link_cobranca, linha.link_central,
        linha.status_pagamento === "pago" ? "pago" : linha.status_pagamento === "cancelada" ? "cancelada" : "em_aberto", linha.comprovante, linha.data_baixa,
      ]);
      const id = fatura.rows[0].id;
      for (const etapa of etapasNoVencimento(linha.vencimento)) {
        const status = pago ? "resolvido" : etapa.marco ? "marco" : "a_enviar";
        await this.db.query(`
          insert into dna_work.fatura_envio (id, id_fatura, etapa, ordem, data_prevista, status)
          values ($1, $2, $3, $4, $5, $6)
          on conflict (id_fatura, etapa) do update set data_prevista = excluded.data_prevista
          where fatura_envio.status in ('a_enviar', 'marco')
        `, [randomUUID(), id, etapa.etapa, etapa.ordem, etapa.data, status]);
      }
    }
  }

  private async reservar(idCobranca: string, etapa: string, empresa: string) {
    const result = await this.db.query<{ id: string }>(`
      update dna_work.fatura_envio e
      set status = 'enviando', reservado_em = now(), tentativas = tentativas + 1
      from dna_work.fatura_regua f
      where e.id_fatura = f.id
        and f.id_cobranca = $1
        and e.etapa = $2
        and e.status in ('a_enviar', 'falha')
        and f.status_pagamento = 'em_aberto'
      returning e.id
    `, [idCobranca, etapa]);
    const id = result.rows[0]?.id;
    if (id) await this.log(null, id, etapa, "reservado", empresa);
    return id ?? null;
  }

  private async concluir(idEnvio: string, acao: AcaoPlanejada, status: "enviado" | "falha" | "marco" | "encaminhado", detalhe?: string) {
    await this.db.query(`
      update dna_work.fatura_envio
      set status = $2,
          enviado_em = case when $2 = 'enviado' then now() else enviado_em end,
          responsavel = 'regua',
          ultimo_erro = case when $2 = 'falha' then $3 else null end
      where id = $1
    `, [idEnvio, status === "marco" ? "marco" : status, detalhe ?? null]);
    if (status === "encaminhado") {
      await this.db.query(`
        update dna_work.fatura_regua f
        set status_pagamento = 'encaminhado'
        from dna_work.fatura_envio e
        where e.id = $1 and e.id_fatura = f.id and f.status_pagamento = 'em_aberto'
      `, [idEnvio]);
    }
    await this.log(null, idEnvio, acao.etapa, status, detalhe ?? null);
  }

  private async enviarEtapa(acao: AcaoPlanejada) {
    if (acao.etapa === "relatorio") {
      const fatura = await this.db.query<{ id: string }>(`select id from dna_work.fatura_regua where id_cobranca = $1`, [acao.id_cobranca]);
      const id = fatura.rows[0]?.id;
      if (!id) throw new AppError(404, "FATURA_NAO_ENCONTRADA", "Fatura não encontrada.");
      await this.enviarEmailRelatorio(id, acao.vencimento.slice(0, 7));
      return;
    }
    const email = (acao.email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new AppError(422, "EMAIL_AUSENTE", "A empresa não tem e-mail de cobrança.");
    const mensagem = htmlDaEtapa(acao);
    await enviarEmailMailjet({
      apiKey: this.config.MAILJET_API_KEY,
      secret: this.config.MAILJET_SECRET_KEY,
      fromEmail: this.config.MAILJET_FROM,
      fromName: this.config.MAILJET_FROM_NAME,
      to: [{ email, nome: mensagem.nome }],
      subject: mensagem.subject,
      html: mensagem.html,
    });
  }

  private async enviarEmailRelatorio(idFatura: string, competencia: string) {
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
    return envio.enviados;
  }

  private async resolverPendentes(idFatura: string, detalhe: string) {
    await this.db.query(`
      update dna_work.fatura_envio
      set status = 'resolvido'
      where id_fatura = $1 and status in ('a_enviar', 'falha', 'enviando', 'suspenso')
    `, [idFatura]);
    await this.log(idFatura, null, null, "pago", detalhe);
  }

  private async statusFatura(id: string) {
    const result = await this.db.query<{ status_pagamento: string }>(`select status_pagamento from dna_work.fatura_regua where id = $1`, [id]);
    return result.rows[0]?.status_pagamento ?? null;
  }

  private async empresaDoRegistro(id: string) {
    try {
      const fatura = await this.db.query<{ id_empresa: string }>(`select id_empresa from dna_work.fatura_regua where id = $1`, [id]);
      if (fatura.rows[0]) return fatura.rows[0].id_empresa;
    } catch (error) {
      if (codigo(error) !== "42P01") throw error;
    }
    const cobranca = await this.db.query<{ id_empresa: string }>(`select id_empresa from dna_work.cobranca_asaas where id = $1`, [id]);
    return cobranca.rows[0]?.id_empresa ?? null;
  }

  private async log(idFatura: string | null, idEnvio: string | null, etapa: string | null, evento: string, detalhe: string | null) {
    try {
      await this.db.query(`
        insert into dna_work.fatura_regua_log (id, id_fatura, id_envio, etapa, evento, detalhe)
        values ($1, $2, $3, $4, $5, $6)
      `, [randomUUID(), idFatura, idEnvio, etapa, evento, detalhe]);
    } catch (error) {
      if (codigo(error) === "42P01") return;
      throw error;
    }
  }

  private inicio() {
    return this.config.REGUA_INICIO || INICIO_REGUA;
  }

  private competencia(valor: string) {
    try {
      return competenciaDe(valor);
    } catch {
      throw new AppError(422, "COMPETENCIA_INVALIDA", "Informe a competência como AAAA-MM.");
    }
  }
}

function itemPlanejado(linha: FaturaAgrupada): ItemPlanejado {
  return {
    id_cobranca: linha.id_cobranca,
    asaas_payment_id: linha.asaas_payment_id,
    id_empresa: linha.id_empresa,
    empresa: linha.empresa,
    email: linha.email_destino || linha.email_cobranca,
    valor: linha.valor,
    vencimento: linha.vencimento,
    status_pagamento: linha.status_pagamento,
    matriz_id: linha.matriz_id,
    matriz_nome: linha.matriz_nome,
    link: linha.link_cobranca,
    consolida: Boolean((linha.email_destino || linha.email_cobranca || "").includes("@")),
    envios: linha.envios.map((envio) => ({ id: envio.id, etapa: envio.etapa, status: envio.status, data_prevista: envio.data_prevista })),
  };
}

function hojeSp() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function competenciasDaData(hoje: string) {
  const [ano, mes] = hoje.slice(0, 7).split("-").map(Number);
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return [dataIso(anterior.ano, anterior.mes, 1).slice(0, 7), hoje.slice(0, 7)];
}

function codigo(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}
