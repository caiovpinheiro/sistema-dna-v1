import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { getEscola, mensagemEscola, searchEscolas } from "../lib/escolas.js";
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
      email: (input.concedente.email || empresa.email).trim().toLowerCase(),
      representante: input.concedente.representante || empresa.representante,
    };
    if (!campos.nome.trim()) throw new AppError(422, "NOME_OBRIGATORIO", "Nome do candidato é obrigatório.");

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

      await this.db.query(`
        INSERT INTO dna_work.termo_estagio
          (id, id_contratacao, nome, status, signatarios, tce_id, candidato_nome, empresa_nome)
        VALUES ($1, NULL, $2, 'gerado', $3::jsonb, $1, $4, $5)
      `, [
        id,
        `TCE - ${campos.nome}`.slice(0, 200),
        JSON.stringify(signatariosDe(campos, concedente)),
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

  async lerPdf(id: string): Promise<Buffer> {
    const row = await this.db.query<{ pdf_path: string }>("SELECT pdf_path FROM public.tces WHERE id = $1", [id]);
    const filename = row.rows[0]?.pdf_path;
    if (!filename) throw new AppError(404, "NAO_ENCONTRADO", "PDF do TCE não encontrado.");
    const safe = path.basename(filename);
    try {
      return await fs.readFile(path.join(storageDir(this.config.PDF_STORAGE_DIR), safe));
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
    return this.termos.get(id);
  }
}

function signatariosDe(campos: ManualData, concedente: Concedente) {
  const lista = [
    { nome: campos.nome, email: campos.email.trim().toLowerCase(), status: "pendente", url: null as string | null },
    { nome: concedente.representante || concedente.razao_social, email: concedente.email.trim().toLowerCase(), status: "pendente", url: null },
  ];
  const escolaEmail = campos.escola_email.trim().toLowerCase();
  if (escolaEmail) lista.push({ nome: campos.nome_escola || "Instituição de ensino", email: escolaEmail, status: "pendente", url: null });
  return lista;
}

export function camposFromBody(raw: Record<string, unknown>): ManualData {
  const campos = emptyManual();
  for (const key of Object.keys(campos) as Array<keyof ManualData>) {
    const value = raw[key];
    if (typeof value === "string") campos[key] = value.trim();
  }
  return campos;
}
