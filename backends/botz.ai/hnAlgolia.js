/**
 * Hacker News story discovery via the public Algolia API (no API key).
 */

export const HN_ALGOLIA_SEARCH_URL = 'https://hn.algolia.com/api/v1/search';
export const HN_ALGOLIA_SEARCH_BY_DATE_URL = 'https://hn.algolia.com/api/v1/search_by_date';

export function utcDayUnixRange(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error(`Invalid UTC date: ${dateStr}`);
    }
    const start = Math.floor(Date.parse(`${dateStr}T00:00:00.000Z`) / 1000);
    const end = start + 86400 - 1;
    return { start, end };
}

export function liveWindowUnixRange(nowMs = Date.now()) {
    const end = Math.floor(nowMs / 1000);
    const start = end - 86400;
    return { start, end };
}

export function buildHnAlgoliaParams({
    asOfDate = null,
    minPoints = 20,
    page = 0,
    hitsPerPage = 100,
    query = '',
}) {
    const range = asOfDate ? utcDayUnixRange(asOfDate) : liveWindowUnixRange();
    const numericFilters = [`points>=${minPoints}`, `created_at_i>=${range.start}`, `created_at_i<=${range.end}`];
    return {
        query,
        tags: 'story',
        numericFilters: numericFilters.join(','),
        page,
        hitsPerPage,
    };
}

export function describeHnAlgoliaRequest(params, { asOfDate = null } = {}) {
    const base = asOfDate ? HN_ALGOLIA_SEARCH_BY_DATE_URL : HN_ALGOLIA_SEARCH_URL;
    const query = new URLSearchParams(params).toString();
    return { url: base, query, method: 'GET' };
}

export function hnDiscussionUrl(objectId) {
    return `https://news.ycombinator.com/item?id=${objectId}`;
}

/**
 * @param {object} hit Algolia hit
 * @returns {object} normalized candidate (pre-enrichment)
 */
export function mapAlgoliaHitToCandidate(hit) {
    const objectId = hit.objectID ?? hit.story_id;
    const url = hit.url || (objectId ? hnDiscussionUrl(objectId) : '');
    let source = '';
    try {
        if (url && url.startsWith('http')) {
            source = new URL(url).hostname.replace(/^www\./, '');
        }
    } catch {
        source = '';
    }
    return {
        title: hit.title || '',
        url,
        hn_url: objectId ? hnDiscussionUrl(objectId) : null,
        hn_object_id: objectId,
        points: Number(hit.points) || 0,
        num_comments: Number(hit.num_comments) || 0,
        published_at: hit.created_at_i ? new Date(hit.created_at_i * 1000).toISOString() : null,
        source,
        description: '',
        snippet: '',
        _source: 'hn',
    };
}

export function mergeAlgoliaPages(existingHits, newHits) {
    const seen = new Set(existingHits.map((h) => h.objectID));
    const merged = [...existingHits];
    for (const hit of newHits) {
        if (!seen.has(hit.objectID)) {
            seen.add(hit.objectID);
            merged.push(hit);
        }
    }
    return merged;
}
