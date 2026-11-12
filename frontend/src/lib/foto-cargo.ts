import { chaveCargo } from "@/lib/cargo";

/** Fotos ilustrativas em frontend/public/cargos/<chave-com-hifens>.jpg (1024 px, JPEG). */
const FOTOS = new Set([
  "acougueiro", "ajudante-de-padeiro", "ajudante-geral", "assistente-de-marketing", "atendente-comercial",
  "auxiliar-de-acougueiro", "auxiliar-de-padaria", "auxiliar-de-producao", "balconista-de-frios", "balconista-de-padaria",
  "balconista-de-pereciveis", "consultor-comercial", "cozinheiro", "estagio-de-vendas", "fiscal-de-loja", "garcom",
  "operador-de-caixa", "operador-de-loja", "padeiro", "repositor-de-hortifruti", "repositor-de-loja",
  "repositor-de-mercadoria", "repositor-de-pereciveis", "suporte-comercial",
]);

/** Cargos com outro nome que usam a mesma foto. */
const MESMA_FOTO: Record<string, string> = {
  "estagiario-marketing": "assistente-de-marketing",
  "estagiario-de-marketing": "assistente-de-marketing",
  "auxiliar-de-padeiro": "auxiliar-de-padaria",
};

/** URL da foto do cargo, ou null se o cargo não tem foto. */
export function fotoDoCargo(cargo: string | null | undefined): string | null {
  if (!cargo) return null;
  const chave = chaveCargo(cargo).replace(/ /g, "-");
  const arquivo = MESMA_FOTO[chave] ?? chave;
  return FOTOS.has(arquivo) ? `${import.meta.env.BASE_URL}cargos/${arquivo}.jpg` : null;
}

/** A área de transferência só aceita PNG: carrega o JPEG e redesenha num canvas. */
async function pngDaFoto(url: string): Promise<Blob> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error("Foto não encontrada.");
  const bitmap = await createImageBitmap(await resposta.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao gerar a imagem."))), "image/png"));
}

/**
 * Copia o texto e, se houver foto, a foto junto: um único item com text/plain e image/png.
 * O chat do CRM precisa usar o text/plain como legenda da imagem colada (correção pedida no CRM).
 * Se o navegador não aceitar imagem, copia só o texto. Devolve true quando a foto foi junto.
 */
export async function copiarComFoto(texto: string, foto: string | null): Promise<boolean> {
  if (foto && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      // A Promise dentro do ClipboardItem mantém o clique como gesto do usuário enquanto a foto carrega.
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([texto], { type: "text/plain" }),
        "image/png": pngDaFoto(foto),
      })]);
      return true;
    } catch {
      // cai para o texto puro
    }
  }
  await navigator.clipboard.writeText(texto);
  return false;
}
