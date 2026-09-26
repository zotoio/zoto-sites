import axios from 'axios';
import { cached } from './cache.js';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchEarthquakesNear(lat, lon, radiusKm = 500) {
  const key = `eq:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
        { timeout: 12000 }
      );
      const feats = (data?.features || [])
        .map((f) => {
          const [flon, flat] = f.geometry?.coordinates || [];
          const dist = haversineKm(lat, lon, flat, flon);
          return {
            mag: f.properties?.mag,
            place: f.properties?.place,
            time: f.properties?.time,
            distKm: Math.round(dist),
          };
        })
        .filter((e) => e.distKm <= radiusKm && e.mag >= 2.5)
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 8);
      return { source: 'usgs', earthquakes: feats };
    },
    300000
  );
}
