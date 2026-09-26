import fs from 'fs';
import path from 'path';
import { listPublicEditorialCacheFileNames } from './cacheListing.js';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(dateStr) {
    const match = DATE_ONLY_RE.exec(dateStr);
    if (!match) {
        throw new Error(`Invalid date "${dateStr}" (expected YYYY-MM-DD)`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
        utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day
    ) {
        throw new Error(`Invalid calendar date "${dateStr}"`);
    }
    return utc;
}

export function formatDateOnly(utcDate) {
    const y = utcDate.getUTCFullYear();
    const m = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utcDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Inclusive UTC date range from --from through --to. */
export function nextCalendarDay(dateStr) {
    const from = parseDateOnly(dateStr);
    const next = new Date(from.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    return formatDateOnly(next);
}

export function enumerateDatesInclusive(fromStr, toStr) {
    const from = parseDateOnly(fromStr);
    const to = parseDateOnly(toStr);
    if (from.getTime() > to.getTime()) {
        throw new Error(`--from (${fromStr}) must be on or before --to (${toStr})`);
    }
    const dates = [];
    const cursor = new Date(from.getTime());
    while (cursor.getTime() <= to.getTime()) {
        dates.push(formatDateOnly(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}

export function editorialCacheKeyForDate(dateStr, hour) {
    const hourNum = Number(hour);
    if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 99) {
        throw new Error(`Invalid hour "${hour}" (expected 0-99)`);
    }
    parseDateOnly(dateStr);
    const hourPadded = String(hourNum).padStart(2, '0');
    return `${dateStr}-${hourPadded}`;
}

export function listEditorialCacheJsonFiles(cacheDir) {
    return listPublicEditorialCacheFileNames(cacheDir);
}

/** True if any editorial cache JSON exists for the calendar day (any hour suffix). */
export function dateHasAnyEditorialCache(cacheDir, dateStr) {
    parseDateOnly(dateStr);
    const prefix = `${dateStr}-`;
    return listEditorialCacheJsonFiles(cacheDir).some((file) => file.startsWith(prefix));
}

export function cacheFilePathForKey(cacheDir, cacheKey) {
    return path.join(cacheDir, `${cacheKey}.json`);
}

export function assertCacheFileWritable(cacheFilePath) {
    if (fs.existsSync(cacheFilePath)) {
        throw new Error(`Refusing to overwrite existing cache file: ${cacheFilePath}`);
    }
}

export function formatGeneratedAtFromAsOf(dateStr, hour) {
    const hourPadded = String(Number(hour)).padStart(2, '0');
    return `${dateStr}-${hourPadded}-00-00`;
}

export function hourFromCacheKey(cacheKey) {
    const match = /^(\d{4}-\d{2}-\d{2})-(\d{2})(-\d{13})?$/.exec(cacheKey);
    if (!match) {
        return null;
    }
    return match[2];
}

export function formatRealGenerationTimestamp(now = new Date()) {
    const pad = (n) => (n < 10 ? `0${n}` : String(n));
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`;
}
