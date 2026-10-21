import { enrichCandidatesInBatches } from './hnEditorialFetch.js';
import { filterExcludedStoryCandidates } from './liveStoryDedup.js';
import { noQualifyingStoryError } from './newsApiErrors.js';
import { fetchCandidatesFromProviders } from './newsProviders/index.js';
import {
    keywordScoreForArticle,
    passesHnStoryTypeGate,
    selectBestQualifyingStory,
} from './storySelection.js';

const MAX_TO_SCORE = 25;

/**
 * Pre-rank merged candidates: keyword score first (non-HN candidates carry no points), then engagement.
 * Cap matches the existing HN path (25) so downstream LLM scoring cost is unchanged.
 */
export function prepareMergedCandidatesForScoring(candidates, { maxToScore = MAX_TO_SCORE } = {}) {
    return [...candidates]
        .map((c) => ({ c, kw: keywordScoreForArticle(c).score }))
        .sort((a, b) => b.kw - a.kw || (b.c.engagement || 0) - (a.c.engagement || 0))
        .slice(0, maxToScore)
        .map(({ c }) => c);
}

/**
 * Multi-provider path (NEWS_PROVIDERS): fetch selected providers together, merge + dedupe by normalized URL,
 * then the unchanged selection pipeline (enrichment, keyword/Jev gate, LLM scoring, engagement tie-break).
 */
export async function fetchQualifyingStoryFromProviders({
    newsProviders,
    asOfDate = null,
    httpGet,
    fetchImpl = fetch,
    scoreArticle,
    log = () => {},
    env = process.env,
    enrichDeps = {},
    excludeStoryIdentifiers = null,
    jevClassifier,
}) {
    const { candidates, requests, counts, newsSource } = await fetchCandidatesFromProviders({
        names: newsProviders,
        asOfDate,
        httpGet,
        fetchImpl,
        log,
        env,
    });

    if (candidates.length === 0) {
        log(JSON.stringify({ event: 'no_qualifying_story', reason: 'no_articles', as_of: asOfDate, news_source: newsSource }));
        throw noQualifyingStoryError('no_articles', 'No news candidates returned by the selected providers', {
            newsRequestCount: requests,
        });
    }

    const raw = filterExcludedStoryCandidates(candidates.filter(passesHnStoryTypeGate), excludeStoryIdentifiers);
    const toEnrich = prepareMergedCandidatesForScoring(raw);
    // Candidates that already have a snippet (news APIs / RSS) skip the extra page fetch.
    const needEnrich = toEnrich.filter((c) => !c.snippet);
    const enriched = await enrichCandidatesInBatches(needEnrich, { log, ...enrichDeps });
    const enrichedByUrl = new Map(enriched.map((c, i) => [needEnrich[i], c]));
    const pool = toEnrich.map((c) => enrichedByUrl.get(c) || c);

    const selected = await selectBestQualifyingStory(pool, {
        scoreArticle,
        log,
        preferEngagement: true,
        jevClassifier,
    });
    if (selected) {
        log(
            JSON.stringify({
                event: 'story_selected',
                news_source: newsSource,
                provider: selected.provider,
                providers: selected.providers,
                url: selected.url,
            })
        );
        return { article: selected, newsRequestCount: requests, candidateCount: candidates.length };
    }

    log(
        JSON.stringify({
            event: 'no_qualifying_story',
            reason: 'no_match',
            as_of: asOfDate,
            candidate_count: candidates.length,
            per_provider: counts,
            news_source: newsSource,
        })
    );
    throw noQualifyingStoryError('no_match', 'No qualifying GenAI news story for the requested period', {
        newsRequestCount: requests,
    });
}
