import axios from 'axios';
import { cached } from './cache.js';
import { distanceKm } from './geo-utils.js';

const MAX_NETWORK_KM = 60;

export async function fetchNearbyBikes(lat, lon) {
  const key = `bikes:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://api.citybik.es/v2/networks?fields=id,name,location`, {
        timeout: 10000,
      });
      const networks = (Array.isArray(data) ? data : data?.networks || [])
        .map((n) => {
          const nLat = n.location?.latitude;
          const nLon = n.location?.longitude;
          if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) return null;
          return { id: n.id, name: n.name, distKm: distanceKm(lat, lon, nLat, nLon) };
        })
        .filter((n) => n && n.distKm <= MAX_NETWORK_KM)
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 3);
      const stations = [];
      for (const net of networks) {
        const detail = await axios.get(`https://api.citybik.es/v2/networks/${net.id}`, { timeout: 8000 });
        const locs = detail.data?.network?.stations || [];
        for (const s of locs.slice(0, 5)) {
          stations.push({
            name: s.name,
            freeBikes: s.free_bikes,
            emptySlots: s.empty_slots,
            network: net.name,
          });
        }
      }
      return {
        source: 'citybikes',
        stations: stations.slice(0, 8),
        ...(networks.length ? {} : { message: `No bike-share network within ${MAX_NETWORK_KM} km` }),
      };
    },
    120000
  );
}
