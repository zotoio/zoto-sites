import axios from 'axios';
import { cached } from './cache.js';
import { buildImageProxyKey, registerCameraImageKey } from './camera-images.js';
import { distanceKm } from './geo-utils.js';

const { WINDY_WEBCAMS_KEY } = process.env;

function mapWindyWebcam(w, lat, lon) {
  const loc = w.location || {};
  const wLat = loc.latitude ?? w.latitude;
  const wLon = loc.longitude ?? w.longitude;
  const distKm = Number.isFinite(wLat) && Number.isFinite(wLon) ? distanceKm(lat, lon, wLat, wLon) : null;
  const preview =
    w.images?.current?.preview ||
    w.images?.daylight?.preview ||
    w.images?.sizes?.preview?.url ||
    w.urls?.detail ||
    '';
  const imageKey = buildImageProxyKey('windy', w.webcamId || w.id);
  if (preview && preview.startsWith('http')) {
    registerCameraImageKey(imageKey, preview, {
      attribution: '© Windy Webcams',
      source: 'windy',
    });
  }
  return {
    id: String(w.webcamId || w.id),
    name: w.title || w.name || 'Webcam',
    distKm: distKm != null ? Math.round(distKm) : null,
    lat: wLat,
    lon: wLon,
    imageKey: preview ? imageKey : null,
    updatedAt: new Date().toISOString(),
    attribution: '© Windy Webcams',
    provider: 'windy',
  };
}

async function fetchWindyNearby(lat, lon, radiusKm = 50) {
  if (!WINDY_WEBCAMS_KEY) return [];
  const { data } = await axios.get('https://api.windy.com/webcams/api/v3/webcams', {
    params: {
      nearby: `${lat},${lon},${Math.min(radiusKm, 250)}`,
      limit: 20,
      include: 'images,location',
      lang: 'en',
    },
    headers: { 'x-windy-api-key': WINDY_WEBCAMS_KEY, Accept: 'application/json' },
    timeout: 12000,
  });
  const list = data?.webcams || data?.result?.webcams || data?.data || [];
  return list.map((w) => mapWindyWebcam(w, lat, lon));
}

async function fetchCommonsWebcamsNear(lat, lon) {
  const { data } = await axios.get('https://commons.wikimedia.org/w/api.php', {
    params: {
      action: 'query',
      list: 'geosearch',
      gscoord: `${lat}|${lon}`,
      gsradius: 50000,
      gslimit: 15,
      gsrsearch: 'webcam',
      format: 'json',
      origin: '*',
    },
    timeout: 10000,
  });
  const pages = data?.query?.geosearch || [];
  const cameras = [];
  for (const p of pages.slice(0, 8)) {
    const info = await axios.get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        pageids: p.pageid,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata|timestamp',
        iiurlwidth: 480,
        format: 'json',
        origin: '*',
      },
      timeout: 8000,
    });
    const page = info.data?.query?.pages?.[p.pageid];
    const ii = page?.imageinfo?.[0];
    if (!ii?.thumburl) continue;
    const distKm = Math.round(p.dist);
    const imageKey = buildImageProxyKey('commons-wc', p.pageid);
    registerCameraImageKey(imageKey, ii.thumburl, {
      attribution: '© Wikimedia Commons (static image, not a live stream)',
      source: 'wikimedia-commons',
    });
    cameras.push({
      id: String(p.pageid),
      name: p.title.replace(/^File:/, ''),
      distKm,
      lat: p.lat,
      lon: p.lon,
      imageKey,
      updatedAt: ii.timestamp || new Date().toISOString(),
      attribution: '© Wikimedia Commons',
      provider: 'wikimedia-commons',
      live: false,
    });
  }
  return cameras;
}

/**
 * @param {number} lat
 * @param {number} lon
 */
export async function fetchNearbyWebcams(lat, lon) {
  const key = `webcams:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const configured = {
        windy: Boolean(WINDY_WEBCAMS_KEY),
      };
      const cameras = [];
      let source = 'live';

      if (WINDY_WEBCAMS_KEY) {
        try {
          cameras.push(...(await fetchWindyNearby(lat, lon)));
        } catch {
          /* windy failure falls through */
        }
      }

      if (cameras.length < 6) {
        try {
          cameras.push(...(await fetchCommonsWebcamsNear(lat, lon)));
        } catch {
          /* optional keyless supplement */
        }
      }

      cameras.sort((a, b) => (a.distKm ?? 9999) - (b.distKm ?? 9999));

      if (cameras.length === 0) {
        return {
          source: 'demo',
          configured,
          message: WINDY_WEBCAMS_KEY
            ? 'No webcams found nearby — showing demo placeholders.'
            : 'Windy Webcams not configured (set WINDY_WEBCAMS_KEY). Showing demo placeholders.',
          cameras: [],
        };
      }

      if (!WINDY_WEBCAMS_KEY && cameras.every((c) => c.provider === 'wikimedia-commons')) {
        source = 'wikimedia-commons';
      }

      return {
        source,
        configured,
        message: WINDY_WEBCAMS_KEY
          ? null
          : 'Windy Webcams not configured — set WINDY_WEBCAMS_KEY for live global webcams. Showing keyless Wikimedia matches where available.',
        cameras: cameras.slice(0, 24),
        attribution: 'Windy Webcams · Wikimedia Commons',
      };
    },
    300000
  );
}
