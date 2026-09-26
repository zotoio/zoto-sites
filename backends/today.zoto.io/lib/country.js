import axios from 'axios';
import { cached } from './cache.js';

export async function fetchCountryFacts(code) {
  const cc = (code || 'us').toLowerCase();
  const key = `country:${cc}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://restcountries.com/v3.1/alpha/${cc}`, { timeout: 10000 });
      const c = Array.isArray(data) ? data[0] : data;
      if (!c) throw new Error('not found');
      return {
        source: 'restcountries',
        name: c.name?.common,
        capital: (c.capital || []).join(', '),
        population: c.population,
        region: c.region,
        languages: Object.values(c.languages || {}).join(', '),
        currencies: Object.keys(c.currencies || {}).join(', '),
        flag: c.flag,
      };
    },
    86400000
  );
}
