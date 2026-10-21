import { routeHostKey, getDefaultRouteStore } from './articleFetchRouteStore.js';
export const DEFAULT_ARTICLE_FETCH_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export const DEFAULT_ARTICLE_FETCH_REFERER = 'https://news.ycombinator.com/';

/**
 * Browser-like navigation headers for outbound article fetches (Chrome 141 on Windows).
 * Accept-Encoding only lists encodings Node's built-in fetch (undici) decodes.
 */
export function buildBrowserHeaders({ userAgent = DEFAULT_ARTICLE_FETCH_UA, referer = DEFAULT_ARTICLE_FETCH_REFERER } = {}) {
    return {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': '"Chromium";v="141", "Not?A_Brand";v="8", "Google Chrome";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        Referer: referer,
        Connection: 'keep-alive',
    };
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 1_500_000;

export function domainFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

export async function readResponseWithByteCap(response, maxBytes) {
    const reader = response.body?.getReader?.();
    if (!reader) {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > maxBytes) {
            throw new Error(`response exceeds ${maxBytes} bytes`);
        }
        return Buffer.from(buf).toString('utf8');
    }
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            throw new Error(`response exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function metaContent(html, names) {
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(
            `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
            'i'
        );
        const match = re.exec(html);
        if (match?.[1]) {
            return match[1].trim();
        }
        const reReverse = new RegExp(
            `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`,
            'i'
        );
        const match2 = reReverse.exec(html);
        if (match2?.[1]) {
            return match2[1].trim();
        }
    }
    return '';
}

function stripHtmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractOpenGraphAndExcerpt(html, { maxExcerptChars = 500 } = {}) {
    const ogTitle = metaContent(html, ['og:title']);
    const ogDescription =
        metaContent(html, ['og:description']) || metaContent(html, ['description']);
    const ogImage = metaContent(html, ['og:image']);

    const articleMatch = /<article[\s\S]*?<\/article>/i.exec(html);
    const rawText = stripHtmlToText(articleMatch ? articleMatch[0] : html);
    const excerpt = rawText.slice(0, maxExcerptChars);

    return {
        og_title: ogTitle,
        og_description: ogDescription,
        og_image: ogImage,
        excerpt,
    };
}

export function parseArticleFetchProxyMode(raw) {
    const value = (raw || 'fallback').trim().toLowerCase();
    return value === 'always' ? 'always' : 'fallback';
}

/** A response is only usable when it is ok AND carries no cf-mitigated header (any value, any status). */
export function isUsableArticleResponse(response) {
    return Boolean(response.ok) && !response.headers?.get?.('cf-mitigated');
}

/** Retry via proxy only on 403, 429 or a Cloudflare challenge (cf-mitigated header). */
export function shouldRetryViaProxy(response) {
    return (
        response.status === 403 ||
        response.status === 429 ||
        Boolean(response.headers?.get?.('cf-mitigated'))
    );
}

export const DEFAULT_429_RETRIES = 3;
export const DEFAULT_429_BASE_MS = 1000;
export const DEFAULT_429_MAX_MS = 30000;

function envInt(raw, fallback) {
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Delay before 429 retry `attempt` (0-based): min(base * 2^attempt, max), or a numeric
 * Retry-After (seconds) clamped to max. Up to 20% jitter is added, never exceeding max.
 */
export function compute429DelayMs({ attempt, baseMs, maxMs, retryAfter = null, random = Math.random }) {
    const ra = retryAfter == null ? NaN : Number(String(retryAfter).trim());
    const raw = Number.isFinite(ra) && ra >= 0 ? ra * 1000 : baseMs * 2 ** attempt;
    const capped = Math.min(raw, maxMs);
    return Math.min(Math.round(capped * (1 + 0.2 * random())), maxMs);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const proxyAgents = new Map();

/** Lazily builds an undici ProxyAgent (undici is only imported when a proxy is actually used). */
async function defaultGetProxyDispatcher(proxyUrl) {
    if (!proxyAgents.has(proxyUrl)) {
        const { ProxyAgent } = await import('undici');
        proxyAgents.set(proxyUrl, new ProxyAgent(proxyUrl));
    }
    return proxyAgents.get(proxyUrl);
}

/**
 * @param {string} articleUrl
 */
export async function fetchLinkedArticleMetadata(articleUrl, config = {}) {
    const {
        fetchImpl = fetch,
        userAgent = DEFAULT_ARTICLE_FETCH_UA,
        referer = DEFAULT_ARTICLE_FETCH_REFERER,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxBytes = DEFAULT_MAX_BYTES,
        env = process.env,
        log = () => {},
        getProxyDispatcher = defaultGetProxyDispatcher,
        sleep = defaultSleep,
        random = Math.random,
    } = config;
    const retries429 = envInt(env.ARTICLE_FETCH_429_RETRIES, DEFAULT_429_RETRIES);
    const base429 = envInt(env.ARTICLE_FETCH_429_BASE_MS, DEFAULT_429_BASE_MS);
    const max429 = envInt(env.ARTICLE_FETCH_429_MAX_MS, DEFAULT_429_MAX_MS);

    if (!articleUrl || !articleUrl.startsWith('http')) {
        return null;
    }

    const proxyUrl = (env.ARTICLE_FETCH_PROXY || '').trim();
    const proxyMode = parseArticleFetchProxyMode(env.ARTICLE_FETCH_PROXY_MODE);

    const doFetch = async (dispatcher) =>
        fetchImpl(articleUrl, {
            headers: buildBrowserHeaders({ userAgent, referer }),
            redirect: 'follow',
            signal: AbortSignal.timeout(timeoutMs),
            ...(dispatcher ? { dispatcher } : {}),
        });

    // Exponential backoff on HTTP 429 (article page fetches only).
    const fetchWithBackoff = async (routeName, dispatcher) => {
        let response = await doFetch(dispatcher);
        for (let attempt = 0; attempt < retries429 && response.status === 429; attempt += 1) {
            const delayMs = compute429DelayMs({
                attempt,
                baseMs: base429,
                maxMs: max429,
                retryAfter: response.headers?.get?.('retry-after'),
                random,
            });
            log(
                `article_fetch_retry route=${routeName} attempt=${attempt + 1} delay_ms=${delayMs} status=429 host=${domainFromUrl(articleUrl)}`,
            );
            await sleep(delayMs);
            response = await doFetch(dispatcher);
        }
        return response;
    };

    // The proxy applies to this article PAGE fetch only (never HN/Algolia/OpenAI/news API/search/Jev).
    let response;
    let route = 'direct';
    if (proxyUrl && proxyMode === 'always') {
        route = 'proxy';
        response = await fetchWithBackoff('proxy', await getProxyDispatcher(proxyUrl));
    } else if (proxyUrl) {
        // Fallback mode: host-level route memory (article page fetches only).
        const hostKey = routeHostKey(articleUrl);
        const store = hostKey ? (config.routeStore || getDefaultRouteStore(env, log)) : null;
        const remembered = store ? store.get(hostKey) : null;
        const remember = (r) => {
            if (store) store.set(hostKey, r);
        };
        const viaProxy = async () => fetchWithBackoff('proxy', await getProxyDispatcher(proxyUrl));
        const reasonOf = (res) => (res.headers?.get?.('cf-mitigated') ? 'cf_challenge' : `http_${res.status}`);
        const chosen = remembered === 'proxy' ? 'proxy' : 'direct';
        log(`article_fetch_route host=${hostKey || domainFromUrl(articleUrl)} remembered=${remembered || 'none'} chosen=${chosen}`);
        if (chosen === 'proxy') {
            route = 'proxy(remembered)';
            response = await viaProxy();
            if (shouldRetryViaProxy(response)) {
                const reason = reasonOf(response);
                response = await fetchWithBackoff('direct', null); // direct once, with 429 backoff
                if (isUsableArticleResponse(response)) {
                    route = `proxy(${reason})->direct`;
                    remember('direct');
                } else {
                    route = `proxy(${reason})->direct(failed)`;
                    // The remembered proxy route is not good any more: forget it rather than keep it.
                    if (store?.delete) store.delete(hostKey);
                    else remember('direct');
                }
            }
        } else {
            response = await fetchWithBackoff('direct', null);
            if (!shouldRetryViaProxy(response)) {
                if (isUsableArticleResponse(response)) remember('direct');
            } else {
                const reason = reasonOf(response);
                route = `direct->proxy(${reason})`;
                response = await viaProxy(); // single retry, no loop
                if (isUsableArticleResponse(response)) remember('proxy');
            }
        }
    } else {
        response = await fetchWithBackoff('direct', null);
    }
    log(`article_fetch: route=${route} status=${response.status} host=${domainFromUrl(articleUrl)}`);
    if (!isUsableArticleResponse(response)) {
        return { skipped: response.headers?.get?.('cf-mitigated') ? 'cf_challenge' : `http_${response.status}` };
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return { skipped: 'not_html' };
    }
    const html = await readResponseWithByteCap(response, maxBytes);
    const parsed = extractOpenGraphAndExcerpt(html);
    return {
        ...parsed,
        source_domain: domainFromUrl(articleUrl),
    };
}

export async function fetchTopHnCommentContext(storyId, config = {}) {
    const { fetchImpl = fetch, timeoutMs = 8000 } = config;
    if (!storyId) return '';
    const itemUrl = `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`;
    const response = await fetchImpl(itemUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return '';
    const story = await response.json();
    const kids = story?.kids;
    if (!Array.isArray(kids) || kids.length === 0) return '';
    const commentId = kids[0];
    const commentRes = await fetchImpl(`https://hacker-news.firebaseio.com/v0/item/${commentId}.json`, {
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!commentRes.ok) return '';
    const comment = await commentRes.json();
    const text = (comment?.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.slice(0, 400);
}

/**
 * Enrich an HN candidate with linked-page metadata and optional HN comment fallback.
 */
export async function enrichHnCandidate(candidate, deps = {}) {
    const {
        fetchArticle = fetchLinkedArticleMetadata,
        fetchComment = fetchTopHnCommentContext,
        log = () => {},
    } = deps;

    const enriched = { ...candidate };
    const linkUrl = candidate.url && candidate.url.startsWith('http') ? candidate.url : null;

    if (linkUrl) {
        try {
            const referer = candidate.hn_object_id
                ? `https://news.ycombinator.com/item?id=${candidate.hn_object_id}`
                : undefined;
            const meta = await fetchArticle(linkUrl, referer ? { referer, ...deps } : deps);
            if (meta && !meta.skipped) {
                if (meta.og_title) enriched.title = meta.og_title;
                enriched.description = meta.og_description || meta.excerpt || '';
                enriched.snippet = meta.excerpt || meta.og_description || '';
                if (meta.og_image) enriched.og_image = meta.og_image;
                if (meta.source_domain) enriched.source = meta.source_domain;
            } else if (meta?.skipped) {
                log(`article_enrichment: skipped ${linkUrl} (${meta.skipped})`);
            }
        } catch (error) {
            log(`article_enrichment: failed ${linkUrl} (${error.message})`);
        }
    }

    if (!enriched.description && !enriched.snippet) {
        const comment = await fetchComment(candidate.hn_object_id, deps).catch(() => '');
        if (comment) {
            enriched.description = `HN discussion context: ${comment}`;
            enriched.snippet = comment;
        }
    }

    if (!enriched.source && linkUrl) {
        enriched.source = domainFromUrl(linkUrl);
    }
    if (!enriched.source) {
        enriched.source = 'news.ycombinator.com';
    }

    return enriched;
}
