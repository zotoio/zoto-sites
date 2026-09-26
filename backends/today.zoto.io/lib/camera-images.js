import axios from 'axios';

/** @type {Map<string, { url: string, attribution: string, source: string, expires: number }>} */
const keyRegistry = new Map();
/** @type {Map<string, { buffer: Buffer, contentType: string, expires: number }>} */
const bufferCache = new Map();

const ALLOWED_HOSTS = new Set([
  'webcams.qldtraffic.qld.gov.au',
  'images-dis.divas.cloud',
  'upload.wikimedia.org',
  'liveimageserver.trafficmanagementcenter.com',
  'cctv.wa.mainroads.wa.gov.au',
]);

const IMAGE_TTL_MS = 90000;
const KEY_TTL_MS = 600000;

export function allowImageHost(urlString) {
  try {
    const u = new URL(urlString);
    if (ALLOWED_HOSTS.has(u.hostname)) return true;
    if (u.hostname.endsWith('.windy.com')) return true;
    if (u.hostname.endsWith('.transport.nsw.gov.au')) return true;
    if (u.hostname.endsWith('.livetraffic.com')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {string} key
 * @param {string} url
 * @param {{ attribution: string, source: string }} meta
 */
export function registerCameraImageKey(key, url, meta) {
  if (!allowImageHost(url)) {
    throw new Error(`image host not allowlisted: ${url}`);
  }
  keyRegistry.set(key, {
    url,
    attribution: meta.attribution,
    source: meta.source,
    expires: Date.now() + KEY_TTL_MS,
  });
}

export function clearCameraImageCachesForTests() {
  keyRegistry.clear();
  bufferCache.clear();
}

const DEMO_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect fill="#1e293b" width="100%" height="100%"/>
  <text x="50%" y="45%" fill="#94a3b8" font-family="sans-serif" font-size="22" text-anchor="middle">Demo camera</text>
  <text x="50%" y="58%" fill="#64748b" font-family="sans-serif" font-size="14" text-anchor="middle">Placeholder — not a live feed</text>
</svg>`
);

/**
 * @param {string} key
 * @returns {Promise<{ buffer: Buffer, contentType: string, attribution?: string } | null>}
 */
export async function fetchProxiedCameraImage(key) {
  if (key.startsWith('demo-')) {
    return { buffer: DEMO_SVG, contentType: 'image/svg+xml', attribution: 'Demo placeholder' };
  }

  const reg = keyRegistry.get(key);
  if (!reg || reg.expires < Date.now()) {
    return null;
  }

  const cached = bufferCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { buffer: cached.buffer, contentType: cached.contentType, attribution: reg.attribution };
  }

  const { data, headers } = await axios.get(reg.url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxRedirects: 3,
    headers: { Accept: 'image/*,*/*;q=0.8', 'User-Agent': 'today.zoto.io/1.0 (camera proxy)' },
    validateStatus: (s) => s >= 200 && s < 400,
  });
  const contentType = headers['content-type']?.split(';')[0] || 'image/jpeg';
  const buffer = Buffer.from(data);
  bufferCache.set(key, { buffer, contentType, expires: Date.now() + IMAGE_TTL_MS });
  return { buffer, contentType, attribution: reg.attribution };
}

export function buildImageProxyKey(provider, externalId) {
  return `${provider}:${externalId}`;
}
