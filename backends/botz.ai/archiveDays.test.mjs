import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CACHE_PAST_DAY, CACHE_RECENT, archiveDayCacheControl, archiveDaySlice, buildArchiveDayItem,
    buildArchiveIndex, cacheKeyDate, isArchiveDate, localDate, sortArchiveFileNames,
} from './archiveDays.js';
import { archivePageWindow } from './archiveListing.js';

const files = [
    '2026-10-16-09.json', '2026-10-18-21.json', '2026-10-17-10-1792231490949.json', '2026-10-17-21.json',
    '2026-10-17-10.json', '2026-09-07-12.json',
];

test('cacheKeyDate takes the date of hourly and timestamp-suffixed keys only', () => {
    assert.equal(cacheKeyDate('2026-10-17-21'), '2026-10-17');
    assert.equal(cacheKeyDate('2026-10-17-10-1792231490949'), '2026-10-17');
    assert.equal(cacheKeyDate('2026-10-17'), null);
    assert.equal(cacheKeyDate('../2026-10-17-21'), null);
});

test('isArchiveDate rejects malformed and impossible dates', () => {
    assert.ok(isArchiveDate('2026-02-28'));
    assert.ok(!isArchiveDate('2026-02-30'));
    assert.ok(!isArchiveDate('2026-2-3'));
    assert.ok(!isArchiveDate('2026-10-17-21'));
    assert.ok(!isArchiveDate(undefined));
});

test('buildArchiveIndex groups stories per day, newest day first, in archive order', () => {
    assert.deepEqual(buildArchiveIndex(files), {
        total: 6,
        days: [
            { date: '2026-10-18', count: 1 }, { date: '2026-10-17', count: 3 },
            { date: '2026-10-16', count: 1 }, { date: '2026-09-07', count: 1 },
        ],
    });
    assert.deepEqual(buildArchiveIndex([]), { total: 0, days: [] });
});

test('archiveDaySlice returns the whole day (newest first) and the next older day with stories', () => {
    assert.deepEqual(archiveDaySlice(files, '2026-10-17'), {
        files: sortArchiveFileNames(['2026-10-17-21.json', '2026-10-17-10-1792231490949.json', '2026-10-17-10.json']),
        older: '2026-10-16',
    });
    // the oldest day is served too (the old page-number paging could drop a final partial page)
    assert.deepEqual(archiveDaySlice(files, '2026-09-07'), { files: ['2026-09-07-12.json'], older: null });
    // a date with no stories still points at the next older one
    assert.deepEqual(archiveDaySlice(files, '2026-10-01'), { files: [], older: '2026-09-07' });
});

test('every story appears in exactly one day and the day counts add up to the total', () => {
    const many = [];
    for (let d = 1; d <= 9; d++) for (let h = 0; h < 24; h += 1 + (d % 3)) many.push(`2026-08-0${d}-${String(h).padStart(2, '0')}.json`);
    const index = buildArchiveIndex(many);
    const seen = index.days.flatMap(({ date }) => archiveDaySlice(many, date).files);
    assert.equal(seen.length, many.length);
    assert.equal(new Set(seen).size, many.length);
    assert.equal(index.days.reduce((n, d) => n + d.count, 0), index.total);
});

test('Cache-Control: past days with a matching count are immutable, everything recent stays short', () => {
    const now = new Date(2026, 9, 19, 18, 0, 0);   // 19 Oct, 6 pm server-local
    assert.equal(localDate(now), '2026-10-19');
    assert.equal(archiveDayCacheControl('2026-10-10', 24, 24, now), CACHE_PAST_DAY);
    assert.equal(archiveDayCacheControl('2026-10-17', 24, 24, now), CACHE_PAST_DAY);
    assert.equal(archiveDayCacheControl('2026-10-18', 24, 24, now), CACHE_RECENT);   // yesterday
    assert.equal(archiveDayCacheControl('2026-10-19', 5, 5, now), CACHE_RECENT);     // today
    assert.equal(archiveDayCacheControl('2026-10-10', 24, 23, now), CACHE_RECENT);   // stale count (backfill)
    assert.equal(archiveDayCacheControl('2026-10-10', 24, undefined, now), CACHE_RECENT);
    // just after midnight the day that has only just ended is still treated as recent
    assert.equal(archiveDayCacheControl('2026-10-18', 24, 24, new Date(2026, 9, 19, 0, 30)), CACHE_RECENT);
    assert.match(CACHE_PAST_DAY, /public/);
    assert.match(CACHE_PAST_DAY, /s-maxage=31536000/);
    assert.match(CACHE_RECENT, /max-age=60.*stale-while-revalidate/);
});

test('buildArchiveDayItem carries the tile fields and the full story, without private or bulky fields', () => {
    const item = buildArchiveDayItem('2026-10-17-21', {
        article: { title: 'Src', url: 'https://x', image_url: '/cache/images/a.png', generated_at: '2026-10-17-20-55-00',
            authorAlias: 'ChatGPT', description: 'long', snippet: 'long', _source: { raw: 1 }, points: 3 },
        editorial: '<h2>Head <span>Agent ChatGPT</span></h2><p>Body</p>',
        _openai_usage: { tokens: 1 },
    });
    assert.equal(item.cache_key, '2026-10-17-21');
    assert.equal(item.image_url, '/cache/images/a.png');
    assert.equal(item.author, 'Agent ChatGPT');
    assert.deepEqual(Object.keys(item.entry).sort(), ['article', 'editorial']);
    assert.equal(item.entry.editorial, '<h2>Head <span>Agent ChatGPT</span></h2><p>Body</p>');
    for (const k of ['description', 'snippet', '_source', 'points']) assert.ok(!(k in item.entry.article), k);
    assert.equal(item.entry.article.url, 'https://x');
});

test('legacy ?page= still serves the final, partly filled page', () => {
    const last = archivePageWindow(25, 2, NaN);
    assert.equal(last.valid, true);
    assert.equal(last.end - last.start, 1);
    assert.equal(last.pagination.has_next, false);
    assert.equal(archivePageWindow(25, 3, NaN).valid, false);
});
