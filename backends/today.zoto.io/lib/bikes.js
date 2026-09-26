import axios from 'axios';
import { cached } from './cache.js';

export async function fetchNearbyBikes(lat, lon) {
  const key = `bikes:${lat.toFixed(1)}:${lon.toFixed(1)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://api.citybikes.io/v2/networks?fields=id,name,location`, {
        timeout: 10000,
      });
      const networks = (data || [])
        .map((n) => {
          const dLat = (n.location?.latitude || 0) - lat;
          const dLon = (n.location?.longitude || 0) - lon;
          const dist = Math.sqrt(dLat * dLat + dLon * dLon) * 111;
          return { id: n.id, name: n.name, distKm: dist };
        })
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, 3);
      const stations = [];
      for (const net of networks) {
        const detail = await axios.get(`https://api.citybikes.io/v2/networks/${net.id}`, { timeout: 8000 });
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
      return { source: 'citybikes', stations: stations.slice(0, 8) };
    },
    120000
  );
}
