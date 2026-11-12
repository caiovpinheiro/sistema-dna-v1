import type { Pool } from "pg";

type Endereco = { logradouro?: string | null; numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; cep?: string | null };

/** "Rua X, 123 - Bairro, Cidade - UF, 00000-000, Brasil": o endereço inteiro, para o Google achar o ponto certo. */
export function enderecoParaGeocode(partes: Endereco) {
  const limpo = (valor: string | null | undefined) => (valor ?? "").replace(/\s+/g, " ").trim();
  const rua = [limpo(partes.logradouro), limpo(partes.numero)].filter(Boolean).join(", ");
  const cidadeUf = [limpo(partes.cidade), limpo(partes.uf).toUpperCase()].filter(Boolean).join(" - ");
  const digitos = limpo(partes.cep).replace(/\D/g, "");
  const cep = digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : "";
  const trechos = [[rua, limpo(partes.bairro)].filter(Boolean).join(" - "), cidadeUf, cep].filter(Boolean);
  return rua && cidadeUf ? `${trechos.join(", ")}, Brasil` : "";
}

/** "Bairro - Cidade / UF", o formato de public.empresa.local. */
export function localDaEmpresa(bairro: string, cidade: string, uf: string) {
  const cidadeUf = `${cidade.trim()} / ${uf.trim().toUpperCase()}`;
  return bairro.trim() ? `${bairro.trim()} - ${cidadeUf}` : cidadeUf;
}

/**
 * Latitude e longitude pelo endereço completo; sem resultado, pelo CEP. Null quando o Google não acha.
 * Só o CEP não basta: em cidade de CEP único (ex.: Mongaguá, Capivari) o Google devolve o centro da cidade.
 */
export async function geocodeEndereco(apiKey: string, cep: string, endereco?: Endereco): Promise<{ lat: number; lng: number } | null> {
  const completo = endereco ? enderecoParaGeocode({ ...endereco, cep }) : "";
  for (const busca of [completo, cep].filter(Boolean)) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", busca);
    url.searchParams.set("components", "country:BR");
    url.searchParams.set("region", "br");
    url.searchParams.set("key", apiKey);
    const response = await fetch(url);
    const body = await response.json() as { status?: string; results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
    const location = body.results?.[0]?.geometry?.location;
    if (response.ok && location && body.status === "OK") return location;
  }
  return null;
}

const digitos = (valor: string | null | undefined) => (valor ?? "").replace(/\D/g, "");
const texto = (valor: string | null | undefined) =>
  (valor ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

export type EnderecoComparado = { cep: string | null; logradouro: string | null; numero: string | null };

/** A ficha (dna_work.empresa) tem outro endereço que o da triagem (public.empresa)? Ficha incompleta não conta. */
export function enderecoMudou(triagem: EnderecoComparado, ficha: EnderecoComparado & { cidade: string | null }): boolean {
  if (digitos(ficha.cep).length !== 8 || !texto(ficha.logradouro) || !texto(ficha.cidade)) return false;
  return digitos(triagem.cep) !== digitos(ficha.cep)
    || texto(triagem.logradouro) !== texto(ficha.logradouro)
    || texto(triagem.numero) !== texto(ficha.numero);
}

type Linha = {
  id: string;
  cep_triagem: string | null;
  logradouro_triagem: string | null;
  numero_triagem: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

export type EnderecoAtualizado = { id: string; antes: string; depois: string; lat: number; lng: number; vagas: number };
type Log = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };

/**
 * A triagem mede a distância por public.empresa e public.vaga, que guardam uma cópia do endereço feita no cadastro.
 * Quando o endereço muda na ficha (dna_work.empresa), a cópia ficava velha e a distância saía da unidade antiga.
 * Aqui o endereço da ficha volta para a cópia, com latitude e longitude novas, na empresa e nas vagas dela.
 */
export async function sincronizarEnderecoEmpresas(
  db: Pool,
  apiKey: string,
  log: Log,
  opcoes: { dry?: boolean; ids?: string[] } = {},
): Promise<EnderecoAtualizado[]> {
  const filtro = opcoes.ids?.length ? "AND p.id::text = ANY($1::text[])" : "";
  const { rows } = await db.query<Linha>(
    `SELECT p.id::text AS id, p.cep AS cep_triagem, p.logradouro AS logradouro_triagem, p.numero AS numero_triagem,
            e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf
     FROM public.empresa p
     JOIN dna_work.empresa e ON e.id_empresa::text = p.id::text
     WHERE true ${filtro}`,
    opcoes.ids?.length ? [opcoes.ids] : [],
  );
  const mudaram = rows.filter((linha) => enderecoMudou(
    { cep: linha.cep_triagem, logradouro: linha.logradouro_triagem, numero: linha.numero_triagem },
    linha,
  ));
  if (!mudaram.length) return [];
  if (!apiKey) {
    log.warn({ empresas: mudaram.map((linha) => linha.id) }, "endereço da empresa: GOOGLE_MAPS_API_KEY ausente, distância da triagem segue no endereço antigo");
    return [];
  }

  const atualizadas: EnderecoAtualizado[] = [];
  for (const linha of mudaram) {
    const antes = [linha.logradouro_triagem, linha.numero_triagem, linha.cep_triagem].filter(Boolean).join(", ");
    const depois = [linha.logradouro, linha.numero, linha.cep].filter(Boolean).join(", ");
    try {
      const ponto = await geocodeEndereco(apiKey, digitos(linha.cep), linha);
      if (!ponto) {
        log.warn({ id_empresa: linha.id, depois }, "endereço da empresa: Google não localizou o endereço da ficha");
        continue;
      }
      let vagas = 0;
      if (!opcoes.dry) {
        const cliente = await db.connect();
        try {
          await cliente.query("BEGIN");
          await cliente.query(
            `UPDATE public.empresa SET cep = $2, logradouro = $3, numero = $4, complemento = $5, local = $6, latitude = $7, longitude = $8
             WHERE id::text = $1`,
            [
              linha.id, linha.cep, linha.logradouro, linha.numero || null, linha.complemento || null,
              localDaEmpresa(linha.bairro ?? "", linha.cidade ?? "", linha.uf ?? ""), ponto.lat, ponto.lng,
            ],
          );
          const resultado = await cliente.query(
            "UPDATE public.vaga SET cep = $2, latitude = $3, longitude = $4 WHERE empresa_id::text = $1",
            [linha.id, linha.cep, ponto.lat, ponto.lng],
          );
          vagas = resultado.rowCount ?? 0;
          await cliente.query("COMMIT");
        } catch (error) {
          await cliente.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          cliente.release();
        }
      }
      atualizadas.push({ id: linha.id, antes, depois, lat: ponto.lat, lng: ponto.lng, vagas });
      log.info({ dry: Boolean(opcoes.dry), id_empresa: linha.id, antes, depois, vagas }, "endereço da empresa: triagem atualizada");
    } catch (error) {
      log.error({ id_empresa: linha.id, erro: error instanceof Error ? error.message : String(error) }, "endereço da empresa: falha ao atualizar");
    }
  }
  return atualizadas;
}
