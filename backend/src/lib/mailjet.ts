import { AppError } from "./errors.js";

type Destino = { email: string; nome: string };
type Anexo = { filename: string; contentType: string; base64: string };

export async function enviarEmailMailjet(input: {
  apiKey: string;
  secret: string;
  fromEmail: string;
  fromName: string;
  to: Destino[];
  subject: string;
  html: string;
  attachments?: Anexo[];
}) {
  if (!input.apiKey || !input.secret) {
    throw new AppError(503, "MAILJET_NAO_CONFIGURADO", "Defina MAILJET_API_KEY e MAILJET_SECRET_KEY no ambiente.");
  }
  const destinos = input.to.filter((item) => item.email.includes("@"));
  if (!destinos.length) throw new AppError(422, "EMAIL_AUSENTE", "Nenhum destinatário com e-mail.");
  const response = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${input.apiKey}:${input.secret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      Messages: [{
        From: { Email: input.fromEmail, Name: input.fromName },
        To: destinos.map((item) => ({ Email: item.email, Name: item.nome || item.email })),
        Subject: input.subject,
        HTMLPart: input.html,
        Attachments: (input.attachments ?? []).map((item) => ({
          ContentType: item.contentType,
          Filename: item.filename,
          Base64Content: item.base64,
        })),
      }],
    }),
  });
  const payload = await response.json().catch(() => null) as { Messages?: Array<{ Status?: string }> } | null;
  if (!response.ok || payload?.Messages?.[0]?.Status !== "success") {
    throw new AppError(502, "MAILJET_RECUSOU", "A Mailjet não enviou o e-mail.");
  }
  return { enviados: destinos.map((item) => item.email) };
}
