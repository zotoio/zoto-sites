/**
 * Upstream news fetch budgeting for one editorial generation.
 *
 * HN (default, NEWS_SOURCE=hn):
 * - Historical backfill: 1 Algolia search_by_date request typical (page 2 only if none qualify).
 * - Live: 1 Algolia search request for last ~24h (optional page 2).
 * - Per-day candidate lists cached in-process for the server/backfill run.
 *
 * The News API (legacy, NEWS_SOURCE=thenewsapi):
 * - Historical: was 3 requests @8927f37 → now 1 typical (limit 25), 2 worst case.
 * - Live: 1 typical, 2 worst case on weekends.
 */

export const NEWS_CANDIDATE_LIMIT_PER_REQUEST = 25;

export const NEWS_REQUEST_PROFILE = {
    hn: {
        historicalPerEditorialTypical: 1,
        historicalPerEditorialWorstCase: 2,
        liveTypicalPerEditorial: 1,
        liveWeekendPerEditorialWorstCase: 2,
    },
    thenewsapi: {
        before: {
            historicalPerEditorial: 3,
            liveTypicalPerEditorial: 1,
            liveWeekendPerEditorial: 2,
        },
        after: {
            historicalPerEditorialWorstCase: 2,
            historicalPerEditorialTypical: 1,
            liveTypicalPerEditorial: 1,
            liveWeekendPerEditorialWorstCase: 2,
        },
    },
};

export function plannedMaxNewsRequests({ newsSource = 'hn', asOfDate = null, isWeekend = false }) {
    if (newsSource === 'hn') {
        if (asOfDate) {
            return NEWS_REQUEST_PROFILE.hn.historicalPerEditorialWorstCase;
        }
        if (isWeekend) {
            return NEWS_REQUEST_PROFILE.hn.liveWeekendPerEditorialWorstCase;
        }
        return NEWS_REQUEST_PROFILE.hn.liveTypicalPerEditorial;
    }
    if (asOfDate) {
        return NEWS_REQUEST_PROFILE.thenewsapi.after.historicalPerEditorialWorstCase;
    }
    if (isWeekend) {
        return NEWS_REQUEST_PROFILE.thenewsapi.after.liveWeekendPerEditorialWorstCase;
    }
    return NEWS_REQUEST_PROFILE.thenewsapi.after.liveTypicalPerEditorial;
}

export function historicalPageSequence() {
    return [1, 2];
}

export function livePageSequence(isWeekend) {
    return isWeekend ? [1, 2] : [1];
}
