/**
 * Jev pre-filter: classify merged provider candidates (title + snippet + source + url) BEFORE any article page
 * fetch, so rejected candidates never cost a page fetch. Used only when a Jev classifier exists (TYPESAFE_API_KEY).
 */
import { KEYWORD_SCORE_CAP, scoreKeywords } from './keywordWeights.js';
import { COMBINED_PASS_THRESHOLD, combineScores } from './jevClassifier.js';
import { articleTextForMatching, isSensitiveHarmText } from './storySelection.js';

export const DEFAULT_JEV_PREFILTER_CONCURRENCY = 5;

/** Marks candidates Jev already accepted, so the later keyword gate does not re-judge (or re-call Jev). */
export const JEV_PREFILTERED = Symbol.for('botz.jevPrefiltered');

export function jevPrefilterThreshold(env = process.env) {
    const n = Number(env.JEV_PREFILTER_THRESHOLD);
    return env.JEV_PREFILTER_THRESHOLD && Number.isFinite(n) && n >= 0 && n <= 1 ? n : COMBINED_PASS_THRESHOLD;
}

export function jevPrefilterConcurrency(env = process.env) {
    const n = Math.floor(Number(env.JEV_PREFILTER_CONCURRENCY));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_JEV_PREFILTER_CONCURRENCY;
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return out;
}

/**
 * @returns {Promise<{ kept: object[], stats: object }>} kept = Jev-accepted (flagged) + Jev-errored (unflagged,
 * keyword gate applies after fetch). Rejected = sensitive-harm text or combined score below threshold.
 */
export async function jevPrefilterCandidates(candidates, { jevClassifier, env = process.env, log = () => {} }) {
    const started = Date.now();
    const threshold = jevPrefilterThreshold(env);
    const limit = jevPrefilterConcurrency(env);
    let errors = 0;
    let passed = 0;
    const verdicts = await mapLimit(candidates, limit, async (c) => {
        const text = articleTextForMatching(c);
        if (!text || isSensitiveHarmText(text)) return 'reject';
        let jev = null;
        try {
            jev = await jevClassifier(c);
        } catch (error) {
            errors++;
            log(`jev_prefilter: failed for ${c.url} (${error.message}); falling back to keyword rule`);
        }
        if (typeof jev !== 'number') return 'keep_unflagged';
        const combined = combineScores({ keywordScore: scoreKeywords(c).score, keywordCap: KEYWORD_SCORE_CAP, jev });
        return combined >= threshold ? 'pass' : 'reject';
    });
    const kept = [];
    candidates.forEach((c, i) => {
        if (verdicts[i] === 'pass') {
            passed++;
            kept.push({ ...c, [JEV_PREFILTERED]: true });
        } else if (verdicts[i] === 'keep_unflagged') {
            kept.push(c);
        }
    });
    const stats = {
        event: 'jev_prefilter',
        candidates_in: candidates.length,
        passed,
        rejected: verdicts.filter((v) => v === 'reject').length,
        errors,
        ms: Date.now() - started,
    };
    log(JSON.stringify(stats));
    return { kept, stats };
}
