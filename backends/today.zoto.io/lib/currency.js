import axios from 'axios';
import { cached } from './cache.js';

export async function fetchExchangeRate(from, to) {
  const f = (from || 'USD').toUpperCase();
  const t = (to || 'EUR').toUpperCase();
  const key = `fx:${f}:${t}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://api.frankfurter.app/latest?from=${f}&to=${t}`, {
        timeout: 8000,
      });
      return {
        source: 'frankfurter',
        base: data.base,
        date: data.date,
        rate: data.rates?.[t],
        target: t,
      };
    },
    3600000
  );
}
