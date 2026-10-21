import { buildTopNewsParams, TOP_NEWS_URL } from '../newsApi.js';
import { NEWS_CANDIDATE_LIMIT_PER_REQUEST } from '../newsFetchPlan.js';
import { buildGenAiNewsSearchQuery, GENAI_NEWS_CATEGORIES } from '../storySelection.js';
import { attempt, makeCandidate } from './normalize.js';

/**
 * Legacy The News API provider (GET https://api.thenewsapi.com/v1/news/top, api_token=NEWS_API_KEY).
 * Skipped cleanly when NEWS_API_KEY is missing.
 */
export const thenewsapiProvider = {
    name: 'thenewsapi',
    isAvailable(env = process.env) {
        return env.NEWS_API_KEY ? { ok: true } : { ok: false, reason: 'missing NEWS_API_KEY' };
    },
    async fetchCandidates({ asOfDate = null, httpGet, env = process.env }) {
        const params = buildTopNewsParams({
            apiToken: env.NEWS_API_KEY,
            search: buildGenAiNewsSearchQuery(),
            language: 'en',
            limit: NEWS_CANDIDATE_LIMIT_PER_REQUEST,
            page: 1,
            asOfDate,
            categories: GENAI_NEWS_CATEGORIES,
        });
        const response = await attempt(() => httpGet({ url: TOP_NEWS_URL, params }));
        const items = Array.isArray(response?.data?.data) ? response.data.data : [];
        const candidates = items.map((item) =>
            makeCandidate('thenewsapi', {
                title: item.title,
                url: item.url,
                source: item.source,
                published_at: item.published_at,
                snippet: item.snippet || item.description,
                description: item.description || item.snippet,
                extra: { uuid: item.uuid, categories: item.categories, image_url: item.image_url },
            })
        );
        return { candidates, requests: 1 };
    },
};
