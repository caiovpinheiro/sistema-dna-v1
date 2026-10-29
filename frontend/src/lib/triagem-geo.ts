export type Ponto = { lat: number; lng: number };
export type GeoCep = { ponto: Ponto | null; rua: string; cidade: string; uf: string };

async function getJson<T>(url: string, timeoutMs = 6000): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function pontoValido(lat: unknown, lng: unknown): Ponto | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}

async function viaCep(cep: string) {
  const body = await getJson<{ erro?: boolean | string; logradouro?: string; localidade?: string; uf?: string }>(`https://viacep.com.br/ws/${cep}/json/`);
  if (!body || body.erro) return { rua: "", cidade: "", uf: "" };
  return { rua: body.logradouro ?? "", cidade: body.localidade ?? "", uf: body.uf ?? "" };
}

async function awesomeApi(cep: string) {
  const body = await getJson<{ lat?: string; lng?: string }>(`https://cep.awesomeapi.com.br/json/${cep}`);
  return body ? pontoValido(body.lat, body.lng) : null;
}

async function brasilApi(cep: string) {
  const body = await getJson<{ location?: { coordinates?: { latitude?: string; longitude?: string } } }>(`https://brasilapi.com.br/api/cep/v2/${cep}`);
  const coord = body?.location?.coordinates;
  return coord ? pontoValido(coord.latitude, coord.longitude) : null;
}

/** Photon só vale quando o CEP do resultado começa igual ao pedido; nunca cai no centro genérico da cidade. */
async function photon(cep: string, rua: string, cidade: string, uf: string) {
  if (!cidade) return null;
  const q = [rua, cidade, uf, `${cep.slice(0, 5)}-${cep.slice(5)}`].filter(Boolean).join(", ");
  const body = await getJson<{ features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { postcode?: string } }> }>(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`,
  );
  const prefixo = cep.slice(0, 5);
  const feature = body?.features?.find((item) => (item.properties?.postcode ?? "").replace(/\D/g, "").startsWith(prefixo));
  const coords = feature?.geometry?.coordinates;
  return coords ? pontoValido(coords[1], coords[0]) : null;
}

/** Geocodifica o CEP no navegador. Uma falha de um serviço passa para o próximo. */
export async function geocodeCep(cep: string): Promise<GeoCep> {
  const [endereco, awesome] = await Promise.all([viaCep(cep), awesomeApi(cep)]);
  const ponto = awesome ?? await brasilApi(cep) ?? await photon(cep, endereco.rua, endereco.cidade, endereco.uf);
  return { ponto, ...endereco };
}
