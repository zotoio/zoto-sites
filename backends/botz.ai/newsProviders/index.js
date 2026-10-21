import { mergeCandidates } from './normalize.js';
import { hnProvider } from './hn.js';
import { thenewsapiProvider } from './thenewsapi.js';
import { bingnewsProvider, ddgProvider, gnewsProvider } from './keyless.js';

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

/**
 * Run the selected providers together, merge and dedupe by normalized URL.
 * A failing provider is logged and ignored; a provider without its key is skipped with a log line.
 */
export async function fetchCandidatesFromProviders({
    names,
    asOfDate = null,
    httpGet,
    fetchImpl = fetch,
    log = () => {},
    env = process.env,
    registry = PROVIDERS,
}) {
    const active = [];
    for (const name of names) {
        const provider = registry[name];
        const availability = provider.isAvailable(env);
        if (!availability.ok) {
            log(JSON.stringify({ event: 'news_provider_skipped', provider: name, reason: availability.reason }));
            continue;
        }
        active.push(provider);
    }

    const settled = await Promise.allSettled(
        active.map((p) => p.fetchCandidates({ asOfDate, httpGet, fetchImpl, log, env }))
    );

    const lists = [];
    const counts = {};
    let requests = 0;
    settled.forEach((result, i) => {
        const name = active[i].name;
        if (result.status === 'fulfilled') {
            lists.push(result.value.candidates);
            counts[name] = result.value.candidates.length;
            requests += result.value.requests || 0;
        } else {
            counts[name] = 0;
            log(JSON.stringify({ event: 'news_provider_failed', provider: name, error: result.reason?.message || String(result.reason) }));
        }
    });

    const candidates = mergeCandidates(lists);
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
