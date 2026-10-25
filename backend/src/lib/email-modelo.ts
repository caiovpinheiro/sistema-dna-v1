import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { AppError } from "./errors.js";
import { enviarEmailMailjet } from "./mailjet.js";

type Destino = { email: string; nome: string };
type Anexo = { filename: string; contentType: string; base64: string };

export function aplicarVariaveis(texto: string, variaveis: Record<string, string>) {
  const chaves = Object.keys(variaveis).sort((a, b) => b.length - a.length);
  return chaves.reduce((saida, chave) => saida.split(chave).join(variaveis[chave] ?? ""), texto);
}

export function textoHtml(valor: string) {
  return valor.replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[caractere] ?? caractere);
}

export async function enviarModelo(
  db: Pool,
  config: AppConfig,
  descricao: string,
  para: Destino,
  variaveis: Record<string, string>,
  opcoes?: { copia?: Destino; attachments?: Anexo[] },
) {
  const modelo = await db.query<{ assunto: string | null; texto: string | null; remetente: string | null }>(`
    SELECT e.assunto, e.texto, s.remetente_jetmail AS remetente
    FROM dna_work.emailsvinculo v
    JOIN dna_work.emails e ON e.id_email = v.id_email
    LEFT JOIN dna_work.servidor_email s ON s.id::text = v.conta_email::text
    WHERE v.descricao = $1
    LIMIT 1
  `, [descricao]);
  const linha = modelo.rows[0];
  if (!linha?.texto) throw new AppError(404, "MODELO_NAO_ENCONTRADO", `O modelo "${descricao}" não está cadastrado.`);
  const assunto = aplicarVariaveis(linha.assunto ?? descricao, variaveis);
  const html = aplicarVariaveis(linha.texto, variaveis);
  const remetente = linha.remetente || config.MAILJET_FROM;
  const destinos = [para, opcoes?.copia].filter((item): item is Destino => Boolean(item?.email.includes("@")));
  const vistos = new Set<string>();
  const enviados: string[] = [];
  for (const destino of destinos) {
    const email = destino.email.trim().toLowerCase();
    if (vistos.has(email)) continue;
    vistos.add(email);
    await enviarEmailMailjet({
      apiKey: config.MAILJET_API_KEY,
      secret: config.MAILJET_SECRET_KEY,
      fromEmail: remetente,
      fromName: config.MAILJET_FROM_NAME,
      to: [{ email, nome: destino.nome || email }],
      subject: assunto,
      html,
      attachments: opcoes?.attachments,
    });
    enviados.push(email);
  }
  return { enviados, remetente };
}

export async function listarModelosEmail(db: Pool) {
  const rows = await db.query<{
    id: number;
    vinculo: number;
    descricao: string;
    assunto: string | null;
    texto: string | null;
    remetente: string | null;
  }>(`
    SELECT e.id_email AS id, v.id AS vinculo, v.descricao, e.assunto, e.texto, s.remetente_jetmail AS remetente
    FROM dna_work.emailsvinculo v
    JOIN dna_work.emails e ON e.id_email = v.id_email
    LEFT JOIN dna_work.servidor_email s ON s.id::text = v.conta_email::text
    WHERE v.id_email IS NOT NULL AND v.id_email <> 0 AND coalesce(e.texto, '') <> ''
    ORDER BY v.descricao
  `);
  return rows.rows;
}

export async function salvarModeloEmail(db: Pool, id: number, vinculo: number, descricao: string, assunto: string, texto: string) {
  const repetido = await db.query(`
    SELECT 1 FROM dna_work.emailsvinculo WHERE descricao = $1 AND id <> $2 LIMIT 1
  `, [descricao, vinculo]);
  if (repetido.rows.length) throw new AppError(409, "MODELO_REPETIDO", "Já existe um modelo com esse nome.");
  const nome = await db.query(`UPDATE dna_work.emailsvinculo SET descricao = $2 WHERE id = $1`, [vinculo, descricao]);
  if (!nome.rowCount) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo de e-mail não encontrado.");
  const result = await db.query(`UPDATE dna_work.emails SET assunto = $2, texto = $3 WHERE id_email = $1`, [id, assunto, texto]);
  if (!result.rowCount) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo de e-mail não encontrado.");
  return { id, descricao, assunto };
}

export async function excluirModeloEmail(db: Pool, vinculo: number) {
  const apagado = await db.query<{ id_email: number }>(`
    DELETE FROM dna_work.emailsvinculo WHERE id = $1 RETURNING id_email
  `, [vinculo]);
  const idEmail = apagado.rows[0]?.id_email;
  if (!idEmail) throw new AppError(404, "MODELO_NAO_ENCONTRADO", "Modelo de e-mail não encontrado.");
  await db.query(`
    DELETE FROM dna_work.emails e
    WHERE e.id_email = $1
      AND NOT EXISTS (SELECT 1 FROM dna_work.emailsvinculo v WHERE v.id_email = e.id_email)
  `, [idEmail]);
  return { id: vinculo };
}
