import {
    historicalPageSequence,
    livePageSequence,
    NEWS_CANDIDATE_LIMIT_PER_REQUEST,
} from './newsFetchPlan.js';
import { buildTopNewsParams, TOP_NEWS_URL } from './newsApi.js';
import { mapAxiosNewsApiError, noQualifyingStoryError } from './newsApiErrors.js';
import {
    buildGenAiNewsSearchQuery,
    GENAI_NEWS_CATEGORIES,
    selectBestQualifyingStory,
} from './storySelection.js';

/** @type {Map<string, { pool: object[], fetchedPages: Set<number> }>} */
const candidatesByDayKey = new Map();

export function resetNewsCandidateCache() {
    candidatesByDayKey.clear();
}

export function getNewsCandidateCacheKey(asOfDate, isWeekend) {
    if (asOfDate) {
        return `historical:${asOfDate}`;
    }
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    return `live:${y}-${m}-${d}:weekend=${isWeekend ? 1 : 0}`;
}

function getOrCreateDayState(cacheKey) {
    if (!candidatesByDayKey.has(cacheKey)) {
        candidatesByDayKey.set(cacheKey, { pool: [], fetchedPages: new Set() });
    }
    return candidatesByDayKey.get(cacheKey);
}

/**
 * @param {object} opts
 * @param {string|null} opts.asOfDate
 * @param {boolean} opts.isWeekend
 * @param {string} opts.newsApiKey
 * @param {(config: { url: string, params: object }) => Promise<{ data?: { data?: object[] } }>} opts.httpGet
 * @param {(article: object) => Promise<string>} opts.scoreArticle
 * @param {(msg: string) => void} [opts.log]
 * @param {number} [opts.maxNewsRequests]
 */
export async function fetchQualifyingStoryForEditorial({
    asOfDate = null,
    isWeekend = false,
    newsApiKey,
    httpGet,
    scoreArticle,
    log = () => {},
    maxNewsRequests = Infinity,
}) {
    const cacheKey = getNewsCandidateCacheKey(asOfDate, isWeekend);
    const pages = asOfDate ? historicalPageSequence() : livePageSequence(isWeekend);
    const state = getOrCreateDayState(cacheKey);

    let newsRequestCount = 0;

    for (const page of pages) {
        if (!state.fetchedPages.has(page)) {
            if (newsRequestCount >= maxNewsRequests) {
                const err = new Error('The News API request budget was exhausted for this editorial');
                err.statusCode = 503;
                err.code = 'NEWS_REQUEST_BUDGET_EXHAUSTED';
                err.clientError = 'news_request_budget_exhausted';
                throw err;
            }

            const params = buildTopNewsParams({
                apiToken: newsApiKey,
                search: buildGenAiNewsSearchQuery(),
                language: 'en',
                limit: NEWS_CANDIDATE_LIMIT_PER_REQUEST,
                page,
                asOfDate,
                categories: GENAI_NEWS_CATEGORIES,
            });

            let response;
            try {
                response = await httpGet({ url: TOP_NEWS_URL, params });
            } catch (error) {
                throw mapAxiosNewsApiError(error, { asOfDate });
            }
            newsRequestCount += 1;
            state.fetchedPages.add(page);

            const batch = response.data?.data || [];
            if (batch.length === 0 && state.pool.length === 0 && page === pages[0]) {
                log(
                    JSON.stringify({
                        event: 'no_qualifying_story',
                        reason: 'no_articles',
                        as_of: asOfDate,
                        page,
                    })
                );
                throw noQualifyingStoryError(
                    'no_articles',
                    'No news articles returned for the requested period'
                );
            }

            state.pool.push(...batch);
        }

        const selected = await selectBestQualifyingStory(state.pool, {
            scoreArticle,
            log,
        });
        if (selected) {
            return { article: selected, newsRequestCount, candidateCount: state.pool.length };
        }
    }

    log(
        JSON.stringify({
            event: 'no_qualifying_story',
            reason: 'no_match',
            as_of: asOfDate,
            candidate_count: state.pool.length,
        })
    );
    throw noQualifyingStoryError('no_match', 'No qualifying GenAI news story for the requested period');
}
