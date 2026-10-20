import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractOpenGraphAndExcerpt,
    isRobotsFetchAllowed,
    robotsDisallowsPath,
} from './articleEnrichment.js';

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

test('robotsDisallowsPath respects Disallow prefix', () => {
    const robots = 'User-agent: *\nDisallow: /private\n';
    assert.equal(robotsDisallowsPath(robots, '/private/report'), true);
    assert.equal(robotsDisallowsPath(robots, '/public'), false);
});

test('isRobotsFetchAllowed returns false when robots blocks path', async () => {
    const allowed = await isRobotsFetchAllowed('https://example.com/private/page', {
        fetchImpl: async (url) => {
            if (url.endsWith('/robots.txt')) {
                return { ok: true, text: async () => 'User-agent: *\nDisallow: /private\n' };
            }
            throw new Error('unexpected fetch');
        },
    });
    assert.equal(allowed, false);
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
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
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
    const page = seen.find((c) => !c.url.endsWith('/robots.txt'));
    assert.equal(page.redirect, 'follow');
    assert.equal(page.headers.Referer, 'https://news.ycombinator.com/item?id=1');
    assert.equal(page.headers['Sec-Fetch-Dest'], 'document');
});
