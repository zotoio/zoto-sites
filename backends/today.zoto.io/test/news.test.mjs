import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenGraphFromHtml, extractMetaContent } from '../lib/article-meta.js';
import { demoNews } from '../lib/demo.js';

test('parseOpenGraphFromHtml extracts og tags', () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
    <meta property="og:description" content="Hello world" />
  </head></html>`;
  const out = parseOpenGraphFromHtml(html, 'https://example.com/post');
  assert.equal(out.image_url, 'https://cdn.example.com/hero.jpg');
  assert.equal(out.description, 'Hello world');
});

test('parseOpenGraphFromHtml uses same-origin placeholder without og image', () => {
  const out = parseOpenGraphFromHtml('<html></html>', 'https://example.com/post');
  assert.equal(out.image_url, '/assets/hn-news-placeholder.svg');
});

test('demoNews includes HN-style fields and demo source', () => {
  const n = demoNews();
  assert.equal(n.source, 'demo');
  assert.equal(n.articles.length, 10);
  assert.ok(n.articles[0].hn_url);
  assert.ok('points' in n.articles[0]);
});
