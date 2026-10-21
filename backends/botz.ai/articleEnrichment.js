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
    } = config;

    if (!articleUrl || !articleUrl.startsWith('http')) {
        return null;
    }

    const response = await fetchImpl(articleUrl, {
        headers: buildBrowserHeaders({ userAgent, referer }),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        return { skipped: `http_${response.status}` };
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
