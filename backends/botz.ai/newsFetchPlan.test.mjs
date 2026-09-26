import assert from 'node:assert/strict';
import test from 'node:test';
import { NEWS_REQUEST_PROFILE, plannedMaxNewsRequests } from './newsFetchPlan.js';

test('documented news request counts for HN and legacy thenewsapi', () => {
    assert.equal(NEWS_REQUEST_PROFILE.hn.historicalPerEditorialTypical, 1);
    assert.equal(NEWS_REQUEST_PROFILE.thenewsapi.before.historicalPerEditorial, 3);
    assert.equal(plannedMaxNewsRequests({ newsSource: 'hn', asOfDate: '2026-01-01' }), 2);
    assert.equal(plannedMaxNewsRequests({ newsSource: 'hn', isWeekend: false }), 1);
    assert.equal(plannedMaxNewsRequests({ newsSource: 'thenewsapi', asOfDate: '2026-01-01' }), 2);
});
