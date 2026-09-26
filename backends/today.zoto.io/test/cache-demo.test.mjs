import test from 'node:test';
import assert from 'node:assert/strict';
import { cached, clearCacheForTests } from '../lib/cache.js';
import { demoNews, isDemoRequest } from '../lib/demo.js';

test('cached returns same value within ttl', async () => {
  clearCacheForTests();
  let calls = 0;
  const v1 = await cached('k', async () => {
    calls += 1;
    return 42;
  }, 60000);
  const v2 = await cached('k', async () => {
    calls += 1;
    return 99;
  }, 60000);
  assert.equal(v1, 42);
  assert.equal(v2, 42);
  assert.equal(calls, 1);
});

test('demoNews always has ten articles', () => {
  const n = demoNews();
  assert.equal(n.articles.length, 10);
  assert.equal(n.source, 'demo');
});

test('isDemoRequest reads query flag', () => {
  assert.equal(isDemoRequest({ query: { demo: '1' }, get: () => undefined }), true);
  assert.equal(isDemoRequest({ query: {}, get: () => undefined }), false);
});
