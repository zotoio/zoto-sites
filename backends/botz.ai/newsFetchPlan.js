/**
 * The News API request budgeting for one editorial generation.
 *
 * BEFORE (main @ 8927f37):
 * - Backfill / historical (asOf set): 3 HTTP requests (pages 1–3, limit 10 each).
 * - Live hourly: PAGE_COUNT requests (default 1), ×2 on weekends → up to 2 requests.
 *
 * AFTER (this change):
 * - Historical: 1 request with limit 25; optional page 2 only if page 1 returned articles but none qualified.
 * - Live: 1 request limit 25; optional page 2 on weekends only if none qualified after page 1.
 * - Stops paging once a qualifying story is selected; caches raw candidates per calendar day in-process.
 */

export const NEWS_CANDIDATE_LIMIT_PER_REQUEST = 25;

export const NEWS_REQUEST_PROFILE = {
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
};

export function plannedMaxNewsRequests({ asOfDate = null, isWeekend = false }) {
    if (asOfDate) {
        return NEWS_REQUEST_PROFILE.after.historicalPerEditorialWorstCase;
    }
    if (isWeekend) {
        return NEWS_REQUEST_PROFILE.after.liveWeekendPerEditorialWorstCase;
    }
    return NEWS_REQUEST_PROFILE.after.liveTypicalPerEditorial;
}

export function historicalPageSequence() {
    return [1, 2];
}

export function livePageSequence(isWeekend) {
    return isWeekend ? [1, 2] : [1];
}
