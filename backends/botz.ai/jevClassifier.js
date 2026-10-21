/**
 * Optional "Jev" relevance classifier (Typesafe.ai Jev / System One).
 *
 * Source of truth: github.com/zotoio/jev-feature-demo (README, packages/jev-demo/lib/*):
 *   POST {TYPESAFE_BASE_URL|https://api.typesafe.ai}/v1/systemone
 *   Authorization: Bearer <TYPESAFE_API_KEY>
 *   body: { model: "jev-latest"|"jev-1.13.0", state: <string>, questions: { <id>: { type: "noul", instructions } } }
 *   200:  { model, answers: { <id>: { type: "noul", noul: 0..1, confidence? } }, usage: { input_tokens, output_tokens } }
 * "Jev proposes, code promotes": we only use the answer as a score; our code decides.
 *
 * Enabled only when TYPESAFE_API_KEY is set. Otherwise it is skipped (with a log line) and the keyword
 * score alone decides. The classifier interface is pluggable: any `async (article) => number|null`
 * in [0,1] can be passed as `jevClassifier` to selectBestQualifyingStory.
 */

export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai';
export const JEV_SYSTEMONE_PATH = '/v1/systemone';
export const JEV_QUESTION_ID = 'relevant';
export const JEV_QUESTION =
    'Is this news item primarily about generative AI / LLM technology, AI products or models, AI research, ' +
    'AI policy, or the AI industry (as opposed to crime, general politics, markets, or an incidental AI mention)?';

export function buildJevRequest(article, { model = 'jev-latest' } = {}) {
    const state = JSON.stringify({
        title: article?.title || '',
        description: (article?.description || article?.snippet || '').slice(0, 600),
        source: article?.source || '',
        url: article?.url || '',
    });
    return {
        model,
        state,
        questions: { [JEV_QUESTION_ID]: { type: 'noul', instructions: JEV_QUESTION } },
    };
}

/** @returns {number|null} probability 0..1 or null if the response is unusable */
export function parseJevResponse(body) {
    const answer = body?.answers?.[JEV_QUESTION_ID];
    if (!answer || answer.type !== 'noul') return null;
    const value = Number(answer.noul);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/**
 * @returns {null | ((article: object) => Promise<number|null>)} null when TYPESAFE_API_KEY is not set
 */
export function createJevClassifierFromEnv({ env = process.env, fetchImpl = fetch, log = () => {}, timeoutMs = 8000 } = {}) {
    const apiKey = (env.TYPESAFE_API_KEY || '').trim();
    if (!apiKey) {
        log(JSON.stringify({ event: 'jev_classifier_skipped', reason: 'TYPESAFE_API_KEY not set' }));
        return null;
    }
    const baseUrl = (env.TYPESAFE_BASE_URL || JEV_DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = env.JEV_MODEL || 'jev-latest';
    return async (article) => {
        const response = await fetchImpl(`${baseUrl}${JEV_SYSTEMONE_PATH}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(buildJevRequest(article, { model })),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`jev_http_${response.status}`);
        }
        return parseJevResponse(await response.json());
    };
}

/** Combination weights (documented in README). */
export const JEV_WEIGHT = 0.6;
export const KEYWORD_WEIGHT = 0.4;
export const COMBINED_PASS_THRESHOLD = 0.35;

/**
 * combined = 0.4 * (keywordScore / KEYWORD_SCORE_CAP) + 0.6 * jevProbability; pass when >= 0.35.
 * Jev can rescue a zero-keyword story (p >= 0.59) and veto a weak keyword hit (kw=2 needs p >= 0.45).
 */
export function combineScores({ keywordScore, keywordCap, jev }) {
    const kw = Math.min(keywordScore, keywordCap) / keywordCap;
    return KEYWORD_WEIGHT * kw + JEV_WEIGHT * jev;
}
