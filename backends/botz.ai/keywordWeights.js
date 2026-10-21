/**
 * Weighted AI keyword scheme for the local relevance gate (replaces the old boolean AI_TERM_PATTERN).
 *
 * Calibrated for botz.ai: GenAI / LLM news and editorial (see getArticlePrompt in index.js).
 * Score = sum of the weights of DISTINCT matching terms, capped at KEYWORD_SCORE_CAP.
 * A candidate passes when score >= KEYWORD_PASS_THRESHOLD.
 *
 * Matched text: title + description/snippet + URL slug (hyphens/underscores -> spaces) + domain.
 * `cs: true` terms match case-sensitively against title+description only (original casing), so the
 * bare word "AI" does not fire on "said", "Hawaii", "air" or lowercase "ai" inside other words.
 * `slugToken: true` additionally lets the lowercase slug token "ai" count (e.g. /no-ai-filter).
 */

export const WEIGHT = Object.freeze({ VENDOR: 5, HIGH: 3, MEDIUM: 2, LOW: 1 });

export const KEYWORD_PASS_THRESHOLD = 2;
export const KEYWORD_SCORE_CAP = 10;

/** @type {{ id: string, weight: number, pattern: RegExp, cs?: boolean, slugToken?: boolean }[]} */
export const KEYWORD_TABLE = [
    // --- Vendors / models / products (highest) ---
    { id: 'openai', weight: WEIGHT.VENDOR, pattern: /\bopenai\b/i },
    { id: 'chatgpt', weight: WEIGHT.VENDOR, pattern: /\bchat\s?gpt\b/i },
    { id: 'gpt-n', weight: WEIGHT.VENDOR, pattern: /\bgpt[- ]?(?:[3-9](?:\.\d)?|4o|oss)\b/i },
    { id: 'claude', weight: WEIGHT.VENDOR, pattern: /\bclaude\b/i },
    { id: 'anthropic', weight: WEIGHT.VENDOR, pattern: /\banthropic\b/i },
    { id: 'gemini', weight: WEIGHT.VENDOR, pattern: /\bgemini\b/i },
    { id: 'grok', weight: WEIGHT.VENDOR, pattern: /\bgrok\b/i },
    { id: 'xai', weight: WEIGHT.VENDOR, pattern: /\bxai\b/i },
    { id: 'deepseek', weight: WEIGHT.VENDOR, pattern: /\bdeep\s?seek\b/i },
    { id: 'qwen', weight: WEIGHT.VENDOR, pattern: /\bqwen\d*\b/i },
    { id: 'llama', weight: WEIGHT.VENDOR, pattern: /\bllama\s?\d*\b/i },
    { id: 'mistral', weight: WEIGHT.VENDOR, pattern: /\bmistral\b/i },
    { id: 'deepmind', weight: WEIGHT.VENDOR, pattern: /\bdeep\s?mind\b/i },
    { id: 'meta-ai', weight: WEIGHT.VENDOR, pattern: /\bmeta ai\b/i },
    { id: 'midjourney', weight: WEIGHT.VENDOR, pattern: /\bmidjourney\b/i },
    { id: 'stable-diffusion', weight: WEIGHT.VENDOR, pattern: /\bstable diffusion\b/i },
    { id: 'sora', weight: WEIGHT.VENDOR, pattern: /\bsora\b/i },
    { id: 'dall-e', weight: WEIGHT.VENDOR, pattern: /\bdall[- ]?e\b/i },
    { id: 'hugging-face', weight: WEIGHT.VENDOR, pattern: /\bhugging\s?face\b/i },
    { id: 'runway-ml', weight: WEIGHT.VENDOR, pattern: /\brunway\s?ml\b/i },
    { id: 'copilot', weight: WEIGHT.HIGH, pattern: /\bcopilot\b/i },
    { id: 'perplexity-ai', weight: WEIGHT.HIGH, pattern: /\bperplexity (?:ai|pro|comet)\b/i },
    { id: 'cursor-ai', weight: WEIGHT.HIGH, pattern: /\bcursor (?:ai|ide|editor)\b/i },

    // --- GenAI concepts / editorial vocabulary (high) ---
    { id: 'generative-ai', weight: WEIGHT.HIGH, pattern: /\b(?:generative|gen) ai\b/i },
    { id: 'genai', weight: WEIGHT.HIGH, pattern: /\bgenai\b/i },
    { id: 'llm', weight: WEIGHT.HIGH, pattern: /\bllms?\b/i },
    { id: 'large-language-model', weight: WEIGHT.HIGH, pattern: /\blarge language models?\b/i },
    { id: 'foundation-model', weight: WEIGHT.HIGH, pattern: /\bfoundation models?\b/i },
    { id: 'reasoning-model', weight: WEIGHT.HIGH, pattern: /\breasoning models?\b/i },
    { id: 'diffusion-model', weight: WEIGHT.HIGH, pattern: /\bdiffusion models?\b/i },
    { id: 'agentic', weight: WEIGHT.HIGH, pattern: /\bagentic\b/i },
    { id: 'ai-agent', weight: WEIGHT.HIGH, pattern: /\bai[- ]agents?\b/i },
    { id: 'vibe-coding', weight: WEIGHT.HIGH, pattern: /\bvibe[- ]?cod(?:e|ing|ed)\b/i },
    { id: 'ai-slop', weight: WEIGHT.HIGH, pattern: /\bai[- ]slop\b/i },
    { id: 'prompt-injection', weight: WEIGHT.HIGH, pattern: /\bprompt injection\b/i },

    // --- General AI terms (medium) ---
    { id: 'AI', weight: WEIGHT.MEDIUM, pattern: /(?<![A-Za-z0-9.])A\.?I\.?(?![A-Za-z0-9])/, cs: true, slugToken: true },
    { id: 'artificial-intelligence', weight: WEIGHT.MEDIUM, pattern: /\bartificial intelligence\b/i },
    { id: 'machine-learning', weight: WEIGHT.MEDIUM, pattern: /\bmachine learning\b/i },
    { id: 'neural-network', weight: WEIGHT.MEDIUM, pattern: /\bneural net(?:work)?s?\b/i },
    { id: 'deep-learning', weight: WEIGHT.MEDIUM, pattern: /\bdeep learning\b/i },
    { id: 'language-model', weight: WEIGHT.MEDIUM, pattern: /\blanguage models?\b/i },
    { id: 'chatbot', weight: WEIGHT.MEDIUM, pattern: /\bchat ?bots?\b/i },
    { id: 'AGI', weight: WEIGHT.MEDIUM, pattern: /\bAGI\b/, cs: true },

    // --- Weak / ambiguous (low; need a second hit to pass the threshold) ---
    { id: 'slop', weight: WEIGHT.LOW, pattern: /\bslop\b/i },
    { id: 'agents', weight: WEIGHT.LOW, pattern: /\bagents?\b/i },
    { id: 'inference', weight: WEIGHT.LOW, pattern: /\binference\b/i },
    { id: 'prompt', weight: WEIGHT.LOW, pattern: /\bprompts?\b/i },
    { id: 'GPU', weight: WEIGHT.LOW, pattern: /\bGPUs?\b/, cs: true },
    // Deliberately omitted as too ambiguous: bare "model", "cursor", "nvidia", "transformer", "bot".
];

export function slugFromUrl(url) {
    try {
        const { pathname } = new URL(url);
        return decodeURIComponent(pathname).replace(/[-_/.]+/g, ' ').replace(/\s+/g, ' ').trim();
    } catch {
        return '';
    }
}

export function domainForMatching(article) {
    if (article?.source && /\./.test(article.source)) {
        return article.source;
    }
    try {
        return new URL(article?.url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * @returns {{ score: number, raw: number, matches: { id: string, weight: number, where: string }[] }}
 */
export function scoreKeywords(article) {
    const title = article?.title || '';
    const description = article?.description || article?.snippet || '';
    const csText = `${title} ${description}`;
    const slug = slugFromUrl(article?.url);
    const ciText = `${csText} ${slug} ${domainForMatching(article)}`;
    const slugTokens = slug.toLowerCase().split(' ');

    const matches = [];
    for (const entry of KEYWORD_TABLE) {
        if (entry.cs) {
            if (entry.pattern.test(csText)) {
                matches.push({ id: entry.id, weight: entry.weight, where: 'text' });
            } else if (entry.slugToken && slugTokens.includes(entry.id.toLowerCase())) {
                matches.push({ id: entry.id, weight: entry.weight, where: 'slug' });
            }
        } else if (entry.pattern.test(ciText)) {
            matches.push({ id: entry.id, weight: entry.weight, where: 'text' });
        }
    }
    const raw = matches.reduce((sum, m) => sum + m.weight, 0);
    return { score: Math.min(raw, KEYWORD_SCORE_CAP), raw, matches };
}
