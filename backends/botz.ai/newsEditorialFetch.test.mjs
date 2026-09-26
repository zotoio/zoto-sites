import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchQualifyingStoryForEditorial, resetNewsCandidateCache } from './newsEditorialFetch.js';
import { NoQualifyingStoryError } from './storySelection.js';

test('fetchQualifyingStoryForEditorial throws no_articles when API returns empty', async () => {
    resetNewsCandidateCache();
    let requests = 0;
    await assert.rejects(
        () =>
            fetchQualifyingStoryForEditorial({
                asOfDate: '2026-06-01',
                isWeekend: false,
                newsApiKey: 'x',
                httpGet: async () => {
                    requests += 1;
                    return { data: { data: [] } };
                },
                scoreArticle: async () => '{}',
            }),
        (err) => err instanceof NoQualifyingStoryError && err.reason === 'no_articles'
    );
    assert.equal(requests, 1);
});

test('fetchQualifyingStoryForEditorial uses one request when story qualifies', async () => {
    resetNewsCandidateCache();
    let requests = 0;
    const article = {
        title: 'OpenAI ships GPT update',
        description: 'generative AI large language model release',
    };
    const result = await fetchQualifyingStoryForEditorial({
        asOfDate: '2026-06-02',
        isWeekend: false,
        newsApiKey: 'x',
        httpGet: async () => {
            requests += 1;
            return { data: { data: [article] } };
        },
        scoreArticle: async () =>
            JSON.stringify({ qualifies: true, score: 90, sensitive_harm: false, reason: 'ok' }),
    });
    assert.equal(requests, 1);
    assert.equal(result.newsRequestCount, 1);
    assert.equal(result.article.title, article.title);
});

test('fetchQualifyingStoryForEditorial reuses cached candidates without extra HTTP', async () => {
    resetNewsCandidateCache();
    let requests = 0;
    const httpGet = async () => {
        requests += 1;
        return {
            data: {
                data: [{ title: 'OpenAI news', description: 'ChatGPT generative AI' }],
            },
        };
    };
    const scoreArticle = async () =>
        JSON.stringify({ qualifies: true, score: 80, sensitive_harm: false, reason: 'ok' });

    await fetchQualifyingStoryForEditorial({
        asOfDate: '2026-06-03',
        isWeekend: false,
        newsApiKey: 'x',
        httpGet,
        scoreArticle,
    });
    await fetchQualifyingStoryForEditorial({
        asOfDate: '2026-06-03',
        isWeekend: false,
        newsApiKey: 'x',
        httpGet,
        scoreArticle,
    });
    assert.equal(requests, 1);
});
