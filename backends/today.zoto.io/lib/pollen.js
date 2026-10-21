import axios from 'axios';
import { cached } from './cache.js';

/** Open-Meteo (CAMS) pollen — grains/m³. Coverage is Europe only; elsewhere values are null. */
export function mapPollen(current = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const maxOf = (...vals) => {
    const xs = vals.map(num).filter((v) => v !== null);
    return xs.length ? Math.max(...xs) : null;
  };
  const grass = num(current.grass_pollen);
  const tree = maxOf(current.alder_pollen, current.birch_pollen, current.olive_pollen);
  const weed = maxOf(current.mugwort_pollen, current.ragweed_pollen);
  const available = [grass, tree, weed].some((v) => v !== null);
  // Scale grains/m³ to the widget's 0–5 meter (≈ CAMS bands: 0, 1–10, 10–50, 50–100, 100–500, 500+).
  const level = (v) => {
    if (v === null) return null;
    if (v <= 0) return 0;
    if (v < 10) return 1;
    if (v < 50) return 2;
    if (v < 100) return 3;
    if (v < 500) return 4;
    return 5;
  };
  return {
    available,
    grains: { grass, tree, weed },
    grass: level(grass),
    tree: level(tree),
    weed: level(weed),
    label: available ? 'Open-Meteo / CAMS pollen (grains/m³)' : 'Pollen data unavailable for this region',
  };
}

export async function fetchPollen(lat, lon) {
  return cached(
    `pollen:${lat.toFixed(2)}:${lon.toFixed(2)}`,
    async () => {
      const { data } = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
        params: {
          latitude: lat,
          longitude: lon,
          current: 'alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
        },
        timeout: 12000,
      });
      return { source: 'open-meteo-pollen', ...mapPollen(data.current || {}) };
    },
    60 * 60 * 1000
  );
}
