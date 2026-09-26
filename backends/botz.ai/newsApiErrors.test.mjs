import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractNewsApiErrorMessage,
    isNewsQuotaExhaustedResponse,
    mapAxiosNewsApiError,
    NewsQuotaExhaustedError,
    noQualifyingStoryError,
} from './newsApiErrors.js';

test('extractNewsApiErrorMessage handles nested error objects', () => {
    assert.equal(
        extractNewsApiErrorMessage({ error: { code: 'usage_limit_reached' } }),
        'usage_limit_reached'
    );
    assert.equal(extractNewsApiErrorMessage({ message: 'plain' }), 'plain');
});

test('isNewsQuotaExhaustedResponse detects HTTP 402', () => {
    assert.equal(isNewsQuotaExhaustedResponse(402, { error: 'usage_limit_reached' }), true);
    assert.equal(isNewsQuotaExhaustedResponse(200, {}), false);
});

test('mapAxiosNewsApiError maps 402 to NewsQuotaExhaustedError', () => {
    const mapped = mapAxiosNewsApiError(
        { response: { status: 402, data: { error: 'usage_limit_reached' } } },
        { asOfDate: '2026-06-01' }
    );
    assert.ok(mapped instanceof NewsQuotaExhaustedError);
    assert.equal(mapped.clientError, 'news_quota_exhausted');
});

test('noQualifyingStoryError sets reason no_articles', () => {
    const err = noQualifyingStoryError('no_articles', 'empty');
    assert.equal(err.statusCode, 422);
    assert.equal(err.reason, 'no_articles');
});
