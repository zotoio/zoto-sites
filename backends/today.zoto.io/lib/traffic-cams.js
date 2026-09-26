import axios from 'axios';
import { cached } from './cache.js';
import { buildImageProxyKey, registerCameraImageKey } from './camera-images.js';
import { distanceKm, inBoundingBox, NSW_BBOX, QLD_BBOX } from './geo-utils.js';

const { TRANSPORT_NSW_API_KEY, QLDTRAFFIC_API_KEY } = process.env;

function toCameraRow({
  id,
  provider,
  name,
  lat,
  lon,
  userLat,
  userLon,
  imageUrl,
  attribution,
  view,
}) {
  const distKm =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? Math.round(distanceKm(userLat, userLon, lat, lon))
      : null;
  const imageKey = buildImageProxyKey(provider, id);
  if (imageUrl?.startsWith('http')) {
    registerCameraImageKey(imageKey, imageUrl, { attribution, source: provider });
  }
  return {
    id: String(id),
    provider,
    name,
    view: view || '',
    distKm,
    lat,
    lon,
    imageKey,
    updatedAt: new Date().toISOString(),
    attribution,
  };
}

async function fetchNswCameras(userLat, userLon) {
  if (!TRANSPORT_NSW_API_KEY) return { cameras: [], configured: false };
  const { data } = await axios.get('https://api.transport.nsw.gov.au/v1/live/cameras', {
    headers: {
      Accept: 'application/json',
      Authorization: `apikey ${TRANSPORT_NSW_API_KEY}`,
    },
    timeout: 20000,
  });
  const features = data?.features || [];
  const cameras = features
    .map((f) => {
      const [lon, lat] = f.geometry?.coordinates || [];
      const p = f.properties || {};
      let imageUrl = p.href || p.imageUrl || '';
      if (imageUrl && !imageUrl.match(/\.(jpe?g|png)(\?|$)/i) && f.id) {
        imageUrl = `https://www.livetraffic.com/traffic-cameras/camera_image/${f.id}`;
      }
      return toCameraRow({
        id: f.id,
        provider: 'nsw',
        name: p.title || 'NSW traffic camera',
        lat,
        lon,
        userLat,
        userLon,
        imageUrl,
        attribution: '© Transport for NSW / Live Traffic',
        view: p.view,
      });
    })
    .filter((c) => c.imageKey);
  return { cameras, configured: true, provider: 'nsw' };
}

async function fetchQldArcGisCameras(userLat, userLon) {
  const { data } = await axios.get(
    'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/StateRoadInformation/MapServer/4/query',
    {
      params: {
        where: '1=1',
        outFields: 'camera_id,description,image_url',
        returnGeometry: true,
        outSR: 4326,
        f: 'json',
        resultRecordCount: 2000,
      },
      timeout: 25000,
    }
  );
  const cameras = (data.features || [])
    .map((f) => {
      const a = f.attributes || {};
      return toCameraRow({
        id: a.camera_id,
        provider: 'qld',
        name: a.description || `QLD camera ${a.camera_id}`,
        lat: f.geometry?.y,
        lon: f.geometry?.x,
        userLat,
        userLon,
        imageUrl: a.image_url,
        attribution: '© Queensland TMR / QLDTraffic',
      });
    })
    .filter((c) => c.imageKey);
  return { cameras, provider: 'qld' };
}

async function fetchFlorida511Cameras(userLat, userLon) {
  const { data } = await axios.get(
    'https://services.arcgis.com/3wFbqsFPLeKqOlIK/arcgis/rest/services/FL511_Traffic_Cameras/FeatureServer/0/query',
    {
      params: {
        where: '1=1',
        outFields: 'ID,DESCRIPT,IMAGE,LATITUDE,LONGITUDE,TIMESTAMP',
        returnGeometry: true,
        f: 'json',
        resultRecordCount: 2000,
      },
      timeout: 25000,
    }
  );
  const cameras = (data.features || [])
    .map((f) => {
      const a = f.attributes || {};
      const lat = a.LATITUDE ?? f.geometry?.y;
      const lon = a.LONGITUDE ?? f.geometry?.x;
      return toCameraRow({
        id: a.ID,
        provider: 'fl511',
        name: a.DESCRIPT || `FL camera ${a.ID}`,
        lat,
        lon,
        userLat,
        userLon,
        imageUrl: a.IMAGE,
        attribution: '© Florida 511 / FDOT',
        view: a.HIGHWAY ? `${a.HIGHWAY} ${a.DIRECTION || ''}`.trim() : '',
      });
    })
    .filter((c) => c.imageKey);
  return { cameras, provider: 'fl511' };
}

/**
 * @param {number} lat
 * @param {number} lon
 * @param {string} [countryCode]
 */
export async function fetchNearbyTrafficCameras(lat, lon, countryCode = '') {
  const cc = countryCode.toLowerCase();
  const cacheKey = `traffic-cams:${lat.toFixed(2)}:${lon.toFixed(2)}:${cc}`;
  return cached(
    cacheKey,
    async () => {
      const configured = {
        nsw: Boolean(TRANSPORT_NSW_API_KEY),
        qldtrafficApi: Boolean(QLDTRAFFIC_API_KEY),
      };
      const providersUsed = [];
      const messages = [];
      let all = [];

      const nearNsw = inBoundingBox(lat, lon, NSW_BBOX);
      const nearQld = inBoundingBox(lat, lon, QLD_BBOX);

      if (cc === 'au' || nearNsw || nearQld) {
        if (nearNsw || (cc === 'au' && inBoundingBox(lat, lon, { minLat: -38, maxLat: -28, minLon: 140, maxLon: 154 }))) {
          if (TRANSPORT_NSW_API_KEY) {
            try {
              const nsw = await fetchNswCameras(lat, lon);
              if (nsw.cameras.length) {
                all.push(...nsw.cameras);
                providersUsed.push('Transport for NSW Live Traffic');
              }
            } catch {
              messages.push('NSW Live Traffic cameras temporarily unavailable.');
            }
          } else if (nearNsw) {
            messages.push('NSW traffic cameras require TRANSPORT_NSW_API_KEY (TfNSW Open Data).');
          }
        }
        if (nearQld || cc === 'au') {
          try {
            const qld = await fetchQldArcGisCameras(lat, lon);
            if (qld.cameras.length) {
              all.push(...qld.cameras);
              providersUsed.push('Queensland TMR (open ArcGIS)');
            }
          } catch {
            messages.push('Queensland camera feed temporarily unavailable.');
          }
        }
      }

      if (all.length < 8 && (cc === 'us' || cc !== 'au')) {
        try {
          const fl = await fetchFlorida511Cameras(lat, lon);
          if (fl.cameras.length) {
            all.push(...fl.cameras);
            providersUsed.push('Florida FL511');
          }
        } catch {
          /* optional US supplement */
        }
      }

      all = all
        .filter((c) => Number.isFinite(c.distKm))
        .sort((a, b) => a.distKm - b.distKm);

      for (const limitKm of [120, 250, 400, 800]) {
        const subset = all.filter((c) => c.distKm <= limitKm);
        if (subset.length >= 4) {
          all = subset;
          break;
        }
      }

      if (all.length === 0) {
        return {
          source: 'demo',
          configured,
          messages,
          providers: [],
          cameras: [],
        };
      }

      return {
        source: 'live',
        configured,
        messages,
        providers: providersUsed,
        cameras: all.slice(0, 36),
        attribution: providersUsed.join(' · '),
      };
    },
    120000
  );
}
