import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    filterExcludedStoryCandidates,
    normalizeStoryIdentifier,
    readRecentLiveStoryIdentifiers,
} from './liveStoryDedup.js';

test('normalizeStoryIdentifier canonicalizes URLs', () => {
    assert.equal(
        normalizeStoryIdentifier('https://Example.com/path/'),
        'https://example.com/path'
    );
    assert.equal(
        normalizeStoryIdentifier('https://news.ycombinator.com/item?id=42'),
        'https://news.ycombinator.com/item?id=42'
    );
});

test('readRecentLiveStoryIdentifiers skips backfilled editorials', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-dedup-'));
    const live = [
        {
            article: {
                url: 'https://news.example/a',
                hn_url: 'https://news.ycombinator.com/item?id=1',
            },
            editorial: '<p>x</p>',
        },
    ];
    const backfilled = [
        {
            article: {
                url: 'https://news.example/old',
                backfilled: true,
            },
            editorial: '<p>x</p>',
        },
    ];
    fs.writeFileSync(path.join(dir, '2026-09-26-14.json'), JSON.stringify(live));
    fs.writeFileSync(path.join(dir, '2026-09-26-13.json'), JSON.stringify(backfilled));

    const excluded = readRecentLiveStoryIdentifiers(dir, { maxEditorials: 5 });
    assert.equal(excluded.has('https://news.example/a'), true);
    assert.equal(excluded.has('https://news.ycombinator.com/item?id=1'), true);
    assert.equal(excluded.has('https://news.example/old'), false);
});

test('filterExcludedStoryCandidates removes recent picks', () => {
    const excluded = new Set([normalizeStoryIdentifier('https://hn.example/story')]);
    const kept = filterExcludedStoryCandidates(
        [{ url: 'https://hn.example/story' }, { url: 'https://other.example/new' }],
        excluded
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].url, 'https://other.example/new');
});
