import { NoQualifyingStoryError } from './storySelection.js';

export function extractNewsApiErrorMessage(body) {
    if (body == null) {
        return 'unknown error';
    }
    if (typeof body === 'string') {
        return body;
    }
    if (typeof body === 'object') {
        if (typeof body.message === 'string' && body.message) {
            return body.message;
        }
        if (typeof body.error === 'string' && body.error) {
            return body.error;
        }
        if (body.error && typeof body.error === 'object') {
            if (typeof body.error.message === 'string') {
                return body.error.message;
            }
            if (typeof body.error.code === 'string') {
                return body.error.code;
            }
        }
        if (typeof body.code === 'string' && body.code) {
            return body.code;
        }
    }
    return 'unknown error';
}

export function isNewsQuotaExhaustedResponse(status, body) {
    const message = extractNewsApiErrorMessage(body).toLowerCase();
    if (status === 402) {
        return true;
    }
    return message.includes('usage_limit_reached') || message.includes('usage limit');
}

export class NewsQuotaExhaustedError extends Error {
    constructor(message = 'The News API usage limit has been reached') {
        super(message);
        this.name = 'NewsQuotaExhaustedError';
        this.statusCode = 503;
        this.code = 'NEWS_QUOTA_EXHAUSTED';
        this.clientError = 'news_quota_exhausted';
    }
}

export function noQualifyingStoryError(reason, message, { newsRequestCount = 0 } = {}) {
    const err = new NoQualifyingStoryError(message);
    err.reason = reason;
    err.newsRequestCount = newsRequestCount;
    return err;
}

export function mapAxiosNewsApiError(error, { asOfDate = null } = {}) {
    const status = error?.response?.status;
    const body = error?.response?.data;

    if (isNewsQuotaExhaustedResponse(status, body)) {
        const detail = extractNewsApiErrorMessage(body);
        const err = new NewsQuotaExhaustedError(
            `The News API quota is exhausted (${status || 'error'}: ${detail})`
        );
        return err;
    }

    if (asOfDate) {
        const detail = extractNewsApiErrorMessage(body);
        const err = new Error(
            `The News API rejected or failed the historical query for ${asOfDate} (HTTP ${status || 'unknown'}): ${detail}`
        );
        err.statusCode = 502;
        return err;
    }

    return error;
}
