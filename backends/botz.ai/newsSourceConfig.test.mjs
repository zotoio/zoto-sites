import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNewsSourceEnv, parseNewsSource } from './newsSourceConfig.js';

test('parseNewsSource defaults to hn', () => {
    assert.equal(parseNewsSource(undefined), 'hn');
    assert.equal(parseNewsSource('thenewsapi'), 'thenewsapi');
});

test('assertNewsSourceEnv requires NEWS_API_KEY for thenewsapi only', () => {
    assert.throws(() => assertNewsSourceEnv({ newsSource: 'thenewsapi', newsApiKey: '' }));
    assert.doesNotThrow(() => assertNewsSourceEnv({ newsSource: 'hn', newsApiKey: '' }));
});
