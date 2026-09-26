import fs from 'fs';
import path from 'path';
import { listPublicEditorialCacheFileNames } from './cacheListing.js';

export function normalizeStoryIdentifier(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const url = new URL(trimmed);
        let normalized = url.href.split('#')[0];
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        return normalized.toLowerCase();
    } catch {
        return trimmed.toLowerCase();
    }
}

export function storyIdentifiersFromArticle(article) {
    return [article?.url, article?.hn_url].map(normalizeStoryIdentifier).filter(Boolean);
}

/**
 * URLs / HN discussion links from the most recent non-backfilled live editorials.
 */
export function readRecentLiveStoryIdentifiers(cacheDir, { maxEditorials = 5 } = {}) {
    const excluded = new Set();
    const names = listPublicEditorialCacheFileNames(cacheDir).sort((a, b) => b.localeCompare(a));

    let collected = 0;
    for (const name of names) {
        if (collected >= maxEditorials) {
            break;
        }
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(cacheDir, name), 'utf8'));
        } catch {
            continue;
        }
        const article = data?.[0]?.article;
        if (!article || article.backfilled) {
            continue;
        }
        for (const id of storyIdentifiersFromArticle(article)) {
            excluded.add(id);
        }
        collected += 1;
    }
    return excluded;
}

export function filterExcludedStoryCandidates(candidates, excluded) {
    if (!excluded?.size || !candidates?.length) {
        return candidates ?? [];
    }
    return candidates.filter((candidate) => {
        const ids = storyIdentifiersFromArticle(candidate);
        return !ids.some((id) => excluded.has(id));
    });
}
