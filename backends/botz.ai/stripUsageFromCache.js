import fs from 'fs';
import path from 'path';
import { isPublicEditorialCacheFileName } from './cacheListing.js';

export function stripOpenAiUsageFromPayload(payload) {
    if (!Array.isArray(payload) || payload.length === 0) {
        return { changed: false, payload };
    }
    const entry = payload[0];
    if (!entry?.article?.backfilled) {
        return { changed: false, payload };
    }
    if (!Object.prototype.hasOwnProperty.call(entry, '_openai_usage')) {
        return { changed: false, payload };
    }
    const next = payload.map((item, index) => {
        if (index !== 0) {
            return item;
        }
        const { _openai_usage, ...rest } = item;
        return rest;
    });
    return { changed: true, payload: next };
}

export function stripUsageFromCacheFile(filePath, { execute = false } = {}) {
    if (!isPublicEditorialCacheFileName(path.basename(filePath))) {
        return { skipped: true, reason: 'not_public_cache_file' };
    }

    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const { changed, payload } = stripOpenAiUsageFromPayload(parsed);

    if (!changed) {
        return { skipped: true, reason: 'no_usage_key' };
    }

    if (!execute) {
        return { dryRun: true, wouldChange: true, filePath };
    }

    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.strip-usage.tmp`);
    fs.writeFileSync(tmpPath, JSON.stringify(payload));
    fs.utimesSync(tmpPath, stat.atime, stat.mtime);
    fs.renameSync(tmpPath, filePath);
    return { changed: true, filePath };
}
