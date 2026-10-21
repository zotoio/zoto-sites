import * as cheerio from 'cheerio';
import { domainFromUrl, makeCandidate } from './normalize.js';

/**
 * Keyless search providers: DuckDuckGo HTML results, Google News RSS, Bing News RSS.
 * Modest request rate (sequential, delayed), a single attempt per query (no retries), tolerant parsing.
 */

export const KEYLESS_QUERIES = ['generative AI', 'OpenAI', 'LLM'];
const REQUEST_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_PER_QUERY = 15;
const MAX_BYTES = 1_000_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripTags(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded url>. */
export function unwrapDdgUrl(href) {
    if (!href) return '';
    try {
        const url = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com');
        const target = url.searchParams.get('uddg');
        if (target) return target;
        return /^https?:$/.test(url.protocol) && !/(^|\.)duckduckgo\.com$/.test(url.hostname) ? url.href : '';
    } catch {
        return '';
    }
}

export function parseDdgHtml(html, { max = MAX_PER_QUERY } = {}) {
    const out = [];
    try {
        const $ = cheerio.load(html || '');
        $('.result, .web-result').each((_, el) => {
            if (out.length >= max) return false;
            const link = $(el).find('a.result__a').first();
            const url = unwrapDdgUrl(link.attr('href'));
            const title = stripTags(link.text());
            if (!url || !title) return;
            out.push({
                title,
                url,
                snippet: stripTags($(el).find('.result__snippet').first().text()),
            });
        });
    } catch {
        return out;
    }
    return out;
}

/** Bing News RSS links are bing.com/news/apiclick.aspx?...&url=<real url>; unwrap to the publisher URL. */
export function unwrapBingClick(link) {
    try {
        const u = new URL(link);
        if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.includes('apiclick')) {
            const target = u.searchParams.get('url');
            if (target && /^https?:\/\//.test(target)) return target;
        }
    } catch {
        // fall through
    }
    return link;
}

export function parseNewsRss(xml, { max = MAX_PER_QUERY, unwrapSource = false } = {}) {
    const out = [];
    try {
        const $ = cheerio.load(xml || '', { xmlMode: true });
        $('item').each((_, el) => {
            if (out.length >= max) return false;
            const item = $(el);
            let title = stripTags(item.children('title').first().text());
            const link = unwrapBingClick((item.children('link').first().text() || '').trim());
            const sourceEl = item.children('source').first();
            let source = stripTags(sourceEl.text() || item.children('News\\:Source').first().text());
            const sourceUrl = sourceEl.attr('url') || '';
            if (unwrapSource && source && title.endsWith(` - ${source}`)) {
                title = title.slice(0, -(source.length + 3));
            }
            const pub = item.children('pubDate').first().text();
            const parsed = pub ? new Date(pub) : null;
            // Google News descriptions are an HTML list of headlines; keep text only.
            const snippet = stripTags(cheerio.load(item.children('description').first().text() || '').text());
            if (!title || !/^https?:\/\//.test(link)) return;
            out.push({
                title,
                url: link,
                source: sourceUrl ? domainFromUrl(sourceUrl) : source || domainFromUrl(link),
                published_at: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
                snippet: snippet === title ? '' : snippet,
            });
        });
    } catch {
        return out;
    }
    return out;
}

async function fetchText(fetchImpl, url, accept) {
    const response = await fetchImpl(url, {
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`http_${response.status}`);
    }
    if (response.status === 202) {
        // DuckDuckGo answers 202 with an anomaly/bot-challenge page; do not try to get around it.
        throw new Error('http_202_bot_challenge');
    }
    const text = await response.text();
    return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

function makeKeylessProvider({ name, buildUrl, accept, parse, delayMs = REQUEST_DELAY_MS }) {
    return {
        name,
        isAvailable: () => ({ ok: true }),
        async fetchCandidates({ asOfDate = null, fetchImpl = fetch, log = () => {}, queries = KEYLESS_QUERIES, sleepFn = sleep }) {
            if (asOfDate) {
                log(JSON.stringify({ event: 'news_provider_skipped', provider: name, reason: 'live_only' }));
                return { candidates: [], requests: 0 };
            }
            const candidates = [];
            let requests = 0;
            for (let i = 0; i < queries.length; i++) {
                if (i > 0) await sleepFn(delayMs);
                requests += 1;
                try {
                    const text = await fetchText(fetchImpl, buildUrl(queries[i]), accept);
                    for (const item of parse(text)) {
                        candidates.push(makeCandidate(name, { ...item, extra: { query: queries[i] } }));
                    }
                } catch (error) {
                    // Single attempt per query: log and move on (no retry hammering).
                    log(JSON.stringify({ event: 'news_provider_query_failed', provider: name, query: queries[i], error: error.message }));
                }
            }
            return { candidates, requests };
        },
    };
}

export const ddgProvider = makeKeylessProvider({
    name: 'ddg',
    accept: 'text/html,application/xhtml+xml',
    // df=d => results from the past day
    buildUrl: (q) => `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: `${q} news`, df: 'd' })}`,
    parse: (html) => parseDdgHtml(html),
});

export const gnewsProvider = makeKeylessProvider({
    name: 'gnews',
    accept: 'application/rss+xml,application/xml,text/xml',
    buildUrl: (q) =>
        `https://news.google.com/rss/search?${new URLSearchParams({ q: `${q} when:1d`, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`,
    parse: (xml) => parseNewsRss(xml, { unwrapSource: true }),
});

export const bingnewsProvider = makeKeylessProvider({
    name: 'bingnews',
    accept: 'application/rss+xml,application/xml,text/xml',
    buildUrl: (q) => `https://www.bing.com/news/search?${new URLSearchParams({ q, format: 'rss' })}`,
    parse: (xml) => parseNewsRss(xml),
});

/**
 * The New Stack blog RSS: one request per run, 8 s timeout, no retries, live only, keyless.
 * Items carry title/link/pubDate/description; description HTML is stripped to text.
 */
export const THENEWSTACK_FEED_URL = 'https://thenewstack.io/blog/feed/';

export const thenewstackProvider = {
    name: 'thenewstack',
    isAvailable: () => ({ ok: true }),
    async fetchCandidates({ asOfDate = null, fetchImpl = fetch, log = () => {} }) {
        if (asOfDate) {
            log(JSON.stringify({ event: 'news_provider_skipped', provider: 'thenewstack', reason: 'live_only' }));
            return { candidates: [], requests: 0 };
        }
        try {
            const xml = await fetchText(fetchImpl, THENEWSTACK_FEED_URL, 'application/rss+xml,application/xml,text/xml');
            const items = parseNewsRss(xml, { max: 50 });
            return {
                candidates: items.map((item) => makeCandidate('thenewstack', { ...item, source: 'thenewstack.io' })),
                requests: 1,
            };
        } catch (error) {
            log(JSON.stringify({ event: 'news_provider_query_failed', provider: 'thenewstack', error: error.message }));
            return { candidates: [], requests: 1 };
        }
    },
};
