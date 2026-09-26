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
