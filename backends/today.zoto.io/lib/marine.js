import axios from 'axios';
import { cached } from './cache.js';

export async function fetchMarine(lat, lon) {
  const key = `marine:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
        params: {
          latitude: lat,
          longitude: lon,
          hourly: 'wave_height,wave_direction,sea_surface_temperature',
          forecast_hours: 24,
        },
        timeout: 12000,
      });
      return {
        source: 'open-meteo-marine',
        hourly: {
          time: (data.hourly?.time || []).slice(0, 24),
          wave_height: (data.hourly?.wave_height || []).slice(0, 24),
          sea_surface_temperature: (data.hourly?.sea_surface_temperature || []).slice(0, 24),
        },
      };
    },
    600000
  );
}
