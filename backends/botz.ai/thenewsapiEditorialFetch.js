import {
    historicalPageSequence,
    livePageSequence,
    NEWS_CANDIDATE_LIMIT_PER_REQUEST,
} from './newsFetchPlan.js';
import { buildTopNewsParams, TOP_NEWS_URL } from './newsApi.js';
import { mapAxiosNewsApiError, noQualifyingStoryError } from './newsApiErrors.js';
import { filterExcludedStoryCandidates } from './liveStoryDedup.js';
import {
    buildGenAiNewsSearchQuery,
    GENAI_NEWS_CATEGORIES,
    selectBestQualifyingStory,
} from './storySelection.js';

/** @type {Map<string, { pool: object[], fetchedPages: Set<number> }>} */
const candidatesByDayKey = new Map();

export function resetThenewsapiCandidateCache() {
    candidatesByDayKey.clear();
}

export function getThenewsapiCandidateCacheKey(asOfDate) {
    if (!asOfDate) {
        return null;
    }
    return `historical:${asOfDate}`;
}

function createEphemeralFetchState() {
    return { pool: [], fetchedPages: new Set() };
}

function getOrCreateHistoricalState(cacheKey) {
    if (!candidatesByDayKey.has(cacheKey)) {
        candidatesByDayKey.set(cacheKey, createEphemeralFetchState());
    }
    return candidatesByDayKey.get(cacheKey);
}

export async function fetchQualifyingStoryFromThenewsapi({
    asOfDate = null,
    isWeekend = false,
    newsApiKey,
    httpGet,
    scoreArticle,
    log = () => {},
    maxNewsRequests = Infinity,
    excludeStoryIdentifiers = null,
}) {
    const pages = asOfDate ? historicalPageSequence() : livePageSequence(isWeekend);
    const state = asOfDate
        ? getOrCreateHistoricalState(getThenewsapiCandidateCacheKey(asOfDate))
        : createEphemeralFetchState();

    let newsRequestCount = 0;

    for (const page of pages) {
        if (!state.fetchedPages.has(page)) {
            if (newsRequestCount >= maxNewsRequests) {
                const err = new Error('The News API request budget was exhausted for this editorial');
                err.statusCode = 503;
                err.code = 'NEWS_REQUEST_BUDGET_EXHAUSTED';
                err.clientError = 'news_request_budget_exhausted';
                err.newsRequestCount = newsRequestCount;
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
                        news_source: 'thenewsapi',
                    })
                );
                throw noQualifyingStoryError('no_articles', 'No news articles returned for the requested period', {
                    newsRequestCount,
                });
            }

            state.pool.push(...batch);
        }

        const poolForSelection = filterExcludedStoryCandidates(state.pool, excludeStoryIdentifiers);
        const selected = await selectBestQualifyingStory(poolForSelection, {
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
            news_source: 'thenewsapi',
        })
    );
    throw noQualifyingStoryError('no_match', 'No qualifying GenAI news story for the requested period', {
        newsRequestCount,
    });
}
