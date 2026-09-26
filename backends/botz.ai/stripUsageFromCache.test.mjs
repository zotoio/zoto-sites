import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stripOpenAiUsageFromPayload, stripUsageFromCacheFile } from './stripUsageFromCache.js';

test('stripOpenAiUsageFromPayload only removes key for backfilled editorials', () => {
    const live = [{ article: { backfilled: false }, _openai_usage: { totals: {} } }];
    assert.equal(stripOpenAiUsageFromPayload(live).changed, false);

    const backfill = [{ article: { backfilled: true }, editorial: 'x', _openai_usage: { totals: { total_tokens: 1 } } }];
    const result = stripOpenAiUsageFromPayload(backfill);
    assert.equal(result.changed, true);
    assert.equal('_openai_usage' in result.payload[0], false);
    assert.equal(result.payload[0].editorial, 'x');
});

test('stripUsageFromCacheFile dry-run does not modify file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-strip-'));
    const filePath = path.join(dir, '2026-05-13-12.json');
    const before = JSON.stringify([
        { article: { backfilled: true }, _openai_usage: { totals: {} }, editorial: '<p>a</p>' },
    ]);
    fs.writeFileSync(filePath, before);
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    const result = stripUsageFromCacheFile(filePath, { execute: false });
    assert.equal(result.dryRun, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), before);
    assert.equal(fs.statSync(filePath).mtimeMs, mtimeBefore);
});

test('stripUsageFromCacheFile execute preserves mtime', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-strip-'));
    const filePath = path.join(dir, '2026-05-13-12.json');
    fs.writeFileSync(
        filePath,
        JSON.stringify([{ article: { backfilled: true }, _openai_usage: { x: 1 }, editorial: 'z' }])
    );
    const mtimeBefore = fs.statSync(filePath).mtimeMs;

    stripUsageFromCacheFile(filePath, { execute: true });
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal('_openai_usage' in parsed[0], false);
    assert.equal(parsed[0].editorial, 'z');
    assert.ok(Math.abs(fs.statSync(filePath).mtimeMs - mtimeBefore) < 2);
});
