import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchQualifyingStoryFromProviders } from './multiProviderEditorialFetch.js';
import { jevPrefilterCandidates } from './jevPrefilter.js';

const HITS = [
    { objectID: '1', title: 'OpenAI ships a new model', url: 'https://good.example/a', points: 50, num_comments: 1, created_at_i: 1760000000 },
    { objectID: '2', title: 'Cooking pasta at home', url: 'https://bad.example/b', points: 90, num_comments: 1, created_at_i: 1760000000 },
    { objectID: '3', title: 'Quarterly results', url: 'https://rescue.example/c', points: 10, num_comments: 1, created_at_i: 1760000000 },
];
const httpGet = async () => ({ data: { hits: HITS } });
const luna = async () => JSON.stringify({ qualifies: true, score: 80, sensitive_harm: false, reason: 'ok' });

function run({ env = {}, jevClassifier, fetchImpl, events, log = () => {} }) {
    return fetchQualifyingStoryFromProviders({
        newsProviders: ['hn'],
        httpGet,
        fetchImpl,
        env,
        log,
        jevClassifier,
        scoreArticle: async (a) => {
            events?.push(`luna:${a.url}`);
            return luna();
        },
        enrichDeps: {
            fetchArticle: async (url) => {
                events?.push(`fetch:${url}`);
                return { excerpt: 'Generative AI LLM model news', og_description: 'AI model' };
            },
            fetchComment: async () => '',
        },
    });
}

test('with Jev: rejected candidates are never page-fetched, passed ones are, Jev runs before any fetch, then Luna', async () => {
    const events = [];
    const jev = async (c) => {
        events.push(`jev:${c.url}`);
        return c.url.includes('bad.') ? 0.05 : 0.9;
    };
    const logs = [];
    await run({ jevClassifier: jev, events, log: (m) => logs.push(m) });
    const fetched = events.filter((e) => e.startsWith('fetch:')).map((e) => e.slice(6));
    assert.ok(!fetched.includes('https://bad.example/b'), 'rejected candidate not fetched');
    assert.ok(fetched.includes('https://good.example/a'));
    assert.ok(fetched.includes('https://rescue.example/c'), 'zero-keyword candidate rescued by Jev is fetched');
    const lastJev = Math.max(...events.map((e, i) => (e.startsWith('jev:') ? i : -1)));
    const firstFetch = events.findIndex((e) => e.startsWith('fetch:'));
    const firstLuna = events.findIndex((e) => e.startsWith('luna:'));
    assert.ok(lastJev < firstFetch && firstFetch < firstLuna, 'order: jev -> fetch -> luna');
    assert.equal(events.filter((e) => e.startsWith('jev:')).length, 3, 'Jev not called again during selection');
    const summary = JSON.parse(logs.find((l) => l.includes('"jev_prefilter"')));
    assert.deepEqual({ ...summary, ms: 0 }, { event: 'jev_prefilter', candidates_in: 3, passed: 2, rejected: 1, errors: 0, ms: 0 });
});

test('with TYPESAFE_API_KEY in env: Jev HTTP is called per candidate before page fetch (mocked fetch)', async () => {
    const events = [];
    const fetchImpl = async (url, opts) => {
        events.push(`jevhttp:${JSON.parse(JSON.parse(opts.body).state).url}`);
        assert.match(url, /\/v1\/systemone$/);
        assert.equal(JSON.parse(opts.body).model, 'jev-1.14.0');
        return new Response(JSON.stringify({ answers: { relevant: { type: 'noul', noul: 0.9 } } }), { status: 200 });
    };
    await run({ env: { TYPESAFE_API_KEY: 'k' }, fetchImpl, events });
    assert.equal(events.filter((e) => e.startsWith('jevhttp:')).length, 3);
    assert.ok(events.findIndex((e) => e.startsWith('fetch:')) > 2);
});

test('without key: no Jev calls, flow unchanged (keyword gate after fetch), jev_classifier_skipped logged once', async () => {
    const events = [];
    const logs = [];
    const fetchImpl = async () => {
        events.push('jevhttp');
        return new Response('{}');
    };
    await run({ env: {}, fetchImpl, events, log: (m) => logs.push(m) });
    assert.ok(!events.includes('jevhttp'));
    assert.equal(logs.filter((l) => l.includes('jev_classifier_skipped')).length, 1);
    assert.ok(!logs.some((l) => l.includes('jev_prefilter')));
    const fetched = events.filter((e) => e.startsWith('fetch:'));
    assert.equal(fetched.length, 3, 'all candidates fetched as before');
});

test('Jev error: candidate kept (not dropped), counted, and keyword rule decides after fetch', async () => {
    const events = [];
    const logs = [];
    const jev = async (c) => {
        if (c.url.includes('good.')) throw new Error('jev_http_500');
        return 0.9;
    };
    await run({ jevClassifier: jev, events, log: (m) => logs.push(m) });
    assert.ok(events.includes('fetch:https://good.example/a'));
    const summary = JSON.parse(logs.find((l) => l.includes('"jev_prefilter"')));
    assert.equal(summary.errors, 1);
    assert.equal(summary.rejected, 0);
});

test('sensitive-harm text is rejected even when Jev likes it', async () => {
    const { kept, stats } = await jevPrefilterCandidates(
        [{ title: 'AI chatbot linked to murder case', url: 'https://x.example/1' }],
        { jevClassifier: async () => 1 }
    );
    assert.equal(kept.length, 0);
    assert.equal(stats.rejected, 1);
});

test('concurrency limit is respected (default 5, env override) and all candidates classified', async () => {
    const cands = Array.from({ length: 20 }, (_, i) => ({ title: `AI story ${i}`, url: `https://x.example/${i}` }));
    for (const [env, max] of [[{}, 5], [{ JEV_PREFILTER_CONCURRENCY: '2' }, 2]]) {
        let inflight = 0;
        let peak = 0;
        let calls = 0;
        const jev = async () => {
            calls++;
            inflight++;
            peak = Math.max(peak, inflight);
            await new Promise((r) => setTimeout(r, 5));
            inflight--;
            return 0.9;
        };
        const { kept } = await jevPrefilterCandidates(cands, { jevClassifier: jev, env });
        assert.equal(calls, 20);
        assert.equal(kept.length, 20);
        assert.equal(peak, max);
    }
});

test('JEV_PREFILTER_THRESHOLD overrides the default 0.35 cut', async () => {
    const c = [{ title: 'Plain title', url: 'https://x.example/1' }];
    const jev = async () => 0.7; // combined 0.42
    assert.equal((await jevPrefilterCandidates(c, { jevClassifier: jev })).kept.length, 1);
    assert.equal((await jevPrefilterCandidates(c, { jevClassifier: jev, env: { JEV_PREFILTER_THRESHOLD: '0.5' } })).kept.length, 0);
});
