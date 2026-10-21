/**
 * GenAI news story filtering and ranking (testable without network).
 */

import { KEYWORD_PASS_THRESHOLD, KEYWORD_SCORE_CAP, scoreKeywords } from './keywordWeights.js';
import { COMBINED_PASS_THRESHOLD, combineScores, createJevClassifierFromEnv } from './jevClassifier.js';

export const GENAI_NEWS_CATEGORIES = 'tech';

/** Stricter OR-search for The News API (AI vendor/product terms only). */
export function buildGenAiNewsSearchQuery() {
    return [
        'OpenAI',
        'ChatGPT',
        'GPT-4',
        'GPT-5',
        'Claude',
        'Anthropic',
        'Gemini',
        'Google DeepMind',
        'Meta AI',
        'Llama',
        'Mistral',
        'generative AI',
        'GenAI',
        'large language model',
        'LLM',
        'Sora',
        'Midjourney',
        'Stable Diffusion',
        'Copilot',
        'Hugging Face',
        'xAI',
        'Grok',
    ].join('|');
}

const SENSITIVE_HARM_PATTERN =
    /\b(sexual assault|rape|molest|murder|homicide|shooting|stabbing|kidnap|domestic violence|assault charge|crime scene)\b/i;

export function isSensitiveHarmText(text) {
    return SENSITIVE_HARM_PATTERN.test(text);
}

export function articleTextForMatching(article) {
    const title = article?.title || '';
    const description = article?.description || article?.snippet || '';
    return `${title} ${description}`.trim();
}

/** Weighted keyword score (see keywordWeights.js) over title + snippet + URL slug + domain. */
export function keywordScoreForArticle(article) {
    return scoreKeywords(article);
}

/** Keyword-only gate: sensitive-harm text is rejected, otherwise score >= KEYWORD_PASS_THRESHOLD. */
export function passesLocalAiTermGate(article) {
    const text = articleTextForMatching(article);
    if (!text) {
        return false;
    }
    if (SENSITIVE_HARM_PATTERN.test(text)) {
        return false;
    }
    return scoreKeywords(article).score >= KEYWORD_PASS_THRESHOLD;
}

/**
 * Classification + gate. Optional Jev classifier (probability 0..1) is scored BEFORE the gate decides:
 *  - no classifier / classifier error / null answer: keyword score >= KEYWORD_PASS_THRESHOLD
 *  - with Jev: 0.4 * keyword/KEYWORD_SCORE_CAP + 0.6 * jev >= COMBINED_PASS_THRESHOLD
 * Sensitive-harm text is always rejected.
 * @returns {Promise<{ passes: boolean, keywordScore: number, jev: number|null, combined: number|null, mode: string }>}
 */
export async function classifyCandidate(article, { jevClassifier = null, log = () => {} } = {}) {
    const text = articleTextForMatching(article);
    const { score: keywordScore } = scoreKeywords(article);
    if (!text || SENSITIVE_HARM_PATTERN.test(text)) {
        return { passes: false, keywordScore, jev: null, combined: null, mode: 'sensitive_or_empty' };
    }
    let jev = null;
    if (jevClassifier) {
        try {
            jev = await jevClassifier(article);
        } catch (error) {
            log(`jev_classifier: failed (${error.message}); falling back to keyword score`);
        }
    }
    if (typeof jev === 'number') {
        const combined = combineScores({ keywordScore, keywordCap: KEYWORD_SCORE_CAP, jev });
        return { passes: combined >= COMBINED_PASS_THRESHOLD, keywordScore, jev, combined, mode: 'keyword+jev' };
    }
    return { passes: keywordScore >= KEYWORD_PASS_THRESHOLD, keywordScore, jev: null, combined: null, mode: 'keyword' };
}

const ASK_SHOW_HN = /^(ask hn|show hn)\s*:/i;

/** Skip Ask HN / Show HN unless the title clearly mentions AI (local gate). */
export function passesHnStoryTypeGate(article) {
    const title = (article?.title || '').trim();
    if (!title) {
        return false;
    }
    if (ASK_SHOW_HN.test(title)) {
        return passesLocalAiTermGate({ title, description: article?.description || '' });
    }
    return true;
}

export function hnEngagementScore(article) {
    const points = Number(article?.points) || 0;
    const comments = Number(article?.num_comments) || 0;
    return points * 2 + comments;
}

/** Sort by HN points/comments and cap how many we send to Luna scoring. */
export function prepareHnCandidatesForScoring(candidates, { maxToScore = 25 } = {}) {
    return [...candidates]
        .sort((a, b) => hnEngagementScore(b) - hnEngagementScore(a))
        .slice(0, maxToScore);
}

export function buildRelevanceScoringPrompt(article) {
    const payload = {
        title: article?.title || '',
        description: article?.description || article?.snippet || '',
        source: article?.source || article?.source_name || '',
        url: article?.url || '',
    };
    return (
        'Score whether this news item is suitable for a Generative AI / LLM technology news site. ' +
        'Return JSON only with keys: qualifies (boolean), score (integer 0-100), sensitive_harm (boolean), reason (short string). ' +
        'Set qualifies=false for stories that are not primarily about AI/GenAI technology (e.g. general crime, courts, politics, school phone bans, broad market wraps). ' +
        'Set sensitive_harm=true for crime, violence, sexual assault, or other graphic human-harm stories even if AI is mentioned in passing. ' +
        'Set qualifies=true only when the main topic is AI/GenAI products, research, policy about AI, or the AI industry. ' +
        `Article: ${JSON.stringify(payload)}`
    );
}

export function parseRelevanceScoringResponse(raw) {
    if (!raw) {
        return { qualifies: false, score: 0, sensitive_harm: true, reason: 'empty_response' };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { qualifies: false, score: 0, sensitive_harm: true, reason: 'invalid_json' };
    }
    return {
        qualifies: Boolean(parsed.qualifies),
        score: Number(parsed.score) || 0,
        sensitive_harm: Boolean(parsed.sensitive_harm),
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
}

export function isVerdictAcceptable(verdict) {
    return verdict.qualifies && !verdict.sensitive_harm && verdict.score >= 60;
}

/**
 * @param {object[]} candidates
 * @param {{ scoreArticle: (article: object) => Promise<object>, log?: (msg: string) => void }} deps
 */
export async function selectBestQualifyingStory(
    candidates,
    { scoreArticle, log = () => {}, preferEngagement = false, jevClassifier } = {}
) {
    if (!candidates?.length) {
        return null;
    }

    // jevClassifier: undefined => build from env (null when TYPESAFE_API_KEY unset); null => keyword only.
    const classifier = jevClassifier === undefined ? createJevClassifierFromEnv({ log }) : jevClassifier;
    const gated = [];
    for (const candidate of candidates) {
        // Already accepted by the Jev pre-filter (before page fetch): don't re-judge or call Jev again.
        if (candidate?.[Symbol.for('botz.jevPrefiltered')]) {
            gated.push(candidate);
            continue;
        }
        const verdict = await classifyCandidate(candidate, { jevClassifier: classifier, log });
        if (verdict.passes) {
            gated.push(candidate);
        }
    }
    if (!gated.length) {
        log('story_selection: no candidates passed local AI term gate');
        return null;
    }

    const ranked = [];
    for (const article of gated) {
        const verdict = parseRelevanceScoringResponse(await scoreArticle(article));
        if (isVerdictAcceptable(verdict)) {
            ranked.push({ article, score: verdict.score, reason: verdict.reason });
        } else {
            log(
                `story_selection: rejected title="${(article.title || '').slice(0, 80)}" score=${verdict.score} sensitive=${verdict.sensitive_harm} reason=${verdict.reason}`
            );
        }
    }

    if (!ranked.length) {
        return null;
    }

    ranked.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        if (preferEngagement) {
            return hnEngagementScore(b.article) - hnEngagementScore(a.article);
        }
        return 0;
    });
    return ranked[0].article;
}

export class NoQualifyingStoryError extends Error {
    constructor(message = 'No qualifying GenAI news story for the requested period') {
        super(message);
        this.name = 'NoQualifyingStoryError';
        this.statusCode = 422;
        this.code = 'NO_QUALIFYING_STORY';
    }
}
