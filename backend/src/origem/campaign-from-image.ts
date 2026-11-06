import { recognizeImageText } from './ocr-tesseract.js';
import { campaignOcrHasCargo, firstHumanCampaign, parseCampaignLabel } from './campaign-label.js';

export {
  campaignDisplayName,
  firstHumanCampaign,
  looksLikeMachineId,
  parseCampaignLabel,
} from './campaign-label.js';

const CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const FETCH_TIMEOUT_MS = 8_000;

const inflight = new Map<string, Promise<string | null>>();

function instagramCode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return match?.[1] || null;
}

function ogImageUrl(html: string): string | null {
  const tagged =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return tagged?.[1]?.replace(/&amp;/g, '&') || null;
}

function isImageBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return true;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return true;
  }
  return (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

async function fetchWithCrawler(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': CRAWLER_UA,
      Accept: 'text/html,image/avif,image/webp,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function bufferFromResponse(response: Response): Promise<Buffer | null> {
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  return isImageBuffer(buffer) ? buffer : null;
}

export async function fetchCampaignImage(referrer: string): Promise<Buffer | null> {
  if (/wa\.me|whatsapp\.com/i.test(referrer)) return null;
  const instagram = instagramCode(referrer);
  if (instagram) {
    return bufferFromResponse(
      await fetchWithCrawler(`https://www.instagram.com/p/${instagram}/media/?size=l`)
    );
  }

  const page = await fetchWithCrawler(referrer);
  const contentType = page.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    return bufferFromResponse(page);
  }
  if (!page.ok) return null;

  const imageUrl = ogImageUrl(await page.text());
  if (!imageUrl) return null;
  return bufferFromResponse(await fetchWithCrawler(imageUrl));
}

export async function resolveCampaignLabelFromReferrer(
  referrer: string,
  headline?: string | null
): Promise<string | null> {
  const key = referrer.trim();
  if (!key) return firstHumanCampaign(headline);

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const image = await fetchCampaignImage(key);
      if (!image) return parseCampaignLabel('', headline);
      const { PSM } = await import('tesseract.js');
      const sparse = await recognizeImageText(image, PSM.SPARSE_TEXT);
      if (campaignOcrHasCargo(sparse)) return parseCampaignLabel(sparse, headline);
      const auto = await recognizeImageText(image, PSM.AUTO);
      return parseCampaignLabel(`${sparse}\n${auto}`, headline);
    } catch (error) {
      console.warn('Não foi possível ler a foto da campanha:', error);
      return firstHumanCampaign(headline);
    }
  })();

  inflight.set(key, promise);
  return promise;
}
