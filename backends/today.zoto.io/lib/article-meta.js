import axios from 'axios';

const MAX_BYTES = 256 * 1024;
export const ARTICLE_FETCH_UA = 'today.zoto.io/1.0 (link preview; +https://today.zoto.io)';

/** Same-origin placeholder (orange HN tile) — never hotlink Google favicons from the client. */
export const HN_NEWS_PLACEHOLDER = '/assets/hn-news-placeholder.svg';

/**
 * @param {string} html
 * @param {string} property
 */
export function extractMetaContent(html, property) {
  const esc = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/**
 * @param {string | undefined} href
 * @param {string} baseUrl
 */
export function absolutizeUrl(href, baseUrl) {
  if (!href) return '';
  try {
    if (href.startsWith('//')) return `https:${href}`;
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * @param {string} html
 * @param {string} pageUrl
 */
export function parseOpenGraphFromHtml(html, pageUrl) {
  const slice = String(html).slice(0, MAX_BYTES);
  const image =
    extractMetaContent(slice, 'og:image') ||
    extractMetaContent(slice, 'twitter:image') ||
    extractMetaContent(slice, 'twitter:image:src');
  const description =
    extractMetaContent(slice, 'og:description') ||
    extractMetaContent(slice, 'description');
  const image_url = absolutizeUrl(image, pageUrl) || HN_NEWS_PLACEHOLDER;
  return {
    image_url,
    description: description.slice(0, 280),
  };
}

/**
 * @param {string} pageUrl
 */
export async function fetchArticlePreview(pageUrl) {
  if (!pageUrl || !pageUrl.startsWith('http')) {
    return { image_url: HN_NEWS_PLACEHOLDER, description: '' };
  }
  try {
    const { data } = await axios.get(pageUrl, {
      timeout: 8000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      responseType: 'text',
      headers: {
        'User-Agent': ARTICLE_FETCH_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return parseOpenGraphFromHtml(data, pageUrl);
  } catch {
    return { image_url: HN_NEWS_PLACEHOLDER, description: '' };
  }
}
