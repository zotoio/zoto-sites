/**
 * OpenAI Images API helpers (GPT Image models; DALL·E 3 retired 2026-03-04).
 * Request builders are exported for dry-run / contract tests.
 */

/** @typedef {import('openai').OpenAI} OpenAI */

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';

const GPT_IMAGE_QUALITY = new Set(['low', 'medium', 'high', 'auto']);

/**
 * Map legacy DALL·E 3 quality env values to GPT Image quality.
 * @param {string | undefined} qualityEnv
 * @returns {'low' | 'medium' | 'high' | 'auto'}
 */
export function mapImageQuality(qualityEnv) {
    const q = (qualityEnv || 'standard').trim().toLowerCase();
    if (GPT_IMAGE_QUALITY.has(q)) {
        return /** @type {'low' | 'medium' | 'high' | 'auto'} */ (q);
    }
    if (q === 'standard') {
        return 'medium';
    }
    if (q === 'hd') {
        return 'high';
    }
    return 'medium';
}

/**
 * Build parameters for openai.images.generate (no DALL·E-only fields such as `style`).
 * @param {string} prompt
 * @param {{ model?: string, quality?: string, size?: string }} [overrides]
 */
export function buildImageGenerateParams(prompt, overrides = {}) {
    // OPENAI_IMAGE_MODEL is passed through verbatim (e.g. gpt-image-2, gpt-image-2.5-flare).
    const model =
        overrides.model ||
        process.env.OPENAI_IMAGE_MODEL ||
        DEFAULT_OPENAI_IMAGE_MODEL;
    const quality = mapImageQuality(
        overrides.quality !== undefined ? overrides.quality : process.env.OPENAI_IMAGE_QUALITY
    );
    const size =
        overrides.size ||
        process.env.OPENAI_IMAGE_SIZE ||
        '1024x1024';

    return {
        model,
        prompt,
        quality,
        size,
        n: 1,
    };
}

/**
 * @param {OpenAI} openaiClient
 * @param {string} prompt
 * @param {object} [overrides]
 */
export async function requestGeneratedImage(openaiClient, prompt, overrides = {}) {
    const params = buildImageGenerateParams(prompt, overrides);
    return openaiClient.images.generate(params);
}
