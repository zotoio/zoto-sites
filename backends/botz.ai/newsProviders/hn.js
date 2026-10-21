import {
    buildHnAlgoliaParams,
    HN_ALGOLIA_SEARCH_BY_DATE_URL,
    HN_ALGOLIA_SEARCH_URL,
    mapAlgoliaHitToCandidate,
} from '../hnAlgolia.js';
import { passesHnStoryTypeGate } from '../storySelection.js';
import { attempt, makeCandidate } from './normalize.js';

const HITS_PER_PAGE = 100;

/** Hacker News via Algolia (no key). Same query/params as the original HN path; page 0 only. */
export const hnProvider = {
    name: 'hn',
    isAvailable: () => ({ ok: true }),
    async fetchCandidates({ asOfDate = null, httpGet, env = process.env }) {
        const minPoints = Number(env.HN_MIN_POINTS) || 20;
        const params = buildHnAlgoliaParams({ asOfDate, minPoints, page: 0, hitsPerPage: HITS_PER_PAGE });
        const url = asOfDate ? HN_ALGOLIA_SEARCH_BY_DATE_URL : HN_ALGOLIA_SEARCH_URL;
        const response = await attempt(() => httpGet({ url, params }));
        const hits = response?.data?.hits || [];
        const candidates = hits
            .map(mapAlgoliaHitToCandidate)
            .filter(passesHnStoryTypeGate)
            .map((c) =>
                makeCandidate('hn', {
                    ...c,
                    extra: { hn_url: c.hn_url, hn_object_id: c.hn_object_id },
                })
            );
        return { candidates, requests: 1 };
    },
};
