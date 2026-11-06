function readEnv(name: string): string { return process.env[name] || ''; }

const CRM_INTEGRATIONS_URL = 'https://integrations.bwipo.com';
const LEGACY_CRM_HOSTS = new Set([
  'frontend-front.v74knz.easypanel.host',
  'backend-backend.v74knz.easypanel.host',
  'api.bwipo.com',
  'bwipo.com',
  'www.bwipo.com',
]);

function resolveCrmUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  try {
    const host = new URL(trimmed).host.toLowerCase();
    if (LEGACY_CRM_HOSTS.has(host)) return CRM_INTEGRATIONS_URL;
  } catch {
    return trimmed;
  }
  return trimmed;
}

function getCrmConfig() {
  return {
    url: resolveCrmUrl(readEnv('CRM_DNA_API_URL')),
    token: readEnv('CRM_DNA_API_TOKEN'),
  };
}

export class CrmApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CrmApiError';
    this.status = status;
  }
}

export async function crmRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url: crmUrl, token } = getCrmConfig();

  if (!crmUrl || !token) {
    throw new CrmApiError('CRM_DNA_API_URL ou CRM_DNA_API_TOKEN não configurados.', 500);
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${crmUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const fromBody =
      data && typeof data === 'object'
        ? ('message' in data && typeof data.message === 'string' && data.message) ||
          ('error' in data && typeof data.error === 'string' && data.error) ||
          null
        : null;
    const message = fromBody || `CRM retornou ${response.status}.`;
    console.error('CRM DNA:', response.status, resolveCrmUrl(crmUrl), path, message);
    throw new CrmApiError(message, response.status);
  }

  return data as T;
}
