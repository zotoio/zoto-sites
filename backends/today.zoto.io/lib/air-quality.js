import axios from 'axios';
import { cached } from './cache.js';

export async function fetchAirQuality(lat, lon) {
  const key = `aq:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
        params: {
          latitude: lat,
          longitude: lon,
          timezone: 'auto',
          current: 'us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
          hourly: 'uv_index,uv_index_clear_sky',
        },
        timeout: 12000,
      });
      return {
        source: 'open-meteo-aq',
        timezone: data.timezone,
        current: data.current,
        hourly: {
          time: (data.hourly?.time || []).slice(0, 24),
          uv_index: (data.hourly?.uv_index || []).slice(0, 24),
        },
      };
    },
    600000
  );
}
