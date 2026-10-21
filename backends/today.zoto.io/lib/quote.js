import axios from 'axios';
import { cached } from './cache.js';

/** ZenQuotes "quote of the day" — keyless, limited to a few req/30 s, so cache for hours. */
export async function fetchQuoteOfDay() {
  return cached(
    'quote:today',
    async () => {
      const { data } = await axios.get('https://zenquotes.io/api/today', { timeout: 10000 });
      const row = Array.isArray(data) ? data[0] : null;
      if (!row?.q || /too many requests/i.test(row.q)) throw new Error('quote unavailable');
      return { source: 'zenquotes', quote: row.q, author: row.a || '', attribution: 'Quotes by ZenQuotes.io' };
    },
    6 * 60 * 60 * 1000,
    { maxStaleMs: 48 * 60 * 60 * 1000 }
  );
}
