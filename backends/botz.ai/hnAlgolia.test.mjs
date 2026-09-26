import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    buildHnAlgoliaParams,
    mapAlgoliaHitToCandidate,
    utcDayUnixRange,
} from './hnAlgolia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('utcDayUnixRange covers full UTC calendar day', () => {
    const { start, end } = utcDayUnixRange('2026-06-10');
    assert.equal(end - start + 1, 86400);
});

test('buildHnAlgoliaParams includes points and created_at filters', () => {
    const params = buildHnAlgoliaParams({ asOfDate: '2026-06-10', minPoints: 15, page: 0 });
    assert.match(params.numericFilters, /points>=15/);
    assert.match(params.numericFilters, /created_at_i>=/);
    assert.equal(params.tags, 'story');
});

test('mapAlgoliaHitToCandidate sets hn_url and source domain', () => {
    const c = mapAlgoliaHitToCandidate({
        objectID: '99',
        title: 'Claude 4 benchmark',
        url: 'https://www.anthropic.com/news/claude',
        points: 10,
        num_comments: 2,
        created_at_i: 1781049600,
    });
    assert.equal(c.hn_url, 'https://news.ycombinator.com/item?id=99');
    assert.equal(c.source, 'anthropic.com');
});

test('recorded fixture parses as Algolia search_by_date shape', () => {
    const raw = fs.readFileSync(path.join(__dirname, 'fixtures/hn/2026-06-10.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.ok(data.hits.length > 0);
    assert.ok(data.hits[0].title);
});
