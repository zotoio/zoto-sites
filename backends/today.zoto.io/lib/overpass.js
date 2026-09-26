import axios from 'axios';
import { cached } from './cache.js';

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseLines(tags) {
  const lines = [];
  if (tags.ref) lines.push(...String(tags.ref).split(/[;,/]/).map((s) => s.trim()).filter(Boolean));
  if (tags['route_ref']) lines.push(...String(tags['route_ref']).split(/[;,/]/).map((s) => s.trim()).filter(Boolean));
  if (tags.network) lines.push(String(tags.network));
  return [...new Set(lines)].slice(0, 8);
}

function modesFromTags(tags) {
  const modes = new Set();
  if (tags.railway) modes.add(tags.railway === 'station' ? 'train' : tags.railway);
  if (tags.highway === 'bus_stop') modes.add('bus');
  if (tags.amenity === 'ferry_terminal') modes.add('ferry');
  if (tags.aerialway) modes.add('aerialway');
  if (tags.tram === 'yes') modes.add('tram');
  if (tags.subway === 'yes') modes.add('metro');
  if (tags.public_transport) modes.add(String(tags.public_transport).replace(/_/g, ' '));
  if (tags.railway === 'tram_stop') modes.add('tram');
  if (modes.size === 0) modes.add('transit');
  return [...modes];
}

export async function fetchNearbyTransit(lat, lon, radiusM = 900) {
  const key = `transit:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusM}`;
  return cached(
    key,
    async () => {
      const query = `
[out:json][timeout:25];
(
  node(around:${radiusM},${lat},${lon})["highway"="bus_stop"];
  node(around:${radiusM},${lat},${lon})["public_transport"~"platform|stop_position"];
  node(around:${radiusM},${lat},${lon})["railway"~"station|halt|tram_stop|subway_entrance"];
  node(around:${radiusM},${lat},${lon})["amenity"="ferry_terminal"];
);
out body 40;
`;
      const { data } = await axios.post(
        'https://overpass-api.de/api/interpreter',
        `data=${encodeURIComponent(query)}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 25000,
        }
      );
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      const stops = elements
        .filter((el) => el.type === 'node' && Number.isFinite(el.lat) && Number.isFinite(el.lon))
        .map((el) => {
          const tags = el.tags || {};
          const name = tags.name || tags['name:en'] || tags.ref || 'Transit stop';
          return {
            id: String(el.id),
            name,
            lat: el.lat,
            lon: el.lon,
            distanceM: Math.round(haversineM(lat, lon, el.lat, el.lon)),
            modes: modesFromTags(tags),
            lines: parseLines(tags),
          };
        })
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 12);

      return { source: 'overpass', stops };
    },
    600000
  );
}
