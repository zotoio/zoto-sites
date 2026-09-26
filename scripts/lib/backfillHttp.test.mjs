import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithRetries } from './backfillHttp.js';

test('fetchWithRetries succeeds after transient failures', async () => {
    let calls = 0;
    const response = await fetchWithRetries(
        'http://example.test',
        {},
        {
            maxRetries: 2,
            baseDelayMs: 1,
            fetchImpl: async () => {
                calls += 1;
                if (calls < 3) {
                    throw new Error('network timeout');
                }
                return { ok: true, status: 200 };
            },
        }
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
});

test('fetchWithRetries throws after exhausting retries', async () => {
    await assert.rejects(() =>
        fetchWithRetries('http://example.test', {}, {
            maxRetries: 2,
            baseDelayMs: 1,
            fetchImpl: async () => {
                throw new Error('fail');
            },
        })
    );
});
