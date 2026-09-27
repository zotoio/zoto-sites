import axios from 'axios';
import { cached } from './cache.js';

const WEATHER_MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE_CACHE_HOST = 'https://tilecache.rainviewer.com';
const CACHE_TTL_MS = 90_000;

/**
 * RainViewer frame `path` already includes `/v2/radar/...` — do not prefix again.
 * @param {string} framePath
 */
export function buildRadarTileUrlTemplate(framePath) {
  const path = String(framePath || '').trim();
  if (!path) return null;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${TILE_CACHE_HOST}${normalized}/256/{z}/{x}/{y}/2/1_1.png`;
}

/**
 * @param {import('axios').AxiosStatic} [http]
 */
export async function fetchRainViewerMetadata(http = axios) {
  return cached(
    'rainviewer:weather-maps',
    async () => {
      const { data } = await http.get(WEATHER_MAPS_URL, {
        timeout: 12_000,
        headers: { Accept: 'application/json' },
      });
      return data;
    },
    CACHE_TTL_MS
  );
}

/**
 * @param {Record<string, unknown>} metadata
 */
export function pickLatestRadarFrame(metadata) {
  const past = metadata?.radar?.past;
  if (!Array.isArray(past) || !past.length) return null;
  return past[past.length - 1];
}

/**
 * @param {import('axios').AxiosStatic} [http]
 */
export async function getRadarPayload(http = axios) {
  try {
    const metadata = await fetchRainViewerMetadata(http);
    const frame = pickLatestRadarFrame(metadata);
    const template = frame?.path ? buildRadarTileUrlTemplate(frame.path) : null;
    if (!template) {
      return { source: 'demo', demo: true, reason: 'no_frames' };
    }
    return {
      source: 'rainviewer',
      demo: false,
      tileUrlTemplate: template,
      framePath: frame.path,
      frameTime: frame.time ?? null,
    };
  } catch {
    return { source: 'demo', demo: true, reason: 'upstream_error' };
  }
}
