/**
 * Editorial news source selection (Hacker News via Algolia vs legacy The News API).
 */

export const NEWS_SOURCES = ['hn', 'thenewsapi'];

export function parseNewsSource(raw = process.env.NEWS_SOURCE) {
    const value = (raw || 'hn').trim().toLowerCase();
    if (!NEWS_SOURCES.includes(value)) {
        throw new Error(`Invalid NEWS_SOURCE "${raw}" (expected hn or thenewsapi)`);
    }
    return value;
}

export function assertNewsSourceEnv({ newsSource, newsApiKey }) {
    if (newsSource === 'thenewsapi' && !newsApiKey) {
        throw new Error('NEWS_API_KEY is required when NEWS_SOURCE=thenewsapi');
    }
}
