import { fetchQualifyingStoryFromHn, resetHnCandidateCache } from './hnEditorialFetch.js';
import {
    fetchQualifyingStoryFromThenewsapi,
    resetThenewsapiCandidateCache,
} from './thenewsapiEditorialFetch.js';
import { parseNewsSource } from './newsSourceConfig.js';
import { fetchQualifyingStoryFromProviders } from './multiProviderEditorialFetch.js';
import { isMultiProviderConfig } from './newsProviders/index.js';

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
 * @param {string[]|null} [opts.newsProviders] NEWS_PROVIDERS list; hn-only/unset keeps the original path
 */
export async function fetchQualifyingStoryForEditorial(opts) {
    if (isMultiProviderConfig(opts.newsProviders)) {
        return fetchQualifyingStoryFromProviders({
            ...opts,
            env: { ...process.env, ...(opts.newsApiKey ? { NEWS_API_KEY: opts.newsApiKey } : {}) },
        });
    }
    const newsSource = opts.newsSource || parseNewsSource();
    if (newsSource === 'hn') {
        return fetchQualifyingStoryFromHn(opts);
    }
    return fetchQualifyingStoryFromThenewsapi(opts);
}
