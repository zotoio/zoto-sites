import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archiveBackfilledEditorial, parseLocalImageFilename } from './editorialReplace.js';

test('parseLocalImageFilename extracts filename from local cache URL', () => {
    assert.equal(parseLocalImageFilename('/cache/images/2026-05-13-12-abc.png'), '2026-05-13-12-abc.png');
});

test('archiveBackfilledEditorial moves json and image into .replaced', () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-cache-'));
    const imagesDir = path.join(cacheDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const imageName = '2026-05-13-12-deadbeef.png';
    fs.writeFileSync(path.join(imagesDir, imageName), 'png');

    const cacheKey = '2026-05-13-12';
    fs.writeFileSync(
        path.join(cacheDir, `${cacheKey}.json`),
        JSON.stringify([
            {
                article: {
                    backfilled: true,
                    image_url: `/cache/images/${imageName}`,
                },
                editorial: '<p>x</p>',
            },
        ])
    );

    const result = archiveBackfilledEditorial(cacheDir, cacheKey);
    assert.match(result.jsonArchived, /\.replaced\/2026-05-13-12\.json$/);
    assert.equal(fs.existsSync(path.join(cacheDir, `${cacheKey}.json`)), false);
    assert.equal(fs.existsSync(path.join(imagesDir, imageName)), false);
    assert.equal(fs.existsSync(result.imageArchived), true);
});

test('archiveBackfilledEditorial refuses non-backfilled editorials', () => {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botz-cache-'));
    fs.writeFileSync(
        path.join(cacheDir, '2026-05-13-12.json'),
        JSON.stringify([{ article: { backfilled: false }, editorial: '' }])
    );
    assert.throws(() => archiveBackfilledEditorial(cacheDir, '2026-05-13-12'), /not a backfilled/);
});
