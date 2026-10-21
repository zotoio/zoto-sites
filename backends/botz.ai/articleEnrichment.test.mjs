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
        const env = { ARTICLE_FETCH_PROXY: 'http://100.64.0.1:8888' };
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
