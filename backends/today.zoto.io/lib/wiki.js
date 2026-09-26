import axios from 'axios';
import { cached } from './cache.js';

export async function fetchWikiNearby(lat, lon) {
  const key = `wiki:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lon}`,
          gsradius: 10000,
          gslimit: 8,
          format: 'json',
          origin: '*',
        },
        timeout: 10000,
      });
      const items = (data?.query?.geosearch || []).map((p) => ({
        title: p.title,
        distanceM: Math.round(p.dist),
        pageid: p.pageid,
      }));
      return { source: 'wikipedia', places: items };
    },
    3600000
  );
}

export async function fetchOnThisDay(month, day) {
  const m = Number(month);
  const d = Number(day);
  const key = `otd:${m}:${d}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${m}/${d}`, {
        timeout: 10000,
        headers: { 'User-Agent': 'today.zoto.io/1.0 (zoto-sites; contact io@zoto.io)' },
      });
      const events = (data?.events || []).slice(0, 6).map((e) => ({ year: e.year, text: e.text }));
      return { source: 'wikipedia', month: m, day: d, events };
    },
    86400000
  );
}
