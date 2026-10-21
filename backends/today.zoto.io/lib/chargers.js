import axios from 'axios';
import { cached } from './cache.js';
import { OVERPASS_URL } from './http.js';

export async function fetchEvChargers(lat, lon, radiusM = 5000) {
  const key = `ev:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  return cached(
    key,
    async () => {
      const query = `
[out:json][timeout:25];
(
  node(around:${radiusM},${lat},${lon})["amenity"="charging_station"];
  node(around:${radiusM},${lat},${lon})["fuel"];
);
out body 20;
`;
      const { data } = await axios.post(
        OVERPASS_URL,
        `data=${encodeURIComponent(query)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 }
      );
      const stops = (data?.elements || [])
        .filter((el) => el.type === 'node')
        .map((el) => ({
          name: el.tags?.name || el.tags?.operator || 'Charging / fuel',
          amenity: el.tags?.amenity || el.tags?.fuel || 'station',
          lat: el.lat,
          lon: el.lon,
        }));
      return { source: 'overpass', stations: stops };
    },
    600000
  );
}
