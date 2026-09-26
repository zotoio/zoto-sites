const TOP_NEWS_URL = 'https://api.thenewsapi.com/v1/news/top';

export function buildTopNewsParams({
    apiToken,
    search,
    language = 'en',
    limit = 10,
    page = 1,
    asOfDate = null,
    categories = 'tech',
}) {
    const params = {
        search,
        sort: 'published_at',
        api_token: apiToken,
        language,
        limit,
        page,
    };
    if (categories) {
        params.categories = categories;
    }
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

export { TOP_NEWS_URL };
