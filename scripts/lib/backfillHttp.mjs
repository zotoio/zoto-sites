/**
 * fetch with retries for transient network failures (backfill CLI).
 */

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string} url
 * @param {RequestInit} options
 * @param {{ maxRetries?: number, baseDelayMs?: number, fetchImpl?: typeof fetch, timeoutMs?: number }} [config]
 */
export async function fetchWithRetries(url, options, config = {}) {
    const maxRetries = config.maxRetries ?? 2;
    const baseDelayMs = config.baseDelayMs ?? 2000;
    const fetchImpl = config.fetchImpl ?? fetch;
    const { timeoutMs } = config;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const requestOptions = { ...options };
        if (timeoutMs != null && Number.isFinite(timeoutMs)) {
            requestOptions.signal = AbortSignal.timeout(timeoutMs);
        }
        try {
            return await fetchImpl(url, requestOptions);
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await sleep(baseDelayMs * (attempt + 1));
            }
        }
    }
    throw lastError;
}
