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

export async function fetchTopNews(newsApiKey, locale, options = {}) {
  const loc = (locale || 'us').toLowerCase().slice(0, 2);
  const topic = (options.topic || 'top').toLowerCase();
  const cacheKey = `news:${loc}:${topic}`;

  const topicSearch = {
    sports: 'sports|football|basketball|olympics',
    tech: 'technology|software|ai|startup',
    business: 'business|economy|markets|finance',
  };

  return cached(
    cacheKey,
    async () => {
      const params = {
        api_token: newsApiKey,
        locale: loc,
        language: 'en',
        limit: 10,
      };
      if (topicSearch[topic]) {
        params.search = topicSearch[topic];
      }
      const { data } = await axios.get('https://api.thenewsapi.com/v1/news/top', {
        params,
        timeout: 12000,
      });
      const rows = Array.isArray(data?.data) ? data.data : [];
      return {
        source: 'thenewsapi',
        locale: loc,
        topic,
        articles: rows.slice(0, 10).map(normalizeArticle),
      };
    },
    NEWS_TTL_MS
  );
}
