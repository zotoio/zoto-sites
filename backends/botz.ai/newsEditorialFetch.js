import { fetchQualifyingStoryFromHn, resetHnCandidateCache } from './hnEditorialFetch.js';
import {
    fetchQualifyingStoryFromThenewsapi,
    resetThenewsapiCandidateCache,
} from './thenewsapiEditorialFetch.js';
import { parseNewsSource } from './newsSourceConfig.js';

export function resetNewsCandidateCache() {
    resetThenewsapiCandidateCache();
    resetHnCandidateCache();
}

export function getNewsCandidateCacheKey(asOfDate, isWeekend) {
    const source = parseNewsSource();
    if (source === 'hn') {
        return asOfDate ? `hn:historical:${asOfDate}` : `hn:live`;
    }
    if (asOfDate) {
        return `historical:${asOfDate}`;
    }
    return `live:weekend=${isWeekend ? 1 : 0}`;
}

/**
 * @param {object} opts
 * @param {'hn'|'thenewsapi'} [opts.newsSource]
 */
export async function fetchQualifyingStoryForEditorial(opts) {
    const newsSource = opts.newsSource || parseNewsSource();
    if (newsSource === 'hn') {
        return fetchQualifyingStoryFromHn(opts);
    }
    return fetchQualifyingStoryFromThenewsapi(opts);
}
