import axios from 'axios';
import { cached } from './cache.js';

const NEWS_TTL_MS = 15 * 60 * 1000;

function normalizeArticle(raw) {
  return {
    title: raw.title || 'Untitled',
    url: raw.url || raw.link || '#',
    image_url: raw.image_url || raw.image || '',
    source: raw.source || raw.source_name || 'News',
    published_at: raw.published_at || raw.published || new Date().toISOString(),
  };
}

export async function fetchTopNews(newsApiKey, locale) {
  const loc = (locale || 'us').toLowerCase().slice(0, 2);
  const cacheKey = `news:${loc}`;

  return cached(
    cacheKey,
    async () => {
      const { data } = await axios.get('https://api.thenewsapi.com/v1/news/top', {
        params: {
          api_token: newsApiKey,
          locale: loc,
          language: 'en',
          limit: 10,
        },
        timeout: 12000,
      });
      const rows = Array.isArray(data?.data) ? data.data : [];
      return {
        source: 'thenewsapi',
        locale: loc,
        articles: rows.slice(0, 10).map(normalizeArticle),
      };
    },
    NEWS_TTL_MS
  );
}
