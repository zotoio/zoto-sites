import assert from 'node:assert/strict';
import test from 'node:test';
import { NEWS_REQUEST_PROFILE, plannedMaxNewsRequests } from './newsFetchPlan.js';

test('documented before/after news request counts', () => {
    assert.equal(NEWS_REQUEST_PROFILE.before.historicalPerEditorial, 3);
    assert.equal(NEWS_REQUEST_PROFILE.after.historicalPerEditorialTypical, 1);
    assert.equal(plannedMaxNewsRequests({ asOfDate: '2026-01-01' }), 2);
    assert.equal(plannedMaxNewsRequests({ isWeekend: false }), 1);
});
