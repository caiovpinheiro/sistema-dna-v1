import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { getEscola, mensagemEscola, searchEscolas } from "../lib/escolas-mysql.js";
import { getEmpresaCadastro, listEmpresasCadastro } from "../lib/supabase-empresas.js";
import { fillTceTemplate, storageDir } from "../lib/tce-pdf.js";
import { APOLICE_SEGURO, emptyManual, ESCOLA_KEYS, type Concedente, type ManualData } from "../lib/tce-fields.js";
import { criarDocumentoZapSign } from "../lib/zapsign.js";
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
      return { opcoes: await searchEscolas(this.config, termo), erro: "" };
    } catch (error) {
      return { opcoes: [], erro: mensagemEscola(error) };
    }
  }

  async gerar(input: GerarTceInput) {
    const empresa = await getEmpresaCadastro(this.config.SUPABASE_URL, this.config.SUPABASE_SERVICE_ROLE_KEY, input.empresaId);
    if (!empresa) throw new AppError(404, "NAO_ENCONTRADO", "Empresa não encontrada.");
    const campos = { ...input.campos, seguro_apolice: APOLICE_SEGURO };
    if (input.escolaId) {
      const escola = await getEscola(this.config, input.escolaId);
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
      email: (input.concedente.email || empresa.email).trim().toLowerCase(),
      representante: input.concedente.representante || empresa.representante,
    };
    const candidatoEmail = campos.email.trim().toLowerCase();
    if (!campos.nome.trim()) throw new AppError(422, "NOME_OBRIGATORIO", "Nome do candidato é obrigatório.");
    if (!candidatoEmail || !concedente.email) {
      throw new AppError(422, "EMAIL_AUSENTE", "O estagiário e a empresa precisam ter e-mail para a assinatura.");
    }

    const id = randomUUID();
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
    const dir = storageDir(this.config.PDF_STORAGE_DIR);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${id}.pdf`;
    await fs.writeFile(path.join(dir, filename), pdf);

    try {
      await this.db.query(`
        INSERT INTO public.tces (id, empresa_id, empresa_nome, candidato_nome, payload, pdf_path, status)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'generated')
      `, [id, empresa.id, concedente.razao_social, campos.nome, JSON.stringify({ campos, empresa: concedente }), filename]);

      const signers = [
        { name: campos.nome, email: candidatoEmail },
        { name: concedente.representante || concedente.razao_social, email: concedente.email },
      ];
      const escolaEmail = campos.escola_email.trim().toLowerCase();
      if (escolaEmail) signers.push({ name: campos.nome_escola || "Instituição de ensino", email: escolaEmail });

      const doc = await criarDocumentoZapSign({
        apiUrl: this.config.ZAPSIGN_API_URL,
        apiToken: this.config.ZAPSIGN_API_TOKEN,
        name: `TCE - ${campos.nome}`,
        externalId: id,
        pdf: Buffer.from(pdf),
        signers,
      });
      await this.db.query(`
        INSERT INTO dna_work.termo_estagio
          (id, id_contratacao, nome, zapsign_token, status, signatarios, tce_id, candidato_nome, empresa_nome)
        VALUES ($1, NULL, $2, $3, 'enviado', $4::jsonb, $1, $5, $6)
      `, [
        id,
        `TCE - ${campos.nome}`.slice(0, 200),
        doc.token,
        JSON.stringify((doc.signers ?? []).map((signer) => ({
          nome: signer.name ?? "",
          email: signer.email ?? "",
          status: signer.status ?? "new",
          url: signer.sign_url ?? null,
        }))),
        campos.nome,
        concedente.razao_social,
      ]);
    } catch (error) {
      await fs.unlink(path.join(dir, filename)).catch(() => undefined);
      await this.db.query("DELETE FROM public.tces WHERE id = $1", [id]).catch(() => undefined);
      throw error;
    }
    return this.termos.get(id);
  }
}

export function camposFromBody(raw: Record<string, unknown>): ManualData {
  const campos = emptyManual();
  for (const key of Object.keys(campos) as Array<keyof ManualData>) {
    const value = raw[key];
    if (typeof value === "string") campos[key] = value.trim();
  }
  return campos;
}
