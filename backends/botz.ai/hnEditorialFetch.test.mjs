import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    fetchQualifyingStoryFromHn,
    resetHnCandidateCache,
} from './hnEditorialFetch.js';
import { NoQualifyingStoryError } from './storySelection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures/hn/sample-day.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('fetchQualifyingStoryFromHn throws no_articles when Algolia returns empty', async () => {
    resetHnCandidateCache();
    await assert.rejects(
        () =>
            fetchQualifyingStoryFromHn({
                asOfDate: '2026-06-10',
                httpGet: async () => ({ data: { hits: [] } }),
                scoreArticle: async () => '{}',
                enrichDeps: {
                    fetchArticle: async () => ({ og_description: 'ChatGPT generative AI LLM' }),
                    fetchComment: async () => '',
                },
            }),
        (err) => err instanceof NoQualifyingStoryError && err.reason === 'no_articles'
    );
});

test('fetchQualifyingStoryFromHn selects qualifying AI story from fixture', async () => {
    resetHnCandidateCache();
    const result = await fetchQualifyingStoryFromHn({
        asOfDate: '2026-06-11',
        httpGet: async () => ({ data: fixture }),
        scoreArticle: async () =>
            JSON.stringify({ qualifies: true, score: 92, sensitive_harm: false, reason: 'ok' }),
        enrichDeps: {
            fetchArticle: async () => ({
                og_description: 'OpenAI ChatGPT generative AI large language model release',
                excerpt: 'generative AI',
                source_domain: 'example.com',
            }),
            fetchComment: async () => '',
        },
    });
    assert.match(result.article.title, /OpenAI|ChatGPT/i);
    assert.equal(result.newsRequestCount, 1);
    assert.ok(result.article.hn_url);
});

test('fetchQualifyingStoryFromHn caches Algolia pages per day', async () => {
    resetHnCandidateCache();
    let calls = 0;
    const httpGet = async () => {
        calls += 1;
        return { data: fixture };
    };
    const deps = {
        asOfDate: '2026-06-12',
        httpGet,
        scoreArticle: async () =>
            JSON.stringify({ qualifies: true, score: 90, sensitive_harm: false, reason: 'ok' }),
        enrichDeps: {
            fetchArticle: async () => ({ og_description: 'OpenAI ChatGPT generative AI' }),
            fetchComment: async () => '',
        },
    };
    await fetchQualifyingStoryFromHn(deps);
    await fetchQualifyingStoryFromHn(deps);
    assert.equal(calls, 1);
});

test('fetchQualifyingStoryFromHn live path does not reuse Algolia cache across calls', async () => {
    resetHnCandidateCache();
    let calls = 0;
    const httpGet = async () => {
        calls += 1;
        return { data: fixture };
    };
    const deps = {
        asOfDate: null,
        httpGet,
        scoreArticle: async () =>
            JSON.stringify({ qualifies: true, score: 90, sensitive_harm: false, reason: 'ok' }),
        enrichDeps: {
            fetchArticle: async () => ({ og_description: 'OpenAI ChatGPT generative AI' }),
            fetchComment: async () => '',
        },
    };
    await fetchQualifyingStoryFromHn(deps);
    await fetchQualifyingStoryFromHn(deps);
    assert.equal(calls, 2);
});
