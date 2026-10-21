/**
 * Shared candidate normalization + merge/dedupe for multi-provider news sources.
 *
 * Normalized candidate shape (superset of what storySelection/articleEnrichment already use):
 *   { title, url, source, published_at, snippet, description, points, num_comments,
 *     engagement, provider, providers, _source }
 */

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|cmpid|igshid|ncid|oc)$/i;

export function normalizeUrl(raw) {
    if (!raw || typeof raw !== 'string') {
        return null;
    }
    let url;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    if (!/^https?:$/.test(url.protocol)) {
        return null;
    }
    url.protocol = 'https:';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^(www|m|amp)\./, '');
    url.port = '';
    const kept = [...url.searchParams.entries()]
        .filter(([key]) => !TRACKING_PARAMS.test(key))
        .sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [key, value] of kept) {
        url.searchParams.append(key, value);
    }
    let out = url.href;
    if (url.pathname !== '/' || url.search) {
        out = out.replace(/\/(?=(\?|$))/, '');
    } else {
        out = out.replace(/\/$/, '');
    }
    return out;
}

export function domainFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export function engagementOf(candidate) {
    if (typeof candidate.engagement === 'number') {
        return candidate.engagement;
    }
    return (Number(candidate.points) || 0) * 2 + (Number(candidate.num_comments) || 0);
}

/** Build a normalized candidate; fills defaults so every provider returns the same shape. */
export function makeCandidate(provider, fields) {
    const url = fields.url || '';
    const snippet = (fields.snippet || '').trim();
    const candidate = {
        title: (fields.title || '').trim(),
        url,
        source: fields.source || domainFromUrl(url),
        published_at: fields.published_at || null,
        snippet,
        description: fields.description ?? snippet,
        points: Number(fields.points) || 0,
        num_comments: Number(fields.num_comments) || 0,
        provider,
        providers: [provider],
        _source: provider,
        ...(fields.extra || {}),
    };
    candidate.engagement = engagementOf(candidate);
    return candidate;
}

/**
 * Merge candidate lists (in provider priority order) and dedupe by normalized URL.
 * The first occurrence wins; later duplicates only contribute missing fields, higher
 * engagement and their provider name (candidate.providers).
 */
export function mergeCandidates(lists) {
    const byKey = new Map();
    const order = [];
    for (const list of lists) {
        for (const candidate of list || []) {
            if (!candidate?.title || !candidate?.url) {
                continue;
            }
            const key = normalizeUrl(candidate.url) || candidate.url.toLowerCase();
            const existing = byKey.get(key);
            if (!existing) {
                const copy = { ...candidate, providers: [...(candidate.providers || [candidate.provider])] };
                byKey.set(key, copy);
                order.push(key);
                continue;
            }
            for (const name of candidate.providers || [candidate.provider]) {
                if (name && !existing.providers.includes(name)) {
                    existing.providers.push(name);
                }
            }
            for (const field of ['snippet', 'description', 'published_at', 'source', 'hn_url', 'hn_object_id']) {
                if (!existing[field] && candidate[field]) {
                    existing[field] = candidate[field];
                }
            }
            existing.points = Math.max(existing.points || 0, candidate.points || 0);
            existing.num_comments = Math.max(existing.num_comments || 0, candidate.num_comments || 0);
            existing.engagement = Math.max(engagementOf(existing), engagementOf(candidate));
        }
    }
    return order.map((key) => byKey.get(key));
}

/** Run one upstream request; on failure tag the error with err.requests = 1 (the request was attempted and counts against the budget). */
export async function attempt(fn) {
    try {
        return await fn();
    } catch (error) {
        if (error && typeof error === 'object' && typeof error.requests !== 'number') error.requests = 1;
        throw error;
    }
}
