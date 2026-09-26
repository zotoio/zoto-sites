import axios from 'axios';
import { cached } from './cache.js';
import { fetchArticlePreview, HN_NEWS_PLACEHOLDER } from './article-meta.js';

const NEWS_TTL_MS = 15 * 60 * 1000;
const ALGOLIA = 'https://hn.algolia.com/api/v1';

const TOPIC_QUERIES = {
  sports: 'sports olympics football',
  tech: 'programming software startup ai',
  business: 'business economy finance startup',
};

function hnDiscussionUrl(objectId) {
  return `https://news.ycombinator.com/item?id=${objectId}`;
}

function mapHit(hit) {
  const hnId = String(hit.objectID);
  const externalUrl = hit.url && String(hit.url).startsWith('http') ? hit.url : null;
  const url = externalUrl || hnDiscussionUrl(hnId);
  return {
    hn_id: hnId,
    title: hit.title || 'Untitled',
    url,
    external_url: externalUrl,
    points: Number(hit.points) || 0,
    num_comments: Number(hit.num_comments) || 0,
    hn_url: hnDiscussionUrl(hnId),
    published_at: hit.created_at || new Date().toISOString(),
    source: 'Hacker News',
    image_url: '',
    description: '',
  };
}

async function enrichArticles(articles) {
  return Promise.all(
    articles.map(async (article) => {
      if (article.external_url) {
        const preview = await fetchArticlePreview(article.external_url);
        return {
          ...article,
          image_url: preview.image_url,
          description: preview.description,
        };
      }
      return {
        ...article,
        image_url: HN_NEWS_PLACEHOLDER,
        description: '',
      };
    })
  );
}

async function fetchFrontPageHits() {
  const { data } = await axios.get(`${ALGOLIA}/search`, {
    params: { tags: 'front_page', hitsPerPage: 10 },
    timeout: 12000,
    headers: { Accept: 'application/json' },
  });
  return data?.hits || [];
}

async function fetchTopicHits(topic) {
  if (topic === 'tech') {
    return fetchFrontPageHits();
  }
  const q = TOPIC_QUERIES[topic] || topic;
  const since = Math.floor(Date.now() / 1000) - 86400;
  const { data } = await axios.get(`${ALGOLIA}/search`, {
    params: {
      query: q,
      tags: 'story',
      numericFilters: `created_at_i>${since}`,
      hitsPerPage: 20,
    },
    timeout: 12000,
    headers: { Accept: 'application/json' },
  });
  let hits = data?.hits || [];
  if (!hits.length) {
    const relaxed = await axios.get(`${ALGOLIA}/search`, {
      params: { query: q, tags: 'story', hitsPerPage: 15 },
      timeout: 12000,
    });
    hits = relaxed.data?.hits || [];
  }
  if (!hits.length) {
    return fetchFrontPageHits();
  }
  return hits.sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0)).slice(0, 10);
}

/**
 * Top stories from Hacker News (Algolia API, no key).
 * @param {object} [options]
 * @param {string} [options.topic] — `top` uses front_page; sports|tech|business search last 24h
 */
export async function fetchHackerNewsTop(options = {}) {
  const topic = (options.topic || 'top').toLowerCase();
  const cacheKey = `hn:${topic}`;

  return cached(
    cacheKey,
    async () => {
      const hits =
        topic === 'top' || topic === 'news' ? await fetchFrontPageHits() : await fetchTopicHits(topic);
      const mapped = hits.slice(0, 10).map(mapHit);
      const articles = await enrichArticles(mapped);
      return {
        source: 'hackernews',
        topic,
        attribution: 'Stories via Hacker News · search by Algolia',
        articles,
      };
    },
    NEWS_TTL_MS
  );
}

/** @deprecated use fetchHackerNewsTop */
export async function fetchTopNews(_key, _locale, options = {}) {
  return fetchHackerNewsTop(options);
}
