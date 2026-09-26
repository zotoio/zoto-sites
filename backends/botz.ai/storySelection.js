/**
 * GenAI news story filtering and ranking (testable without network).
 */

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

const AI_TERM_PATTERN =
    /\b(openai|chatgpt|gpt[- ]?[3456o]|claude|anthropic|gemini|deepmind|llama|mistral|genai|generative ai|large language model|\bllm\b|sora|midjourney|stable diffusion|copilot|hugging\s*face|xai|grok|runway\s*ml|dall[- ]?e)\b/i;

const SENSITIVE_HARM_PATTERN =
    /\b(sexual assault|rape|molest|murder|homicide|shooting|stabbing|kidnap|domestic violence|assault charge|crime scene)\b/i;

export function articleTextForMatching(article) {
    const title = article?.title || '';
    const description = article?.description || article?.snippet || '';
    return `${title} ${description}`.trim();
}

/** Require AI/GenAI terms in title or description before LLM scoring. */
export function passesLocalAiTermGate(article) {
    const text = articleTextForMatching(article);
    if (!text) {
        return false;
    }
    if (SENSITIVE_HARM_PATTERN.test(text)) {
        return false;
    }
    return AI_TERM_PATTERN.test(text);
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
    { scoreArticle, log = () => {}, preferEngagement = false } = {}
) {
    if (!candidates?.length) {
        return null;
    }

    const gated = candidates.filter(passesLocalAiTermGate);
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
