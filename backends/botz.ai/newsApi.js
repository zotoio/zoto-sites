const TOP_NEWS_URL = 'https://api.thenewsapi.com/v1/news/top';

export function buildTopNewsParams({
    apiToken,
    search,
    language = 'en',
    limit = 1,
    page = 1,
    asOfDate = null,
}) {
    const params = {
        search,
        sort: 'published_at',
        api_token: apiToken,
        language,
        limit,
        page,
    };
    if (asOfDate) {
        params.published_on = asOfDate;
    }
    return params;
}

export function describeTopNewsRequest(params, { redactToken = true } = {}) {
    const safe = { ...params };
    if (redactToken && safe.api_token) {
        safe.api_token = 'REDACTED';
    }
    const query = new URLSearchParams(safe).toString();
    return { url: TOP_NEWS_URL, query, method: 'GET' };
}

export function formatHistoricalNewsApiFailure(asOfDate, error) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const apiMessage =
        (typeof body === 'object' && body !== null && (body.message || body.error)) ||
        (typeof body === 'string' ? body : null) ||
        error?.message ||
        'unknown error';
    const statusPart = status ? `HTTP ${status}` : 'request failed';
    const err = new Error(
        `The News API rejected or failed the historical query for ${asOfDate} (${statusPart}): ${apiMessage}. ` +
            'This backfill does not fall back to current news. Verify your plan supports published_on for that date.'
    );
    err.statusCode = 502;
    return err;
}

export function assertHistoricalNewsResults(asOfDate, articles) {
    if (!articles || articles.length === 0) {
        throw new Error(
            `No English GenAI news articles returned for ${asOfDate} (published_on). ` +
                'Try another day or adjust search keywords; backfill will not use current news.'
        );
    }
}

export { TOP_NEWS_URL };
