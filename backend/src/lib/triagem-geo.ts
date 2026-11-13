export type Ponto = { lat: number; lng: number };

const RAIO_TERRA_KM = 6371;

export function distanciaKm(a: Ponto, b: Ponto): number {
  const rad = (grau: number) => (grau * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cepFormatado(cep: string): string {
  return cep.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

function pontoValido(lat: unknown, lng: unknown): Ponto | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

async function getJson<T>(url: string | URL, timeoutMs = 6000): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function awesomeApi(cep: string): Promise<Ponto | null> {
  const body = await getJson<{ lat?: string; lng?: string }>(`https://cep.awesomeapi.com.br/json/${cep}`);
  return body ? pontoValido(body.lat, body.lng) : null;
}

async function google(cep: string, apiKey: string): Promise<Ponto | null> {
  if (!apiKey) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", cepFormatado(cep));
  url.searchParams.set("components", "country:BR");
  url.searchParams.set("region", "br");
  url.searchParams.set("key", apiKey);
  type Resultado = {
    types?: string[];
    address_components?: Array<{ long_name?: string; types?: string[] }>;
    geometry?: { location?: { lat: number; lng: number } };
  };
  const body = await getJson<{ status?: string; results?: Resultado[] }>(url);
  // Sem CEP correspondente o Google devolve o centro do país ou da cidade; esse ponto não serve.
  const resultado = body?.status === "OK" ? body.results?.find((item) => item.address_components?.some((parte) =>
    parte.types?.includes("postal_code") && (parte.long_name ?? "").replace(/\D/g, "").startsWith(cep.slice(0, 5)))) : undefined;
  const location = resultado?.geometry?.location;
  return location ? pontoValido(location.lat, location.lng) : null;
}

type Geocoder = (cep: string, googleKey: string) => Promise<Ponto | null>;

const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { ponto: Ponto; ate: number }>();

/**
 * Ponto do CEP da pessoa. Google primeiro: AwesomeAPI e BrasilAPI erram com frequência
 * (em 2026-11-13, para 04854-410 / Jardim Azano I, as duas deram um ponto 26 a 27 km longe,
 * perto do centro; a BrasilAPI errou de 2,5 a 27 km em 9 de 10 CEPs testados).
 * Sem Google (sem chave ou sem resultado do próprio CEP), usa a AwesomeAPI. A BrasilAPI não é usada.
 * Resultado guardado por 24 h em memória. Uma falha não derruba a busca: devolve null.
 */
export async function geocodeCepServidor(
  cep: string,
  googleKey: string,
  fontes: { google: Geocoder; awesome: Geocoder } = { google, awesome: (valor) => awesomeApi(valor) },
): Promise<Ponto | null> {
  const guardado = cache.get(cep);
  if (guardado && guardado.ate > Date.now()) return guardado.ponto;
  const ponto = await fontes.google(cep, googleKey) ?? await fontes.awesome(cep, googleKey);
  if (ponto) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(cep, { ponto, ate: Date.now() + CACHE_MS });
  }
  return ponto;
}

/** Só para testes: esvazia o cache de CEPs. */
export function limparCacheCep() {
  cache.clear();
}

export async function rotuloDoCep(cep: string): Promise<string> {
  const body = await getJson<{ erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }>(`https://viacep.com.br/ws/${cep}/json/`, 4000);
  if (!body || body.erro) return `CEP ${cepFormatado(cep)}`;
  const rua = [body.logradouro, body.bairro].filter(Boolean).join(", ");
  const cidade = [body.localidade, body.uf].filter(Boolean).join("/");
  return [rua, cidade].filter(Boolean).join(" - ") || `CEP ${cepFormatado(cep)}`;
}
