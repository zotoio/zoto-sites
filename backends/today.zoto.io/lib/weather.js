import axios from 'axios';
import { cached } from './cache.js';

export async function fetchWeather(lat, lon) {
  const key = `wx:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: {
          latitude: lat,
          longitude: lon,
          timezone: 'auto',
          current: 'temperature_2m,weather_code,precipitation',
          hourly: 'temperature_2m,precipitation_probability',
          daily: 'weather_code,temperature_2m_max,temperature_2m_min',
          forecast_days: 7,
          past_hours: 0,
          forecast_hours: 24,
        },
        timeout: 12000,
      });
      return {
        source: 'open-meteo',
        current: data.current,
        hourly: {
          time: (data.hourly?.time || []).slice(0, 24),
          temperature_2m: (data.hourly?.temperature_2m || []).slice(0, 24),
          precipitation_probability: (data.hourly?.precipitation_probability || []).slice(0, 24),
        },
        daily: {
          time: data.daily?.time || [],
          weather_code: data.daily?.weather_code || [],
          temperature_2m_max: data.daily?.temperature_2m_max || [],
          temperature_2m_min: data.daily?.temperature_2m_min || [],
        },
      };
    },
    300000
  );
}
