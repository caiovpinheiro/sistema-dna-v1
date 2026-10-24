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
