import axios from 'axios';
import { cached } from './cache.js';

export async function fetchIssNow() {
  return cached(
    'iss:now',
    async () => {
      const { data } = await axios.get('https://api.wheretheiss.at/v1/satellites/25544', { timeout: 8000 });
      return {
        source: 'wheretheiss.at',
        lat: data.latitude,
        lon: data.longitude,
        altitude: data.altitude,
        velocity: data.velocity,
        visibility: data.visibility,
        timestamp: data.timestamp * 1000,
      };
    },
    30000
  );
}
