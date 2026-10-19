/**
 * Date-paged archive (cheerio-free so `node --test` runs without installed dependencies).
 *
 * The archive is served one calendar day at a time, keyed on the date prefix of the cache keys
 * (`YYYY-MM-DD-HH[-timestamp]`, server-local time, the same clock that names the cache files):
 *
 *   GET /archive/index             -> { total, days: [{ date, count }] }   newest day first
 *   GET /archive/day/YYYY-MM-DD    -> { date, count, older, editorials: [story] }   newest story first
 *   GET /archive/latest            -> the same body as /archive/day/<newest date>
 *
 * A day only changes while stories are still being written to it, so past days are long-cacheable; clients add
 * `?n=<count from the index>` so a later backfill (admin `asOf`) changes the URL instead of needing a purge.
 * This module only lists and reads cache files; it never writes, moves or deletes them.
 */
import { buildArchiveListItem } from './archiveListing.js';

export const ARCHIVE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Today/yesterday and the moving entry points: short TTL, served stale while the edge revalidates. */
export const CACHE_RECENT = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';
/** A past day whose count matches the client's `n`: it will not change again. */
export const CACHE_PAST_DAY = 'public, max-age=31536000, s-maxage=31536000, immutable';
export const CACHE_NONE = 'no-store';

/** Archive order used everywhere (same comparator as the legacy /archive?page= listing): newest first. */
export function sortArchiveFileNames(names) {
    return [...names].sort((a, b) => b.localeCompare(a));
}

export function cacheKeyOfFile(name) {
    return String(name).replace(/\.json$/, '');
}

export function cacheKeyDate(key) {
    const m = /^(\d{4}-\d{2}-\d{2})-\d{2}(?:-\d{13})?$/.exec(String(key ?? ''));
    return m ? m[1] : null;
}

export function isArchiveDate(value) {
    if (!ARCHIVE_DATE_RE.test(String(value ?? ''))) return false;
    const [y, m, d] = value.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Days with stories, newest first, from the public cache file names. */
export function buildArchiveIndex(fileNames) {
    const days = [];
    let total = 0;
    for (const name of sortArchiveFileNames(fileNames)) {
        const date = cacheKeyDate(cacheKeyOfFile(name));
        if (!date) continue;
        total++;
        const last = days[days.length - 1];
        if (last && last.date === date) last.count++;
        else days.push({ date, count: 1 });
    }
    return { total, days };
}

/** One day's cache file names (newest first) plus the next older day that has stories. */
export function archiveDaySlice(fileNames, date) {
    const files = [];
    let older = null;
    for (const name of sortArchiveFileNames(fileNames)) {
        const d = cacheKeyDate(cacheKeyOfFile(name));
        if (!d) continue;
        if (d === date) files.push(name);
        else if (d < date) { older = d; break; }
    }
    return { files, older };
}

/** YYYY-MM-DD in server-local time (cache keys are named with the server clock). */
export function localDate(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Cache-Control for /archive/day/<date>. Only a day that is at least two days old, and whose story count matches
 * the `n` the client asked for, is immutable; anything that may still change (today, yesterday around midnight,
 * a count mismatch or a missing `n`) gets the short TTL.
 */
export function archiveDayCacheControl(date, count, requestedCount, now = new Date()) {
    const cutoff = localDate(new Date(now.getTime() - 36 * 3600 * 1000));   // at least a full day after the date ended
    const settled = date < cutoff;
    return settled && Number.isInteger(requestedCount) && requestedCount === count ? CACHE_PAST_DAY : CACHE_RECENT;
}

/** Story fields the site renders (drops private and bulky source fields such as description/snippet/_source). */
const PUBLIC_ARTICLE_FIELDS = ['title', 'url', 'hn_url', 'published_at', 'source', 'image_url', 'authorAlias', 'author', 'generated_at'];

/** One story for a day response: the tile fields plus the full story the carousel renders (no second fetch). */
export function buildArchiveDayItem(cacheKey, entry) {
    const article = entry?.article || {};
    const publicArticle = {};
    for (const k of PUBLIC_ARTICLE_FIELDS) if (article[k] !== undefined) publicArticle[k] = article[k];
    return {
        ...buildArchiveListItem(cacheKey, entry),
        entry: { article: publicArticle, editorial: entry?.editorial || '' },
    };
}
