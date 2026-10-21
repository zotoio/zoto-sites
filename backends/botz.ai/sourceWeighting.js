import { KEYWORD_SCORE_CAP } from './keywordWeights.js';
import { keywordScoreForArticle } from './storySelection.js';

/**
 * Cross-provider source weighting: decides which candidates make the top-N cap sent to LLM scoring.
 *
 *   base     = W_KEYWORD*keyword + W_RECENCY*recency + W_ENGAGEMENT*engagement        (each component 0..1)
 *   priority = base * providerWeight + authorityBonus (non-HN only) + multiProviderBonus
 *
 *   keyword    = keywordScore / KEYWORD_SCORE_CAP
 *   recency    = 0.5 ^ (ageHours / halfLifeHours)        (missing/invalid published_at => RECENCY_MISSING)
 *   engagement = min(1, (log1p(points) + 0.5*log1p(comments)) / ENGAGEMENT_REF)   (HN only; others 0)
 *                HN-gravity-style time decay comes from the recency term, so it is not applied twice.
 *   multiProviderBonus = min(MULTI_PROVIDER_BONUS_MAX, MULTI_PROVIDER_BONUS * (distinctProviders - 1)),
 *                providers unioned across candidates with the same URL (dedupe merge) or the same normalized title.
 *
 * Every constant below is the default; the env vars in resolveWeightingConfig() override them.
 */

export const DEFAULT_PROVIDER_WEIGHTS = { hn: 1.0, thenewsapi: 0.9, thenewstack: 0.9, gnews: 0.8, bingnews: 0.8, ddg: 0.7 };
export const DEFAULT_UNKNOWN_PROVIDER_WEIGHT = 0.7;
export const DEFAULT_COMPONENT_WEIGHTS = { keyword: 0.45, recency: 0.3, engagement: 0.25 };
export const DEFAULT_RECENCY_HALF_LIFE_HOURS = 12;
export const RECENCY_MISSING = 0.25; // neutral-low score when published_at is absent/unparseable
export const ENGAGEMENT_REF = Math.log1p(500) + 0.5 * Math.log1p(300); // ~9.08: 500 points + 300 comments => 1.0
export const DEFAULT_AUTHORITY_BONUS = 0.05;
export const DEFAULT_MULTI_PROVIDER_BONUS = 0.05; // per extra provider
export const MULTI_PROVIDER_BONUS_MAX = 0.15;
export const DEFAULT_AUTHORITY_DOMAINS = [
    'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'theverge.com', 'arstechnica.com', 'techcrunch.com',
    'wired.com', 'nytimes.com', 'ft.com', 'bloomberg.com', 'technologyreview.com', 'anthropic.com',
    'openai.com', 'deepmind.google', 'thenewstack.io',
];

function num(raw, fallback, { min = -Infinity } = {}) {
    if (raw == null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fallback;
}

function parsePairs(raw, base) {
    const out = { ...base };
    if (!raw || !String(raw).trim()) return out;
    for (const part of String(raw).split(',')) {
        const [k, v] = part.split('=').map((s) => s.trim());
        const n = Number(v);
        if (k && v !== '' && Number.isFinite(n) && n >= 0) out[k.toLowerCase()] = n;
    }
    return out;
}

/**
 * Env overrides:
 *   SOURCE_WEIGHTS="hn=1.0,gnews=0.6"             per-provider base weights (merged over defaults)
 *   SOURCE_RECENCY_HALF_LIFE_HOURS=12             (> 0)
 *   SOURCE_COMPONENT_WEIGHTS="keyword=0.45,recency=0.3,engagement=0.25"
 *   SOURCE_AUTHORITY_BONUS=0.05                   SOURCE_AUTHORITY_DOMAINS="a.com,b.com" (replaces the default list)
 *   SOURCE_MULTI_PROVIDER_BONUS=0.05              per extra provider, capped at MULTI_PROVIDER_BONUS_MAX
 */
export function resolveWeightingConfig(env = process.env) {
    const domains = String(env.SOURCE_AUTHORITY_DOMAINS || '')
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
    return {
        providerWeights: parsePairs(env.SOURCE_WEIGHTS, DEFAULT_PROVIDER_WEIGHTS),
        componentWeights: parsePairs(env.SOURCE_COMPONENT_WEIGHTS, DEFAULT_COMPONENT_WEIGHTS),
        halfLifeHours: num(env.SOURCE_RECENCY_HALF_LIFE_HOURS, DEFAULT_RECENCY_HALF_LIFE_HOURS, { min: Number.MIN_VALUE }),
        authorityBonus: num(env.SOURCE_AUTHORITY_BONUS, DEFAULT_AUTHORITY_BONUS, { min: 0 }),
        authorityDomains: domains.length ? domains : DEFAULT_AUTHORITY_DOMAINS,
        multiProviderBonus: num(env.SOURCE_MULTI_PROVIDER_BONUS, DEFAULT_MULTI_PROVIDER_BONUS, { min: 0 }),
    };
}

export function recencyScore(publishedAt, { now = Date.now(), halfLifeHours = DEFAULT_RECENCY_HALF_LIFE_HOURS } = {}) {
    const t = publishedAt ? new Date(publishedAt).getTime() : NaN;
    if (!Number.isFinite(t)) return RECENCY_MISSING;
    const ageHours = Math.max(0, (now - t) / 3_600_000); // future dates count as brand new
    return Math.pow(0.5, ageHours / halfLifeHours);
}

export function engagementScore(candidate) {
    if (candidate.provider !== 'hn') return 0;
    const points = Math.max(0, Number(candidate.points) || 0);
    const comments = Math.max(0, Number(candidate.num_comments) || 0);
    return Math.min(1, (Math.log1p(points) + 0.5 * Math.log1p(comments)) / ENGAGEMENT_REF);
}

function hostOf(candidate) {
    const fromSource = String(candidate.source || '').toLowerCase().replace(/^www\./, '');
    let fromUrl = '';
    try {
        fromUrl = new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        // ignore
    }
    return [fromUrl, fromSource].filter(Boolean);
}

export function isAuthoritySource(candidate, domains = DEFAULT_AUTHORITY_DOMAINS) {
    if (candidate.provider === 'hn') return false;
    return hostOf(candidate).some((h) => domains.some((d) => h === d || h.endsWith(`.${d}`)));
}

const titleKey = (t) =>
    String(t || '').toLowerCase().replace(/\s+[-|–—]\s+[^-|–—]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Distinct provider count per candidate, unioned over same-title candidates (URL dupes are already merged). */
function providerCounts(candidates) {
    const byTitle = new Map();
    for (const c of candidates) {
        const key = titleKey(c.title);
        if (key.length < 12) continue;
        if (!byTitle.has(key)) byTitle.set(key, new Set());
        for (const p of c.providers || [c.provider]) byTitle.get(key).add(p);
    }
    return candidates.map((c) => {
        const own = new Set(c.providers || [c.provider]);
        const key = titleKey(c.title);
        for (const p of byTitle.get(key) || []) own.add(p);
        own.delete(undefined);
        return Math.max(1, own.size);
    });
}

export function computePriorities(candidates, { env = process.env, now = Date.now(), config = resolveWeightingConfig(env) } = {}) {
    const counts = providerCounts(candidates);
    return candidates.map((candidate, i) => {
        const keyword = Math.min(1, Math.max(0, keywordScoreForArticle(candidate).score / KEYWORD_SCORE_CAP));
        const recency = recencyScore(candidate.published_at, { now, halfLifeHours: config.halfLifeHours });
        const engagement = engagementScore(candidate);
        const cw = config.componentWeights;
        const base = cw.keyword * keyword + cw.recency * recency + cw.engagement * engagement;
        const providerWeight = config.providerWeights[candidate.provider] ?? DEFAULT_UNKNOWN_PROVIDER_WEIGHT;
        const authority = isAuthoritySource(candidate, config.authorityDomains) ? config.authorityBonus : 0;
        const multi = Math.min(MULTI_PROVIDER_BONUS_MAX, config.multiProviderBonus * (counts[i] - 1));
        const priority = base * providerWeight + authority + multi;
        const r = (x) => Math.round(x * 10000) / 10000;
        return {
            candidate,
            priority: r(priority),
            components: { keyword: r(keyword), recency: r(recency), engagement: r(engagement), base: r(base), provider_weight: providerWeight, authority, multi_provider: r(multi), provider_count: counts[i] },
        };
    });
}

/** Sort by priority (desc; ties: engagement, then original order) and keep the top `maxToScore`. */
export function selectTopByPriority(candidates, { maxToScore = 25, env = process.env, now = Date.now(), log = () => {} } = {}) {
    const ranked = computePriorities(candidates, { env, now })
        .map((r, idx) => ({ ...r, idx }))
        .sort((a, b) => b.priority - a.priority || (b.candidate.engagement || 0) - (a.candidate.engagement || 0) || a.idx - b.idx);
    log(
        JSON.stringify({
            event: 'source_weighting_top',
            items: ranked.slice(0, 5).map((r) => ({ url: r.candidate.url, provider: r.candidate.provider, priority: r.priority, components: r.components })),
        })
    );
    return ranked.slice(0, maxToScore).map((r) => r.candidate);
}
