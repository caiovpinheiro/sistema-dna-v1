import type { Pool } from "pg";
import { AppError } from "../lib/errors.js";
import { decodificarBase64, detectarTipo } from "../lib/curriculo/arquivo.js";

/** Documentos do candidato (public.candidato_documentos): um por tipo, vindos do TCE e dos arquivos do sistema antigo. */
export const TIPOS_DOCUMENTO = ["cpf", "rg", "nascimento", "endereco", "matricula", "responsavel"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export type DocumentoCandidato = {
  id: string;
  tipo: TipoDocumento;
  valor: string | null;
  dados: Record<string, string> | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
  tem_arquivo: boolean;
  origem: string;
  tce_id: string | null;
  atualizado_em: string;
};

const digitos = (valor: string | null | undefined) => (valor ?? "").replace(/\D/g, "");
const texto = (valor: string | null | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();

/**
 * Candidato do TCE: o escolhido na tela; senão o da contratação; senão o cadastrado com o mesmo CPF.
 * Sem nenhum desses, null (o TCE segue normal, só não grava os documentos).
 */
export async function candidatoDoTce(db: Pool, input: { idCandidato?: string | null; idContratacao?: number | null; cpf?: string | null }) {
  if (input.idCandidato?.trim()) {
    const { rows } = await db.query<{ id: string }>("SELECT id_candidato AS id FROM dna_work.candidato WHERE id_candidato = $1", [input.idCandidato.trim()]);
    if (rows[0]) return rows[0].id;
  }
  if (input.idContratacao) {
    const { rows } = await db.query<{ id: string }>("SELECT id_candidato AS id FROM dna_work.conratacaovaga WHERE id_contratacao = $1", [input.idContratacao]);
    if (rows[0]?.id) return rows[0].id;
  }
  const cpf = digitos(input.cpf);
  if (cpf.length === 11) {
    const { rows } = await db.query<{ id: string }>(
      "SELECT id_candidato AS id FROM dna_work.candidato WHERE regexp_replace(coalesce(cpf, ''), '\\D', '', 'g') = $1 ORDER BY ultimaalteracao DESC NULLS LAST LIMIT 1",
      [cpf],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** Linhas que o TCE preenche, a partir dos campos digitados na tela. Campo vazio não apaga o que já existe. */
export function documentosDoTce(campos: Record<string, string>) {
  const linhas: Array<{ tipo: TipoDocumento; valor: string | null; dados: Record<string, string> | null }> = [];
  if (texto(campos.cpf)) linhas.push({ tipo: "cpf", valor: texto(campos.cpf), dados: null });
  if (texto(campos.rg)) linhas.push({ tipo: "rg", valor: texto(campos.rg), dados: null });
  if (texto(campos.data_nascimento)) linhas.push({ tipo: "nascimento", valor: texto(campos.data_nascimento), dados: null });
  const endereco = [texto(campos.endereco), texto(campos.cep) && `CEP ${texto(campos.cep)}`, [texto(campos.cidade), texto(campos.estado)].filter(Boolean).join(" / ")]
    .filter(Boolean).join(" · ");
  if (endereco) linhas.push({ tipo: "endereco", valor: endereco, dados: null });
  const responsavel = Object.fromEntries(
    [["nome", campos.nome_responsavel], ["nascimento", campos.nascimento_responsavel], ["cpf", campos.cpf_responsavel], ["rg", campos.rg_responsavel],
      ["email", campos.email_responsavel], ["telefone", campos.telefone_responsavel], ["endereco", campos.endereco_responsavel],
      ["cep", campos.cep_responsavel], ["cidade", campos.cidade_responsavel], ["estado", campos.estado_responsavel]]
      .map(([chave, valor]) => [chave, texto(valor)])
      .filter(([, valor]) => valor),
  );
  if (responsavel.nome) linhas.push({ tipo: "responsavel", valor: responsavel.nome, dados: responsavel });
  return linhas;
}

/** Grava (ou atualiza) os documentos que vieram do TCE; o arquivo que já existir para o tipo continua guardado. */
export async function gravarDocumentosDoTce(db: Pool, idCandidato: string, campos: Record<string, string>, tceId: string) {
  const linhas = documentosDoTce(campos);
  for (const linha of linhas) {
    await db.query(
      `INSERT INTO public.candidato_documentos (id_candidato, tipo, valor, dados, origem, tce_id, atualizado_em)
       VALUES ($1, $2, $3, $4::jsonb, 'tce', $5, now())
       ON CONFLICT (id_candidato, tipo) DO UPDATE SET
         valor = EXCLUDED.valor, dados = EXCLUDED.dados, origem = 'tce', tce_id = EXCLUDED.tce_id, atualizado_em = now()`,
      [idCandidato, linha.tipo, linha.valor, linha.dados ? JSON.stringify(linha.dados) : null, tceId],
    );
  }
  return linhas.length;
}

export async function listarDocumentos(db: Pool, idCandidato: string): Promise<DocumentoCandidato[]> {
  const { rows } = await db.query<DocumentoCandidato>(
    `SELECT id::text, tipo, valor, dados, arquivo_nome, arquivo_tipo, (arquivo IS NOT NULL) AS tem_arquivo, origem, tce_id, atualizado_em::text
     FROM public.candidato_documentos WHERE id_candidato = $1`,
    [idCandidato],
  );
  return rows.sort((a, b) => TIPOS_DOCUMENTO.indexOf(a.tipo) - TIPOS_DOCUMENTO.indexOf(b.tipo));
}

export async function arquivoDoDocumento(db: Pool, idCandidato: string, id: string) {
  const { rows } = await db.query<{ arquivo: Buffer | null; arquivo_nome: string | null; arquivo_tipo: string | null }>(
    "SELECT arquivo, arquivo_nome, arquivo_tipo FROM public.candidato_documentos WHERE id_candidato = $1 AND id::text = $2",
    [idCandidato, id],
  );
  return rows[0]?.arquivo ? rows[0] : null;
}

/** Tipos de arquivo aceitos no envio pela ficha (detectados pelos bytes) e o content-type gravado. */
export const MIME_DOCUMENTO = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;
export const TAMANHO_MAXIMO_DOCUMENTO = 5 * 1024 * 1024;

/**
 * Anexa ou troca o arquivo de um tipo de documento, enviado pela ficha do candidato.
 * O número/texto do documento (valor e dados, vindos do TCE) continua como está.
 */
export async function gravarArquivoDoDocumento(
  db: Pool,
  idCandidato: string,
  tipo: TipoDocumento,
  arquivo: { conteudo: Buffer; nome: string; mime: string },
): Promise<DocumentoCandidato> {
  const { rows } = await db.query<DocumentoCandidato>(
    `INSERT INTO public.candidato_documentos (id_candidato, tipo, arquivo, arquivo_nome, arquivo_tipo, origem, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, 'ficha', now())
     ON CONFLICT (id_candidato, tipo) DO UPDATE SET
       arquivo = EXCLUDED.arquivo, arquivo_nome = EXCLUDED.arquivo_nome, arquivo_tipo = EXCLUDED.arquivo_tipo,
       origem = 'ficha', atualizado_em = now()
     RETURNING id::text, tipo, valor, dados, arquivo_nome, arquivo_tipo, (arquivo IS NOT NULL) AS tem_arquivo, origem, tce_id, atualizado_em::text`,
    [idCandidato, tipo, arquivo.conteudo, arquivo.nome, arquivo.mime],
  );
  return rows[0];
}

/** Valida o arquivo enviado (base64): só PDF, PNG, JPG ou WEBP, pelo conteúdo, até 5 MB. */
export function prepararArquivoDocumento(arquivo: { nome: string; base64: string }) {
  const conteudo = decodificarBase64(arquivo.base64);
  if (!conteudo.length) throw new AppError(422, "ARQUIVO_VAZIO", "O arquivo está vazio.");
  if (conteudo.length > TAMANHO_MAXIMO_DOCUMENTO) throw new AppError(413, "ARQUIVO_GRANDE", "O arquivo passa de 5 MB.");
  const tipo = detectarTipo(conteudo);
  if (!(tipo in MIME_DOCUMENTO)) throw new AppError(415, "TIPO_NAO_ACEITO", "Envie o documento em PDF, PNG, JPG ou WEBP.");
  const nome = arquivo.nome.replace(/[\\/]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200) || "documento";
  return { conteudo, nome, mime: MIME_DOCUMENTO[tipo as keyof typeof MIME_DOCUMENTO] };
}
