import assert from 'node:assert/strict';
import test from 'node:test';
import {
    fetchCandidatesFromProviders,
    isMultiProviderConfig,
    mergeCandidates,
    normalizeUrl,
    parseNewsProviders,
} from './newsProviders/index.js';
import { hnProvider } from './newsProviders/hn.js';
import { thenewsapiProvider } from './newsProviders/thenewsapi.js';
import { bingnewsProvider, ddgProvider, gnewsProvider, parseDdgHtml, parseNewsRss, unwrapDdgUrl } from './newsProviders/keyless.js';
import { fetchQualifyingStoryFromProviders } from './multiProviderEditorialFetch.js';

const noSleep = async () => {};

test('parseNewsProviders: unset => null (legacy hn default), list parsed, deduped, validated', () => {
    assert.equal(parseNewsProviders(undefined), null);
    assert.equal(parseNewsProviders('  '), null);
    assert.deepEqual(parseNewsProviders('hn, TheNewsApi,ddg,hn'), ['hn', 'thenewsapi', 'ddg']);
    assert.throws(() => parseNewsProviders('hn,bogus'), /Invalid NEWS_PROVIDERS entry "bogus"/);
    assert.throws(() => parseNewsProviders(' , '), /empty/);
    assert.equal(isMultiProviderConfig(null), false);
    assert.equal(isMultiProviderConfig(['hn']), false);
    assert.equal(isMultiProviderConfig(['hn', 'ddg']), true);
    assert.equal(isMultiProviderConfig(['thenewsapi']), true);
});

test('normalizeUrl strips tracking, www, hash, trailing slash, scheme and sorts params', () => {
    assert.equal(
        normalizeUrl('http://www.Example.com/a/b/?utm_source=x&b=2&a=1#frag'),
        'https://example.com/a/b?a=1&b=2'
    );
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
    assert.equal(normalizeUrl('ftp://example.com/x'), null);
    assert.equal(normalizeUrl('not a url'), null);
});

test('hn provider maps Algolia hits to normalized candidates (behaviour unchanged)', async () => {
    const calls = [];
    const httpGet = async (req) => {
        calls.push(req);
        return {
            data: {
                hits: [
                    { objectID: '1', title: 'Claude does things', url: 'https://www.a.com/x', points: 50, num_comments: 10, created_at_i: 1760000000 },
                    { objectID: '2', title: 'Show HN: my garden', url: 'https://g.com', points: 30, num_comments: 1, created_at_i: 1760000000 },
                ],
            },
        };
    };
    const { candidates, requests } = await hnProvider.fetchCandidates({ httpGet, env: { HN_MIN_POINTS: '33' } });
    assert.equal(requests, 1);
    assert.equal(calls[0].url, 'https://hn.algolia.com/api/v1/search');
    assert.match(calls[0].params.numericFilters, /points>=33/);
    assert.equal(candidates.length, 1);
    const c = candidates[0];
    assert.equal(c.provider, 'hn');
    assert.equal(c.source, 'a.com');
    assert.equal(c.points, 50);
    assert.equal(c.engagement, 110);
    assert.equal(c.hn_url, 'https://news.ycombinator.com/item?id=1');
    assert.ok(c.published_at);
});

test('thenewsapi provider: skipped without NEWS_API_KEY, requests api.thenewsapi.com with api_token', async () => {
    assert.deepEqual(thenewsapiProvider.isAvailable({}), { ok: false, reason: 'missing NEWS_API_KEY' });
    assert.equal(thenewsapiProvider.isAvailable({ NEWS_API_KEY: 'k' }).ok, true);

    let req;
    const httpGet = async (r) => {
        req = r;
        return {
            data: {
                data: [{ uuid: 'u1', title: 'OpenAI ships', url: 'https://n.com/1', source: 'n.com', published_at: '2026-10-20T00:00:00Z', snippet: 'snip', description: 'desc' }],
            },
        };
    };
    const { candidates } = await thenewsapiProvider.fetchCandidates({ httpGet, env: { NEWS_API_KEY: 'k' } });
    assert.equal(req.url, 'https://api.thenewsapi.com/v1/news/top');
    assert.equal(req.params.api_token, 'k');
    assert.equal(req.params.categories, 'tech');
    assert.match(req.params.search, /OpenAI/);
    assert.equal(candidates[0].provider, 'thenewsapi');
    assert.equal(candidates[0].snippet, 'snip');
    assert.equal(candidates[0].source, 'n.com');
});

const DDG_HTML = `<html><body>
<div class="result results_links web-result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.com%2Fllm%3Futm_source%3Dddg&amp;rut=abc">New <b>LLM</b> released</a>
<a class="result__snippet">A <b>generative AI</b> model arrives.</a></div>
<div class="result"><a class="result__a" href="">broken</a></div>
<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.org%2Fopenai">OpenAI news</a></div>
</body></html>`;

test('ddg parse: unwraps redirect links, strips tags, ignores broken rows', () => {
    assert.equal(unwrapDdgUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com%2Fa'), 'https://x.com/a');
    assert.equal(unwrapDdgUrl(''), '');
    const items = parseDdgHtml(DDG_HTML);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'New LLM released');
    assert.equal(items[0].snippet, 'A generative AI model arrives.');
    assert.equal(items[0].url, 'https://www.example.com/llm?utm_source=ddg');
    assert.deepEqual(parseDdgHtml('<<<garbage'), []);
    assert.deepEqual(parseDdgHtml(undefined), []);
});

const GNEWS_RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Gemini gets agents - The Verge</title><link>https://news.google.com/rss/articles/CBM123</link>
<pubDate>Tue, 20 Oct 2026 05:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Gemini gets agents&lt;/a&gt;</description><source url="https://www.theverge.com">The Verge</source></item>
<item><title></title><link>https://x.com</link></item>
</channel></rss>`;

test('RSS parse: title/source/date, drops items without title or link, tolerant of junk', () => {
    const items = parseNewsRss(GNEWS_RSS, { unwrapSource: true });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'Gemini gets agents');
    assert.equal(items[0].source, 'theverge.com');
    assert.equal(items[0].published_at, '2026-10-20T05:00:00.000Z');
    assert.deepEqual(parseNewsRss('not xml at all'), []);
});

function mockFetch(routes, seen = []) {
    return async (url, opts) => {
        seen.push({ url, opts });
        for (const [needle, body, status = 200] of routes) {
            if (url.includes(needle)) {
                return new Response(body, { status });
            }
        }
        return new Response('', { status: 404 });
    };
}

test('ddg provider: one GET per query, sequential delays, no retries on failure', async () => {
    const seen = [];
    let sleeps = 0;
    const fetchImpl = mockFetch([['html.duckduckgo.com/html/', DDG_HTML]], seen);
    const { candidates, requests } = await ddgProvider.fetchCandidates({
        fetchImpl,
        queries: ['generative AI', 'OpenAI'],
        sleepFn: async () => { sleeps += 1; },
    });
    assert.equal(requests, 2);
    assert.equal(seen.length, 2);
    assert.equal(sleeps, 1);
    assert.match(seen[0].url, /q=generative\+AI\+news/);
    assert.match(seen[0].url, /df=d/);
    assert.equal(candidates[0].provider, 'ddg');

    const failing = [];
    const logs = [];
    const out = await ddgProvider.fetchCandidates({
        fetchImpl: mockFetch([['duckduckgo', 'blocked', 429]], failing),
        queries: ['a', 'b', 'c'],
        sleepFn: noSleep,
        log: (m) => logs.push(m),
    });
    assert.equal(failing.length, 3, 'exactly one attempt per query');
    assert.equal(out.candidates.length, 0);
    assert.match(logs[0], /http_429/);
});

test('bing apiclick links are unwrapped; ddg 202 challenge logs and yields nothing', async () => {
    const rss = '<rss><channel><item><title>T</title><link>http://www.bing.com/news/apiclick.aspx?ref=x&amp;url=https%3a%2f%2fnote.com%2fa%3fhl%3den&amp;c=1</link><News:Source>note</News:Source></item></channel></rss>';
    const items = parseNewsRss(rss);
    assert.equal(items[0].url, 'https://note.com/a?hl=en');
    assert.equal(items[0].source, 'note');
    const logs = [];
    const out = await ddgProvider.fetchCandidates({
        fetchImpl: async () => new Response('anomaly', { status: 202 }),
        queries: ['x'],
        log: (m) => logs.push(m),
    });
    assert.equal(out.candidates.length, 0);
    assert.match(logs[0], /http_202_bot_challenge/);
});

test('gnews and bingnews providers use RSS endpoints; historical dates are skipped', async () => {
    const seen = [];
    const g = await gnewsProvider.fetchCandidates({
        fetchImpl: mockFetch([['news.google.com/rss/search', GNEWS_RSS]], seen),
        queries: ['LLM'],
        sleepFn: noSleep,
    });
    assert.match(seen[0].url, /news\.google\.com\/rss\/search\?q=LLM\+when%3A1d/);
    assert.equal(g.candidates[0].provider, 'gnews');
    const b = await bingnewsProvider.fetchCandidates({
        fetchImpl: mockFetch([['bing.com/news/search', GNEWS_RSS]], seen),
        queries: ['LLM'],
        sleepFn: noSleep,
    });
    assert.match(seen[1].url, /bing\.com\/news\/search\?q=LLM&format=rss/);
    assert.equal(b.candidates[0].provider, 'bingnews');

    const logs = [];
    const hist = await ddgProvider.fetchCandidates({ asOfDate: '2026-06-10', fetchImpl: async () => { throw new Error('no'); }, log: (m) => logs.push(m) });
    assert.equal(hist.requests, 0);
    assert.match(logs[0], /live_only/);
});

test('mergeCandidates dedupes by normalized URL, keeps first, merges providers and engagement', () => {
    const a = { title: 'A', url: 'https://www.x.com/p?utm_source=hn', provider: 'hn', providers: ['hn'], points: 40, num_comments: 5, snippet: '' };
    const b = { title: 'A copy', url: 'http://x.com/p/', provider: 'ddg', providers: ['ddg'], snippet: 'from ddg', published_at: '2026-10-20T00:00:00Z' };
    const c = { title: 'Other', url: 'https://y.com/q', provider: 'ddg', providers: ['ddg'] };
    const d = { title: '', url: 'https://z.com' };
    const merged = mergeCandidates([[a], [b, c, d]]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].title, 'A');
    assert.deepEqual(merged[0].providers, ['hn', 'ddg']);
    assert.equal(merged[0].snippet, 'from ddg');
    assert.equal(merged[0].points, 40);
    assert.equal(merged[0].published_at, '2026-10-20T00:00:00Z');
});

test('fetchCandidatesFromProviders: skips missing-key provider with a log, survives a failing provider, news_source meaningful', async () => {
    const logs = [];
    const registry = {
        hn: { name: 'hn', isAvailable: () => ({ ok: true }), fetchCandidates: async () => ({ candidates: [{ title: 'T1', url: 'https://a.com/1', provider: 'hn', providers: ['hn'] }], requests: 1 }) },
        thenewsapi: { name: 'thenewsapi', isAvailable: () => ({ ok: false, reason: 'missing NEWS_API_KEY' }), fetchCandidates: async () => { throw new Error('should not run'); } },
        ddg: { name: 'ddg', isAvailable: () => ({ ok: true }), fetchCandidates: async () => { throw new Error('boom'); } },
        gnews: { name: 'gnews', isAvailable: () => ({ ok: true }), fetchCandidates: async () => ({ candidates: [{ title: 'T1b', url: 'https://www.a.com/1/', provider: 'gnews', providers: ['gnews'] }, { title: 'T2', url: 'https://b.com/2', provider: 'gnews', providers: ['gnews'] }], requests: 3 }) },
    };
    const out = await fetchCandidatesFromProviders({ names: ['hn', 'thenewsapi', 'ddg', 'gnews'], registry, log: (m) => logs.push(m) });
    assert.equal(out.candidates.length, 2);
    assert.equal(out.requests, 4);
    assert.equal(out.newsSource, 'hn+gnews');
    assert.ok(logs.some((l) => /news_provider_skipped.*thenewsapi.*missing NEWS_API_KEY/.test(l)));
    assert.ok(logs.some((l) => /news_provider_failed.*ddg.*boom/.test(l)));
    assert.ok(logs.some((l) => /"news_source":"hn\+gnews"/.test(l)));
});

test('fetchQualifyingStoryFromProviders runs the unchanged selection pipeline over merged candidates', async () => {
    const httpGet = async () => ({ data: { hits: [{ objectID: '9', title: 'Gardening tips', url: 'https://g.com/x', points: 90, num_comments: 3, created_at_i: 1760000000 }] } });
    const fetchImpl = mockFetch([['html.duckduckgo.com', DDG_HTML]]);
    const scored = [];
    const result = await fetchQualifyingStoryFromProviders({
        newsProviders: ['hn', 'ddg'],
        httpGet,
        fetchImpl,
        env: {},
        jevClassifier: null,
        enrichDeps: { fetchArticle: async () => null, fetchComment: async () => '' },
        scoreArticle: async (a) => {
            scored.push(a.title);
            return JSON.stringify({ qualifies: true, score: 80, sensitive_harm: false, reason: 'ok' });
        },
    });
    assert.equal(result.article.provider, 'ddg');
    assert.ok(!scored.includes('Gardening tips'), 'keyword gate still filters non-AI candidates');
    assert.ok(result.newsRequestCount >= 4);
});
