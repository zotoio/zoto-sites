import { enrichHnCandidate } from './articleEnrichment.js';
import {
    buildHnAlgoliaParams,
    HN_ALGOLIA_SEARCH_BY_DATE_URL,
    HN_ALGOLIA_SEARCH_URL,
    mapAlgoliaHitToCandidate,
    mergeAlgoliaPages,
} from './hnAlgolia.js';
import { noQualifyingStoryError } from './newsApiErrors.js';
import {
    passesHnStoryTypeGate,
    passesLocalAiTermGate,
    prepareHnCandidatesForScoring,
    selectBestQualifyingStory,
} from './storySelection.js';

/** @type {Map<string, { hits: object[], fetchedPages: Set<number> }>} */
const hnCandidatesByDayKey = new Map();

export function resetHnCandidateCache() {
    hnCandidatesByDayKey.clear();
}

export function getHnCandidateCacheKey(asOfDate) {
    if (asOfDate) {
        return `hn:historical:${asOfDate}`;
    }
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    return `hn:live:${y}-${m}-${d}`;
}

function getOrCreateHnState(cacheKey) {
    if (!hnCandidatesByDayKey.has(cacheKey)) {
        hnCandidatesByDayKey.set(cacheKey, { hits: [], fetchedPages: new Set() });
    }
    return hnCandidatesByDayKey.get(cacheKey);
}

const DEFAULT_MIN_POINTS = Number(process.env.HN_MIN_POINTS) || 20;
const DEFAULT_HITS_PER_PAGE = 100;
const MAX_ALGOLIA_PAGES = 2;
const ENRICH_CONCURRENCY = 3;

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAlgoliaPage({ asOfDate, page, minPoints, httpGet, log }) {
    const params = buildHnAlgoliaParams({
        asOfDate,
        minPoints,
        page,
        hitsPerPage: DEFAULT_HITS_PER_PAGE,
    });
    const url = asOfDate ? HN_ALGOLIA_SEARCH_BY_DATE_URL : HN_ALGOLIA_SEARCH_URL;
    await sleep(150);
    const response = await httpGet({ url, params });
    const hits = response.data?.hits || [];
    return hits;
}

async function enrichCandidatesInBatches(candidates, deps) {
    const out = [];
    for (let i = 0; i < candidates.length; i += ENRICH_CONCURRENCY) {
        const batch = candidates.slice(i, i + ENRICH_CONCURRENCY);
        const enriched = await Promise.all(batch.map((c) => enrichHnCandidate(c, deps)));
        out.push(...enriched);
    }
    return out;
}

export async function fetchQualifyingStoryFromHn({
    asOfDate = null,
    httpGet,
    scoreArticle,
    log = () => {},
    maxNewsRequests = Infinity,
    minPoints = DEFAULT_MIN_POINTS,
    enrichDeps = {},
}) {
    const cacheKey = getHnCandidateCacheKey(asOfDate);
    const state = getOrCreateHnState(cacheKey);
    let newsRequestCount = 0;

    for (let page = 0; page < MAX_ALGOLIA_PAGES; page++) {
        if (!state.fetchedPages.has(page)) {
            if (newsRequestCount >= maxNewsRequests) {
                const err = new Error('HN Algolia request budget was exhausted for this editorial');
                err.statusCode = 503;
                err.code = 'NEWS_REQUEST_BUDGET_EXHAUSTED';
                err.clientError = 'news_request_budget_exhausted';
                throw err;
            }
            const hits = await fetchAlgoliaPage({ asOfDate, page, minPoints, httpGet, log });
            newsRequestCount += 1;
            state.fetchedPages.add(page);
            state.hits = mergeAlgoliaPages(state.hits, hits);

            if (hits.length === 0 && state.hits.length === 0 && page === 0) {
                log(
                    JSON.stringify({
                        event: 'no_qualifying_story',
                        reason: 'no_articles',
                        as_of: asOfDate,
                        news_source: 'hn',
                    })
                );
                throw noQualifyingStoryError(
                    'no_articles',
                    'No Hacker News stories returned for the requested period'
                );
            }
        }

        const rawCandidates = state.hits
            .map(mapAlgoliaHitToCandidate)
            .filter(passesHnStoryTypeGate);

        const toEnrich = prepareHnCandidatesForScoring(rawCandidates);
        const enrichedPool = await enrichCandidatesInBatches(toEnrich, { log, ...enrichDeps });

        const selected = await selectBestQualifyingStory(enrichedPool, {
            scoreArticle,
            log,
            preferEngagement: true,
        });
        if (selected) {
            return { article: selected, newsRequestCount, candidateCount: state.hits.length };
        }

        if (state.fetchedPages.has(page + 1) || page >= MAX_ALGOLIA_PAGES - 1) {
            break;
        }
    }

    log(
        JSON.stringify({
            event: 'no_qualifying_story',
            reason: 'no_match',
            as_of: asOfDate,
            candidate_count: state.hits.length,
            news_source: 'hn',
        })
    );
    throw noQualifyingStoryError('no_match', 'No qualifying GenAI news story for the requested period');
}

/**
 * Dry-run helper: return top AI-gated HN candidates for a date (no Luna scoring).
 */
export async function listHnAiCandidatesForDate({
    asOfDate,
    httpGet,
    minPoints = DEFAULT_MIN_POINTS,
    limit = 3,
    enrichDeps = {},
}) {
    const hits = await fetchAlgoliaPage({ asOfDate, page: 0, minPoints, httpGet, log: () => {} });
    const raw = hits.map(mapAlgoliaHitToCandidate).filter(passesHnStoryTypeGate);
    const toEnrich = prepareHnCandidatesForScoring(raw, { maxToScore: 30 });
    const enriched = await enrichCandidatesInBatches(toEnrich, enrichDeps);
    const gated = enriched.filter((c) => passesLocalAiTermGate(c));
    gated.sort((a, b) => (b.points || 0) - (a.points || 0));
    return gated.slice(0, limit);
}
