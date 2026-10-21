import { mergeCandidates } from './normalize.js';
import { hnProvider } from './hn.js';
import { thenewsapiProvider } from './thenewsapi.js';
import { KEYLESS_QUERIES, bingnewsProvider, ddgProvider, gnewsProvider } from './keyless.js';
import { isNewsQuotaExhaustedResponse, mapAxiosNewsApiError, NewsQuotaExhaustedError } from '../newsApiErrors.js';

/**
 * Multi-provider news candidate sources.
 *
 * Provider interface:
 *   {
 *     name: string,
 *     isAvailable(env): { ok: boolean, reason?: string },
 *     fetchCandidates(ctx): Promise<{ candidates: NormalizedCandidate[], requests: number }>
 *   }
 * ctx: { asOfDate, httpGet({url,params}) (axios-style), fetchImpl (fetch-style), log, env }
 */

export const PROVIDERS = {
    hn: hnProvider,
    thenewsapi: thenewsapiProvider,
    ddg: ddgProvider,
    gnews: gnewsProvider,
    bingnews: bingnewsProvider,
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * Parse NEWS_PROVIDERS (e.g. "hn,thenewsapi,ddg"). Unset/blank => null (legacy NEWS_SOURCE path, default hn only).
 * @returns {string[]|null}
 */
export function parseNewsProviders(raw = process.env.NEWS_PROVIDERS) {
    if (raw == null || !String(raw).trim()) {
        return null;
    }
    const names = [];
    for (const part of String(raw).split(',')) {
        const name = part.trim().toLowerCase();
        if (!name) continue;
        if (!PROVIDERS[name]) {
            throw new Error(`Invalid NEWS_PROVIDERS entry "${part.trim()}" (expected ${PROVIDER_NAMES.join(', ')})`);
        }
        if (!names.includes(name)) names.push(name);
    }
    if (!names.length) {
        throw new Error(`NEWS_PROVIDERS is set but empty (expected ${PROVIDER_NAMES.join(', ')})`);
    }
    return names;
}

/** hn-only (or unset) keeps the original HN code path unchanged. */
export function isMultiProviderConfig(names) {
    return Array.isArray(names) && !(names.length === 1 && names[0] === 'hn');
}

const KEYLESS_NAMES = new Set(['ddg', 'gnews', 'bingnews']);

/** Upstream request cost of one provider run (hn 1, thenewsapi 1, keyless = one per query; keyless is live-only). */
export function providerRequestCost(name, { asOfDate = null } = {}) {
    if (KEYLESS_NAMES.has(name)) return asOfDate ? 0 : KEYLESS_QUERIES.length;
    return 1;
}

function isQuotaFailure(reason) {
    if (!reason) return false;
    if (reason instanceof NewsQuotaExhaustedError || reason.code === 'NEWS_QUOTA_EXHAUSTED') return true;
    return isNewsQuotaExhaustedResponse(reason.response?.status, reason.response?.data);
}

function requestBudgetError(requests = 0) {
    const err = new Error('The news request budget was exhausted for this editorial');
    err.statusCode = 503;
    err.code = 'NEWS_REQUEST_BUDGET_EXHAUSTED';
    err.clientError = 'news_request_budget_exhausted';
    err.newsRequestCount = requests;
    return err;
}

/**
 * Run the selected providers together, merge and dedupe by normalized URL.
 * maxNewsRequests caps upstream requests: providers/queries are started in order only while they fit the budget.
 * A failing provider is logged and ignored (a quota error is rethrown when no provider returned candidates); a provider without its key is skipped with a log line.
 */
export async function fetchCandidatesFromProviders({
    names,
    asOfDate = null,
    httpGet,
    fetchImpl = fetch,
    log = () => {},
    env = process.env,
    registry = PROVIDERS,
    maxNewsRequests = Infinity,
}) {
    const budgetLimited = Number.isFinite(maxNewsRequests);
    let remaining = budgetLimited ? Math.max(0, maxNewsRequests) : Infinity;
    const queriesFor = new Map();
    let skippedForBudget = 0;
    const active = [];
    for (const name of names) {
        const provider = registry[name];
        const availability = provider.isAvailable(env);
        if (!availability.ok) {
            log(JSON.stringify({ event: 'news_provider_skipped', provider: name, reason: availability.reason }));
            continue;
        }
        const cost = providerRequestCost(name, { asOfDate });
        if (cost > remaining) {
            if (KEYLESS_NAMES.has(name) && remaining > 0) {
                queriesFor.set(provider, KEYLESS_QUERIES.slice(0, remaining));
                remaining = 0;
                active.push(provider);
                continue;
            }
            skippedForBudget += 1;
            log(JSON.stringify({ event: 'news_provider_skipped', provider: name, reason: 'request_budget' }));
            continue;
        }
        remaining -= cost;
        active.push(provider);
    }
    if (budgetLimited && active.length === 0 && skippedForBudget > 0) {
        throw requestBudgetError(0);
    }

    const settled = await Promise.allSettled(
        active.map((p) =>
            p.fetchCandidates({
                asOfDate,
                httpGet,
                fetchImpl,
                log,
                env,
                ...(queriesFor.has(p) ? { queries: queriesFor.get(p) } : {}),
            })
        )
    );

    const lists = [];
    const counts = {};
    let requests = 0;
    let quotaFailure = null;
    settled.forEach((result, i) => {
        const name = active[i].name;
        if (result.status === 'fulfilled') {
            lists.push(result.value.candidates);
            counts[name] = result.value.candidates.length;
            requests += result.value.requests || 0;
        } else {
            counts[name] = 0;
            if (isQuotaFailure(result.reason)) {
                quotaFailure = quotaFailure || result.reason;
                log(JSON.stringify({ event: 'news_provider_quota_exhausted', provider: name, error: result.reason?.message || String(result.reason) }));
            }
            log(JSON.stringify({ event: 'news_provider_failed', provider: name, error: result.reason?.message || String(result.reason) }));
        }
    });

    const candidates = mergeCandidates(lists);
    if (quotaFailure && candidates.length === 0) {
        const err =
            quotaFailure instanceof NewsQuotaExhaustedError || quotaFailure.code === 'NEWS_QUOTA_EXHAUSTED'
                ? quotaFailure
                : mapAxiosNewsApiError(quotaFailure, { asOfDate });
        err.newsRequestCount = requests;
        throw err;
    }
    const contributing = names.filter((n) => candidates.some((c) => c.providers.includes(n)));
    const newsSource = (contributing.length ? contributing : names).join('+');
    log(
        JSON.stringify({
            event: 'news_providers_fetched',
            news_source: newsSource,
            as_of: asOfDate,
            per_provider: counts,
            merged_count: candidates.length,
        })
    );
    return { candidates, requests, counts, newsSource };
}

export { mergeCandidates, normalizeUrl, makeCandidate } from './normalize.js';
