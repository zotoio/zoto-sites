import axios from 'axios';
import { cached } from './cache.js';

export async function fetchHolidays(countryCode, year) {
  const cc = (countryCode || 'US').toUpperCase().slice(0, 2);
  const y = year || new Date().getFullYear();
  const key = `hol:${cc}:${y}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`, {
        timeout: 10000,
      });
      return { source: 'nager.date', country: cc, year: y, holidays: Array.isArray(data) ? data : [] };
    },
    86400000
  );
}
