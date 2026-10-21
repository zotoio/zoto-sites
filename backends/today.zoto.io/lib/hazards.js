import axios from 'axios';
import { cached } from './cache.js';
import { distanceKm } from './geo-utils.js';

const TYPES = { EQ: 'Earthquake', TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire' };

async function fetchGdacsGlobal() {
  return cached(
    'gdacs:global',
    async () => {
      const to = new Date();
      const from = new Date(to.getTime() - 14 * 86400000);
      const { data } = await axios.get('https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH', {
        params: {
          eventlist: 'EQ;TC;FL;VO;DR;WF',
          alertlevel: 'green;orange;red',
          fromdate: from.toISOString().slice(0, 10),
          todate: to.toISOString().slice(0, 10),
        },
        timeout: 20000,
      });
      return { features: Array.isArray(data?.features) ? data.features : [] };
    },
    15 * 60 * 1000
  );
}

export function nearbyHazards(features, lat, lon, radiusKm = 1500) {
  return features
    .map((f) => {
      const p = f.properties || {};
      const [flon, flat] = f.geometry?.coordinates || [];
      if (!Number.isFinite(flat) || !Number.isFinite(flon)) return null;
      return {
        id: `${p.eventtype}-${p.eventid}`,
        type: TYPES[p.eventtype] || p.eventtype,
        name: p.name || TYPES[p.eventtype] || 'Event',
        alert: (p.alertlevel || '').toLowerCase(),
        country: p.country || '',
        from: p.fromdate,
        url: p.url?.report || '',
        distKm: Math.round(distanceKm(lat, lon, flat, flon)),
      };
    })
    .filter((e) => e && e.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 6);
}

export async function fetchHazards(lat, lon) {
  const { features, stale, staleSince } = await fetchGdacsGlobal();
  return {
    source: 'gdacs',
    attribution: 'GDACS (EC JRC / UN OCHA)',
    radiusKm: 1500,
    events: nearbyHazards(features, lat, lon),
    ...(stale ? { stale, staleSince } : {}),
  };
}
