import axios from 'axios';
import { cached } from './cache.js';

export async function fetchCommonsNearby(lat, lon) {
  const key = `commons:${lat.toFixed(2)}:${lon.toFixed(2)}`;
  return cached(
    key,
    async () => {
      const { data } = await axios.get('https://commons.wikimedia.org/w/api.php', {
        params: {
          action: 'query',
          list: 'geosearch',
          gscoord: `${lat}|${lon}`,
          gsradius: 10000,
          gslimit: 5,
          format: 'json',
          origin: '*',
        },
        timeout: 10000,
      });
      const pages = data?.query?.geosearch || [];
      const photos = await Promise.all(
        pages.slice(0, 3).map(async (p) => {
          const info = await axios.get('https://commons.wikimedia.org/w/api.php', {
            params: {
              action: 'query',
              pageids: p.pageid,
              prop: 'imageinfo',
              iiprop: 'url|extmetadata',
              iiurlwidth: 400,
              format: 'json',
              origin: '*',
            },
            timeout: 8000,
          });
          const page = info.data?.query?.pages?.[p.pageid];
          const ii = page?.imageinfo?.[0];
          return {
            title: p.title,
            thumb: ii?.thumburl || '',
            url: ii?.descriptionurl || '',
            artist: ii?.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '') || 'Wikimedia Commons',
          };
        })
      );
      return { source: 'wikimedia-commons', photos };
    },
    3600000
  );
}
