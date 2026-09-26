import assert from 'node:assert/strict';
import test from 'node:test';
import { purgeCloudflareCacheByUrl } from './cloudflarePurge.js';

const TEST_TOKEN = 'cf-api-token-must-not-appear-in-logs-7f3a9b2c';

function captureLogs(fn) {
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    all: () => [...logs, ...errors].join('\n'),
    run: () =>
      fn({
        log: (msg) => logs.push(String(msg)),
        errorLog: (msg) => errors.push(String(msg)),
      }),
  };
}

test('purge success logs target only, never the API token or Authorization', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true }),
  });

  const cap = captureLogs((hooks) =>
    purgeCloudflareCacheByUrl({
      zoneId: 'zone-id-abc',
      apiToken: TEST_TOKEN,
      url: 'https://botz.ai/editorials?cacheKey=2025-01-01-12',
      ...hooks,
    })
  );
  await cap.run();

  globalThis.fetch = originalFetch;

  assert.equal(cap.logs.length, 1);
  assert.match(cap.logs[0], /success target=https:\/\/botz\.ai\/editorials/);
  assert.doesNotMatch(cap.all(), new RegExp(TEST_TOKEN));
  assert.doesNotMatch(cap.all(), /Bearer/i);
  assert.doesNotMatch(cap.all(), /Authorization/i);
});

test('purge failure logs Cloudflare error message without secrets', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({
      success: false,
      errors: [{ message: 'Invalid purge URL' }],
    }),
  });

  const cap = captureLogs((hooks) =>
    purgeCloudflareCacheByUrl({
      zoneId: 'zone-id-abc',
      apiToken: TEST_TOKEN,
      url: 'https://botz.ai/foo',
      ...hooks,
    })
  );
  await cap.run();

  globalThis.fetch = originalFetch;

  assert.equal(cap.errors.length, 1);
  assert.match(cap.errors[0], /failed target=https:\/\/botz\.ai\/foo/);
  assert.match(cap.errors[0], /Invalid purge URL/);
  assert.doesNotMatch(cap.all(), new RegExp(TEST_TOKEN));
});
