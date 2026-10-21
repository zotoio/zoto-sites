import axios from 'axios';
import { cached } from './cache.js';

/** Find local highs/lows in an hourly sea-level series. */
export function findTideExtremes(times = [], heights = []) {
  const out = [];
  for (let i = 1; i < heights.length - 1; i += 1) {
    const [a, b, c] = [heights[i - 1], heights[i], heights[i + 1]];
    if (![a, b, c].every((v) => typeof v === 'number')) continue;
    if (b > a && b >= c) out.push({ time: times[i], type: 'High', height: b });
    else if (b < a && b <= c) out.push({ time: times[i], type: 'Low', height: b });
  }
  return out;
}

export async function fetchTides(lat, lon) {
  return cached(
    `tides:${lat.toFixed(2)}:${lon.toFixed(2)}`,
    async () => {
      const { data } = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
        params: { latitude: lat, longitude: lon, hourly: 'sea_level_height_msl', forecast_hours: 36, timezone: 'auto' },
        timeout: 12000,
      });
      const time = data.hourly?.time || [];
      const height = data.hourly?.sea_level_height_msl || [];
      const hasData = height.some((v) => typeof v === 'number');
      return {
        source: hasData ? 'open-meteo-marine' : 'unavailable',
        timezone: data.timezone,
        hourly: { time, sea_level_height_msl: height },
        extremes: hasData ? findTideExtremes(time, height).slice(0, 6) : [],
        message: hasData ? undefined : 'No modelled sea level for this location (inland?)',
        note: 'Modelled sea level (approx.) — not for navigation',
      };
    },
    60 * 60 * 1000
  );
}
