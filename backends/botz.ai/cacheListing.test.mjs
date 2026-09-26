import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    isPublicEditorialCacheFileName,
    listPublicEditorialCacheFileNames,
} from './cacheListing.js';

test('isPublicEditorialCacheFileName rejects dot-prefixed names', () => {
    assert.equal(isPublicEditorialCacheFileName('.replaced.json'), false);
    assert.equal(isPublicEditorialCacheFileName('2026-05-13-12.json'), true);
});

test('listPublicEditorialCacheFileNames ignores dot directories and files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-cache-list-'));
    fs.mkdirSync(path.join(dir, '.replaced'));
    fs.writeFileSync(path.join(dir, '2026-05-13-12.json'), '[]');
    fs.writeFileSync(path.join(dir, '.hidden.json'), '[]');
    const names = listPublicEditorialCacheFileNames(dir);
    assert.deepEqual(names, ['2026-05-13-12.json']);
});
