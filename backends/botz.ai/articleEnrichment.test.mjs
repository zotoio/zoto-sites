import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOpenGraphAndExcerpt } from './articleEnrichment.js';

test('extractOpenGraphAndExcerpt reads og tags and excerpt', () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Title" />
      <meta property="og:description" content="OG Desc" />
      <meta property="og:image" content="https://cdn.example/hero.jpg" />
    </head><body><article><p>${'word '.repeat(80)}</p></article></body></html>`;
    const parsed = extractOpenGraphAndExcerpt(html, { maxExcerptChars: 100 });
    assert.equal(parsed.og_title, 'OG Title');
    assert.equal(parsed.og_description, 'OG Desc');
    assert.equal(parsed.og_image, 'https://cdn.example/hero.jpg');
    assert.ok(parsed.excerpt.length <= 100);
});

test('buildBrowserHeaders looks like Chrome on Windows and fetchLinkedArticleMetadata uses it', async () => {
    const { buildBrowserHeaders, fetchLinkedArticleMetadata, DEFAULT_ARTICLE_FETCH_UA } = await import('./articleEnrichment.js');
    const h = buildBrowserHeaders();
    assert.equal(h['User-Agent'], DEFAULT_ARTICLE_FETCH_UA);
    assert.match(h['User-Agent'], /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\).*Chrome\/141\.0\.0\.0 Safari/);
    assert.doesNotMatch(h['User-Agent'], /botz/i);
    assert.equal(h['Sec-Fetch-Mode'], 'navigate');
    assert.equal(h['sec-ch-ua-platform'], '"Windows"');
    assert.equal(h['Accept-Encoding'], 'gzip, deflate, br');
    assert.equal(h.Referer, 'https://news.ycombinator.com/');

    const seen = [];
    const fetchImpl = async (url, opts) => {
        seen.push({ url, headers: opts.headers, redirect: opts.redirect });
        return new Response('<html><head><meta property="og:title" content="T"></head></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        });
    };
    const out = await fetchLinkedArticleMetadata('https://example.com/a', {
        fetchImpl,
        referer: 'https://news.ycombinator.com/item?id=1',
    });
    assert.equal(out.og_title, 'T');
    assert.equal(seen.length, 1, 'fetches the article page directly (no robots.txt request)');
    const page = seen[0];
    assert.equal(page.url, 'https://example.com/a');
    assert.equal(page.redirect, 'follow');
    assert.equal(page.headers.Referer, 'https://news.ycombinator.com/item?id=1');
    assert.equal(page.headers['Sec-Fetch-Dest'], 'document');
});

const htmlOk = () =>
    new Response('<html><head><meta property="og:title" content="T"></head></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
    });

function proxyHarness(responses) {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, dispatcher: opts.dispatcher });
        return responses.shift()();
    };
    const proxyCalls = [];
    const getProxyDispatcher = async (proxyUrl) => {
        proxyCalls.push(proxyUrl);
        return { proxy: proxyUrl };
    };
    return { calls, fetchImpl, proxyCalls, getProxyDispatcher };
}

test('article proxy: not set => direct only, 403 is not retried', async () => {
    const { fetchLinkedArticleMetadata } = await import('./articleEnrichment.js');
    const h = proxyHarness([() => new Response('no', { status: 403 })]);
    const logs = [];
    const out = await fetchLinkedArticleMetadata('https://example.com/a', { ...h, env: {}, log: (m) => logs.push(m) });
    assert.deepEqual(out, { skipped: 'http_403' });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].dispatcher, undefined);
    assert.equal(h.proxyCalls.length, 0);
    assert.match(logs[0], /route=direct status=403/);
});

test('article proxy: fallback mode retries once via proxy on 403, 429 and cf-mitigated', async () => {
    const { fetchLinkedArticleMetadata } = await import('./articleEnrichment.js');
    const cases = [
        [() => new Response('', { status: 403 }), 'http_403'],
        [() => new Response('', { status: 429 }), 'http_429'],
        [() => new Response('', { status: 200, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } }), 'cf_challenge'],
    ];
    for (const [first, reason] of cases) {
        const h = proxyHarness([first, htmlOk]);
        const logs = [];
        const env = { ARTICLE_FETCH_PROXY: 'http://100.64.0.1:8888', ARTICLE_FETCH_429_RETRIES: '0' };
        const out = await fetchLinkedArticleMetadata('https://example.com/a', { ...h, env, log: (m) => logs.push(m) });
        assert.equal(out.og_title, 'T');
        assert.equal(h.calls.length, 2, reason);
        assert.equal(h.calls[0].dispatcher, undefined, 'first attempt is direct');
        assert.deepEqual(h.calls[1].dispatcher, { proxy: 'http://100.64.0.1:8888' });
        assert.match(logs[0], new RegExp(`route=direct->proxy\\(${reason}\\)`));
    }
    // a proxy failure is not retried again, and a 404 does not trigger the proxy
    const h2 = proxyHarness([() => new Response('', { status: 403 }), () => new Response('', { status: 403 })]);
    const out2 = await fetchLinkedArticleMetadata('https://example.com/a', { ...h2, env: { ARTICLE_FETCH_PROXY: 'http://p:1' } });
    assert.deepEqual(out2, { skipped: 'http_403' });
    assert.equal(h2.calls.length, 2);
    const h3 = proxyHarness([() => new Response('', { status: 404 })]);
    await fetchLinkedArticleMetadata('https://example.com/a', { ...h3, env: { ARTICLE_FETCH_PROXY: 'http://p:1' } });
    assert.equal(h3.calls.length, 1);
    assert.equal(h3.proxyCalls.length, 0);
});

test('article proxy: always mode goes straight through the proxy, one request', async () => {
    const { fetchLinkedArticleMetadata } = await import('./articleEnrichment.js');
    const h = proxyHarness([htmlOk]);
    const logs = [];
    const env = { ARTICLE_FETCH_PROXY: 'http://100.64.0.1:8888', ARTICLE_FETCH_PROXY_MODE: 'always' };
    const out = await fetchLinkedArticleMetadata('https://example.com/a', { ...h, env, log: (m) => logs.push(m) });
    assert.equal(out.og_title, 'T');
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.calls[0].dispatcher, { proxy: 'http://100.64.0.1:8888' });
    assert.match(logs[0], /route=proxy status=200/);
});

test('article proxy: mode parsing defaults to fallback', async () => {
    const { parseArticleFetchProxyMode } = await import('./articleEnrichment.js');
    assert.equal(parseArticleFetchProxyMode(undefined), 'fallback');
    assert.equal(parseArticleFetchProxyMode('bogus'), 'fallback');
    assert.equal(parseArticleFetchProxyMode(' ALWAYS '), 'always');
});

test('article proxy: API calls (HN comment, news providers, Jev) never receive a dispatcher', async () => {
    const { fetchTopHnCommentContext } = await import('./articleEnrichment.js');
    const { thenewsapiProvider } = await import('./newsProviders/thenewsapi.js');
    const { gnewsProvider } = await import('./newsProviders/keyless.js');
    const { createJevClassifierFromEnv } = await import('./jevClassifier.js');
    const env = { ARTICLE_FETCH_PROXY: 'http://100.64.0.1:8888', ARTICLE_FETCH_PROXY_MODE: 'always' };
    const seen = [];
    const spyFetch = async (url, opts = {}) => {
        seen.push(opts);
        return new Response(JSON.stringify({ kids: [], answers: { relevant: { type: 'noul', noul: 0.5 } } }), { status: 200 });
    };
    await fetchTopHnCommentContext('1', { fetchImpl: spyFetch });
    await gnewsProvider.fetchCandidates({ fetchImpl: spyFetch, queries: ['x'] });
    const jev = createJevClassifierFromEnv({ env: { ...env, TYPESAFE_API_KEY: 'k' }, fetchImpl: spyFetch });
    await jev({ title: 't' });
    let apiOpts;
    await thenewsapiProvider.fetchCandidates({ httpGet: async (r) => { apiOpts = r; return { data: {} }; }, env: { ...env, NEWS_API_KEY: 'k' } });
    assert.ok(seen.length >= 3);
    for (const opts of seen) assert.equal(opts.dispatcher, undefined);
    assert.equal(apiOpts.dispatcher, undefined);
});

// ---- 429 exponential backoff (article page fetches only) ----
const r429 = (headers) => () => new Response('', { status: 429, headers });
function backoffRun(responses, env = {}, url = 'https://example.com/a') {
    const h = proxyHarness(responses);
    const sleeps = [];
    const logs = [];
    const cfg = { ...h, env, sleep: async (ms) => sleeps.push(ms), random: () => 0, log: (m) => logs.push(m) };
    return { h, sleeps, logs, run: async () => (await import('./articleEnrichment.js')).fetchLinkedArticleMetadata(url, cfg) };
}

test('429 backoff: 429 then 200 succeeds after one retry with 1000ms delay', async () => {
    const b = backoffRun([r429(), htmlOk]);
    const out = await b.run();
    assert.equal(out.og_title, 'T');
    assert.equal(b.h.calls.length, 2);
    assert.deepEqual(b.sleeps, [1000]);
    assert.ok(b.logs.includes('article_fetch_retry route=direct attempt=1 delay_ms=1000 status=429 host=example.com'));
});

test('429 backoff: delays double 1000/2000/4000 then stop after retries exhausted', async () => {
    const b = backoffRun([r429(), r429(), r429(), r429(), htmlOk]);
    const out = await b.run();
    assert.deepEqual(out, { skipped: 'http_429' });
    assert.deepEqual(b.sleeps, [1000, 2000, 4000]);
    assert.equal(b.h.calls.length, 4);
});

test('429 backoff: delay capped at ARTICLE_FETCH_429_MAX_MS (default 30000)', async () => {
    const b = backoffRun(Array.from({ length: 9 }, () => r429()), { ARTICLE_FETCH_429_RETRIES: '8', ARTICLE_FETCH_429_BASE_MS: '10000' });
    await b.run();
    assert.deepEqual(b.sleeps, [10000, 20000, 30000, 30000, 30000, 30000, 30000, 30000]);
    const c = backoffRun([r429(), htmlOk], { ARTICLE_FETCH_429_MAX_MS: '500' });
    await c.run();
    assert.deepEqual(c.sleeps, [500]);
});

test('429 backoff: numeric Retry-After respected and clamped; jitter within 20%', async () => {
    const b = backoffRun([r429({ 'retry-after': '7' }), r429({ 'retry-after': '999' }), htmlOk]);
    await b.run();
    assert.deepEqual(b.sleeps, [7000, 30000]);
    const { compute429DelayMs } = await import('./articleEnrichment.js');
    assert.equal(compute429DelayMs({ attempt: 0, baseMs: 1000, maxMs: 30000, random: () => 1 }), 1200);
    assert.equal(compute429DelayMs({ attempt: 5, baseMs: 1000, maxMs: 30000, random: () => 1 }), 30000);
});

test('429 backoff: proxy path (always mode) gets backoff', async () => {
    const b = backoffRun([r429(), r429(), htmlOk], { ARTICLE_FETCH_PROXY: 'http://p:1', ARTICLE_FETCH_PROXY_MODE: 'always' });
    const out = await b.run();
    assert.equal(out.og_title, 'T');
    assert.deepEqual(b.sleeps, [1000, 2000]);
    assert.ok(b.h.calls.every((c) => c.dispatcher?.proxy === 'http://p:1'));
    assert.match(b.logs[0], /article_fetch_retry route=proxy attempt=1 delay_ms=1000 status=429/);
});

test('429 backoff: fallback direct 429 exhausted -> proxy, which also backs off', async () => {
    const b = backoffRun(
        [r429(), r429(), r429(), r429(), r429(), htmlOk],
        { ARTICLE_FETCH_PROXY: 'http://p:1', ARTICLE_FETCH_429_RETRIES: '3' },
    );
    const out = await b.run();
    assert.equal(out.og_title, 'T');
    assert.deepEqual(b.sleeps, [1000, 2000, 4000, 1000]);
    assert.equal(b.h.calls.length, 6);
    assert.equal(b.h.calls[3].dispatcher, undefined);
    assert.deepEqual(b.h.calls[4].dispatcher, { proxy: 'http://p:1' });
    assert.ok(b.logs.some((l) => /route=direct->proxy\(http_429\) status=200/.test(l)));
});

test('429 backoff: non-429 errors and 403/cf-mitigated are not retried with backoff', async () => {
    for (const status of [403, 404, 500, 503]) {
        const b = backoffRun([() => new Response('', { status }), htmlOk]);
        const out = await b.run();
        assert.deepEqual(out, { skipped: `http_${status}` });
        assert.equal(b.h.calls.length, 1);
        assert.deepEqual(b.sleeps, []);
    }
    const cf = backoffRun([() => new Response('', { status: 200, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } }), htmlOk], { ARTICLE_FETCH_PROXY: 'http://p:1' });
    await cf.run();
    assert.deepEqual(cf.sleeps, []);
});
