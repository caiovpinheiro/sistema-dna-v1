import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { getEscola, mensagemEscola, searchEscolas } from "../lib/escolas.js";
import { getEmpresaCadastro, listEmpresasCadastro } from "../lib/supabase-empresas.js";
import { fillTceTemplate } from "../lib/tce-pdf.js";
import { APOLICE_SEGURO, CAMPOS_DATA, dataParaPdf, emptyManual, ESCOLA_KEYS, type Concedente, type ManualData } from "../lib/tce-fields.js";
import { enviarModelo, textoHtml } from "../lib/email-modelo.js";
import { criarDocumentoZapSign } from "../lib/zapsign.js";
import { enviarEmailMailjet } from "../lib/mailjet.js";
import type { TermoService } from "./termo.service.js";

export type GerarTceInput = {
  empresaId: string;
  campos: ManualData;
  concedente: Concedente;
  escolaId: string | null;
};

export class TceService {
  constructor(
    private readonly db: Pool,
    private readonly config: AppConfig,
    private readonly termos: TermoService,
  ) {}

  listarEmpresas() {
    return listEmpresasCadastro(this.config.SUPABASE_URL, this.config.SUPABASE_SERVICE_ROLE_KEY);
  }

  async buscarEscolas(termo: string) {
    try {
      return { opcoes: await searchEscolas(this.db, termo), erro: "" };
    } catch (error) {
      return { opcoes: [], erro: mensagemEscola(error) };
    }
  }

  async gerar(input: GerarTceInput) {
    const empresa = await getEmpresaCadastro(this.config.SUPABASE_URL, this.config.SUPABASE_SERVICE_ROLE_KEY, input.empresaId);
    if (!empresa) throw new AppError(404, "NAO_ENCONTRADO", "Empresa não encontrada.");
    const campos = { ...input.campos, seguro_apolice: APOLICE_SEGURO };
    if (input.escolaId) {
      const escola = await getEscola(this.db, input.escolaId);
      if (!escola) throw new AppError(404, "NAO_ENCONTRADO", "Escola não encontrada.");
      for (const key of ESCOLA_KEYS) {
        if (!campos[key]) campos[key] = escola.campos[key];
      }
    }
    const concedente = {
      razao_social: input.concedente.razao_social || empresa.razao_social,
      cnpj: input.concedente.cnpj || empresa.cnpj,
      endereco: input.concedente.endereco || empresa.endereco,
      cep: input.concedente.cep || empresa.cep,
      cidade: input.concedente.cidade || empresa.cidade,
      estado: input.concedente.estado || empresa.estado,
      email: texto(input.concedente.email || empresa.email).toLowerCase(),
      representante: input.concedente.representante || empresa.representante,
    };
    if (!texto(campos.nome)) throw new AppError(422, "NOME_OBRIGATORIO", "Nome do candidato é obrigatório.");
    for (const key of CAMPOS_DATA) {
      const value = texto(campos[key]);
      if (!value) continue;
      const partes = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const data = partes ? new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])) : null;
      const valida = Boolean(partes && data && data.getFullYear() === Number(partes[1]) && data.getMonth() === Number(partes[2]) - 1 && data.getDate() === Number(partes[3]));
      if (!valida) throw new AppError(422, "DATA_INVALIDA", "Informe uma data válida.");
      campos[key] = dataParaPdf(value);
    }

    const id = randomUUID();
    const dir = await pastaGravavel(this.config.PDF_STORAGE_DIR);
    const pdf = await fillTceTemplate({
      concedente_razao_social: concedente.razao_social,
      concedente_cnpj: concedente.cnpj,
      concedente_endereco: concedente.endereco,
      concedente_cep: concedente.cep,
      concedente_cidade: concedente.cidade,
      concedente_estado: concedente.estado,
      concedente_email: concedente.email,
      concedente_representante: concedente.representante,
      ...campos,
    });
    const filename = `${id}.pdf`;
    try {
      await fs.writeFile(path.join(dir, filename), pdf);
      const candidatoNome = limite(campos.nome);
      const empresaNome = limite(concedente.razao_social);
      await this.db.query(`
        INSERT INTO public.tces (id, empresa_id, empresa_nome, candidato_nome, payload, pdf_path, status)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'generated')
      `, [id, empresa.id, empresaNome, candidatoNome, JSON.stringify({ campos, empresa: concedente }), filename]);

      await this.db.query(`
        INSERT INTO dna_work.termo_estagio
          (id, id_contratacao, nome, status, signatarios, tce_id, candidato_nome, empresa_nome)
        VALUES ($1::uuid, NULL, $2, 'gerado', $3::jsonb, $6::text, $4, $5)
      `, [
        id,
        `TCE - ${candidatoNome}`.slice(0, 200),
        JSON.stringify(signatariosDe(campos, concedente)),
        candidatoNome,
        empresaNome,
        id,
      ]);
      return await this.termos.get(id);
    } catch (error) {
      await fs.unlink(path.join(dir, filename)).catch(() => undefined);
      await this.db.query("DELETE FROM public.tces WHERE id = $1", [id]).catch(() => undefined);
      throw erroGravacao(error);
    }
  }

  async lerPdf(id: string): Promise<Buffer> {
    const row = await this.db.query<{ pdf_path: string }>("SELECT pdf_path FROM public.tces WHERE id = $1", [id]);
    const filename = row.rows[0]?.pdf_path;
    if (!filename) throw new AppError(404, "NAO_ENCONTRADO", "PDF do TCE não encontrado.");
    const safe = path.basename(filename);
    try {
      return await fs.readFile(path.join(await pastaGravavel(this.config.PDF_STORAGE_DIR), safe));
    } catch {
      throw new AppError(404, "NAO_ENCONTRADO", "PDF do TCE não encontrado.");
    }
  }

  async enviar(id: string) {
    const termo = await this.termos.get(id);
    if (termo.status !== "gerado") {
      throw new AppError(409, "TERMO_JA_ENVIADO", "Este TCE já foi enviado para assinatura.");
    }
    const saved = await this.db.query<{ payload: { campos?: ManualData; empresa?: Concedente } }>(
      "SELECT payload FROM public.tces WHERE id = $1",
      [id],
    );
    const payload = saved.rows[0]?.payload;
    const campos = payload?.campos;
    const concedente = payload?.empresa;
    if (!campos || !concedente) throw new AppError(404, "NAO_ENCONTRADO", "Dados do TCE não encontrados.");
    const signers = signatariosDe(campos, concedente).filter((item) => item.email);
    if (!campos.email.trim() || !concedente.email.trim()) {
      throw new AppError(422, "EMAIL_AUSENTE", "O estagiário e a empresa precisam ter e-mail para a assinatura. Gere o TCE novamente com esses e-mails.");
    }
    const pdf = await this.lerPdf(id);
    const doc = await criarDocumentoZapSign({
      apiUrl: this.config.ZAPSIGN_API_URL,
      apiToken: this.config.ZAPSIGN_API_TOKEN,
      name: `TCE - ${campos.nome}`,
      externalId: id,
      pdf,
      signers: signers.map((item) => ({ name: item.nome, email: item.email })),
    });
    await this.db.query(`
      UPDATE dna_work.termo_estagio
      SET status = 'enviado', zapsign_token = $2, signatarios = $3::jsonb, atualizado_em = now()
      WHERE id = $1
    `, [
      id,
      doc.token,
      JSON.stringify((doc.signers ?? []).map((signer) => ({
        nome: signer.name ?? "",
        email: signer.email ?? "",
        status: signer.status ?? "new",
        url: signer.sign_url ?? null,
      }))),
    ]);
    try {
      await this.enviarAssinaturas(id);
    } catch (error) {
      const mensagem = error instanceof AppError ? error.message : "A Mailjet não enviou o e-mail.";
      throw new AppError(502, "EMAIL_ASSINATURA", `O TCE foi enviado para assinatura, mas o e-mail não saiu. ${mensagem}`);
    }
    return this.termos.get(id);
  }

  async enviarAssinaturas(id: string) {
    const dados = await this.dadosTermo(id);
    const enviados: string[] = [];
    const papeis: Array<[string, string]> = [
      ["Assinatura Digital Candidato", dados.campos.email],
      ["Assinatura Digital Responsável Candidato", dados.campos.email_responsavel],
      ["Assinatura Digital Empresa", dados.concedente.email],
      ["Assinatura Digital Instituição de Ensino", dados.campos.escola_email],
    ];
    for (const [modelo, email] of papeis) {
      const alvo = texto(email).toLowerCase();
      const signer = dados.signatarios.find((item) => item.email.toLowerCase() === alvo);
      if (!alvo || !signer?.url) continue;
      await enviarModelo(this.db, this.config, modelo, { email: alvo, nome: signer.nome }, {
        ...variaveisDoTermo(dados.campos, dados.concedente),
        "@Nome-Assinatura-Digital": textoHtml(signer.nome),
        "@Link-Assinatura-Digital": signer.url,
      });
      enviados.push(alvo);
    }
    if (!enviados.length) throw new AppError(422, "EMAIL_AUSENTE", "Nenhum signatário com link de assinatura.");
    return { enviados };
  }

  async enviarAssinaturaEscola(id: string) {
    const dados = await this.dadosTermo(id);
    const email = texto(dados.campos.escola_email).toLowerCase();
    if (!email) throw new AppError(422, "EMAIL_AUSENTE", "A instituição de ensino está sem e-mail.");
    const escola = dados.signatarios.find((item) => item.email.toLowerCase() === email);
    const link = dados.termo.arquivo_assinado || escola?.url || "";
    const pdf = link ? null : await this.lerPdf(id);
    const nome = dados.campos.nome || "estagiário";
    return enviarModelo(this.db, this.config, "Assinatura manual instituição", {
      email,
      nome: dados.campos.nome_escola || "Instituição de ensino",
    }, {
      ...variaveisDoTermo(dados.campos, dados.concedente),
      "@Link-Assinatura-Digital": link || "documento em anexo",
    }, {
      copia: { email: "documentos@dnawork.ai", nome: "DNA Work" },
      attachments: pdf ? [{
        filename: `TCE-${nome}.pdf`.replace(/[^\w.\- ]+/g, ""),
        contentType: "application/pdf",
        base64: pdf.toString("base64"),
      }] : undefined,
    });
  }

  async enviarDocumento(id: string) {
    const termo = await this.termos.get(id);
    const saved = await this.db.query<{ payload: { campos?: ManualData; empresa?: Concedente } }>(
      "SELECT payload FROM public.tces WHERE id = $1",
      [id],
    );
    const campos = saved.rows[0]?.payload?.campos;
    const concedente = saved.rows[0]?.payload?.empresa;
    const pdf = await this.lerPdf(id);
    const vistos = new Set<string>();
    const destinatarios = [
      { nome: campos?.nome || termo.candidato_nome || "Estagiário", email: (campos?.email || "").toLowerCase() },
      { nome: concedente?.representante || concedente?.razao_social || termo.empresa_nome || "Empresa", email: (concedente?.email || "").toLowerCase() },
      { nome: campos?.nome_escola || "Instituição de ensino", email: (campos?.escola_email || "").toLowerCase() },
    ].filter((item) => item.email.includes("@") && !vistos.has(item.email) && vistos.add(item.email));
    const nome = campos?.nome || termo.candidato_nome || "estagiário";
    const enviados: string[] = [];
    for (const destino of destinatarios) {
      await enviarEmailMailjet({
        apiKey: this.config.MAILJET_API_KEY,
        secret: this.config.MAILJET_SECRET_KEY,
        fromEmail: this.config.MAILJET_FROM,
        fromName: this.config.MAILJET_FROM_NAME,
        to: [destino],
        subject: `TCE - ${nome}`,
        html: `<p>Olá,</p><p>A DNA Work envia o Termo de Compromisso de Estágio de <strong>${nome}</strong> em anexo.</p><p>Em caso de dúvida, responda este e-mail.</p>`,
        attachments: [{ filename: `TCE-${nome}.pdf`.replace(/[^\w.\- ]+/g, ""), contentType: "application/pdf", base64: pdf.toString("base64") }],
      });
      enviados.push(destino.email);
    }
    return { enviados };
  }

  private async dadosTermo(id: string) {
    const termo = await this.termos.get(id);
    const saved = await this.db.query<{ payload: { campos?: ManualData; empresa?: Concedente } }>(
      "SELECT payload FROM public.tces WHERE id = $1",
      [id],
    );
    const campos = saved.rows[0]?.payload?.campos;
    const concedente = saved.rows[0]?.payload?.empresa;
    if (!campos || !concedente) throw new AppError(404, "NAO_ENCONTRADO", "Dados do TCE não encontrados.");
    const bruto = termo.signatarios as unknown;
    const lista = typeof bruto === "string" ? JSON.parse(bruto) as unknown : bruto;
    const signatarios = Array.isArray(lista)
      ? lista.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const signer = item as { nome?: string; email?: string; url?: string | null };
        const email = texto(signer.email).toLowerCase();
        if (!email) return [];
        return [{ nome: signer.nome || email, email, url: signer.url ?? null }];
      })
      : [];
    return { termo, campos, concedente, signatarios };
  }
}

function texto(value: string | null | undefined) {
  return (value ?? "").trim();
}

function limite(value: string, max = 200) {
  return texto(value).slice(0, max);
}

let pastaPdf: string | null = null;

async function pastaGravavel(configured: string): Promise<string> {
  if (pastaPdf) return pastaPdf;
  const candidatas = [configured || path.join(process.cwd(), "data", "tces"), path.join(os.tmpdir(), "dnawork-tces")];
  for (const dir of candidatas) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.W_OK);
      pastaPdf = dir;
      return dir;
    } catch {
      continue;
    }
  }
  throw new AppError(500, "PDF_SEM_PASTA", "O servidor não conseguiu gravar o PDF do TCE.");
}

function erroGravacao(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const pg = error as { code?: string; message?: string };
  if (pg.code === "42P01" || pg.code === "42703" || pg.code === "23502") {
    return new AppError(500, "TCE_SCHEMA", "O banco ainda não está pronto para gravar o TCE. Reinicie o serviço para aplicar a atualização.");
  }
  if (pg.code === "22001") return new AppError(422, "TEXTO_LONGO", "Um dos textos passou do limite aceito pelo banco.");
  const detalhe = pg.message?.split("\n")[0]?.slice(0, 180);
  return new AppError(500, "TCE_GRAVACAO", detalhe ? `Não foi possível gravar o TCE. ${detalhe}` : "Não foi possível gravar o TCE.");
}

function signatariosDe(campos: ManualData, concedente: Concedente) {
  const lista = [
    { nome: campos.nome, email: texto(campos.email).toLowerCase(), status: "pendente", url: null as string | null },
  ];
  const responsavel = texto(campos.email_responsavel).toLowerCase();
  if (responsavel && responsavel !== lista[0].email) {
    lista.push({ nome: campos.nome_responsavel || "Responsável", email: responsavel, status: "pendente", url: null });
  }
  lista.push({ nome: concedente.representante || concedente.razao_social, email: texto(concedente.email).toLowerCase(), status: "pendente", url: null });
  const escolaEmail = texto(campos.escola_email).toLowerCase();
  if (escolaEmail) lista.push({ nome: campos.nome_escola || "Instituição de ensino", email: escolaEmail, status: "pendente", url: null });
  return lista;
}

function variaveisDoTermo(campos: ManualData, concedente: Concedente) {
  const nome = textoHtml(campos.nome);
  const empresa = textoHtml(concedente.razao_social);
  return {
    "@Documento-Nome": textoHtml(`TCE - ${campos.nome}`),
    "@Nome-Candidato": nome,
    "@Semestre-Candidato": textoHtml(campos.periodo),
    "@Ano-Escolar": textoHtml(campos.ano),
    "@Turno-Candidato": textoHtml(campos.turno),
    "@Variaveis-Candidato": `<br> Nome do candidato: ${nome}.`,
    "@Variaveis-vaga": "<br> Vaga: Estágio",
    "@Variaveis-Empresa": `<br><br> Razão Social: ${empresa}. <br> Nome Fantasia: ${empresa}. <br> CNPJ: ${textoHtml(concedente.cnpj)}`,
  };
}

export function camposFromBody(raw: Record<string, unknown>): ManualData {
  const campos = emptyManual();
  for (const key of Object.keys(campos) as Array<keyof ManualData>) {
    const value = raw[key];
    if (typeof value === "string") campos[key] = value.trim();
  }
  return campos;
}
