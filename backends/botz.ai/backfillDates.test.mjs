import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    assertCacheFileWritable,
    cacheFilePathForKey,
    dateHasAnyEditorialCache,
    editorialCacheKeyForDate,
    enumerateDatesInclusive,
    nextCalendarDay,
} from './backfillDates.js';
import { buildTopNewsParams, describeTopNewsRequest } from './newsApi.js';

test('nextCalendarDay advances UTC calendar date', () => {
    assert.equal(nextCalendarDay('2026-05-31'), '2026-06-01');
});

test('enumerateDatesInclusive includes both endpoints', () => {
    const dates = enumerateDatesInclusive('2026-05-13', '2026-05-15');
    assert.deepEqual(dates, ['2026-05-13', '2026-05-14', '2026-05-15']);
});

test('editorialCacheKeyForDate uses zero-padded hour for archive sort', () => {
    assert.equal(editorialCacheKeyForDate('2026-05-13', 12), '2026-05-13-12');
});

test('dateHasAnyEditorialCache detects any hour on that day', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-cache-'));
    fs.writeFileSync(path.join(dir, '2026-05-13-08.json'), '[]');
    assert.equal(dateHasAnyEditorialCache(dir, '2026-05-13'), true);
    assert.equal(dateHasAnyEditorialCache(dir, '2026-05-14'), false);
});

test('assertCacheFileWritable refuses existing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-cache-'));
    const filePath = cacheFilePathForKey(dir, '2026-05-13-12');
    fs.writeFileSync(filePath, '[]');
    assert.throws(() => assertCacheFileWritable(filePath), /Refusing to overwrite/);
});

test('buildTopNewsParams adds published_on for historical days', () => {
    const params = buildTopNewsParams({
        apiToken: 'secret',
        search: 'openai|llm',
        asOfDate: '2026-05-13',
    });
    assert.equal(params.published_on, '2026-05-13');
    assert.equal(params.sort, 'published_at');
    const described = describeTopNewsRequest(params, { redactToken: true });
    assert.match(described.query, /published_on=2026-05-13/);
    assert.doesNotMatch(described.query, /secret/);
});
