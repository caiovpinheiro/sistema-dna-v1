import { createHash, timingSafeEqual } from "node:crypto";

export function sha256Hex(valor: string | Buffer): string {
  return createHash("sha256").update(valor).digest("hex");
}

/** Comparação em tempo constante de duas strings (tamanhos diferentes → false, sem vazar o tamanho). */
export function iguaisSeguro(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}
