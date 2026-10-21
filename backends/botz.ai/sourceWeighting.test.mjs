import assert from 'node:assert/strict';
import test from 'node:test';
import {
    computePriorities,
    engagementScore,
    isAuthoritySource,
    recencyScore,
    resolveWeightingConfig,
    selectTopByPriority,
} from './sourceWeighting.js';
import { makeCandidate, mergeCandidates } from './newsProviders/normalize.js';
import { thenewstackProvider, THENEWSTACK_FEED_URL } from './newsProviders/keyless.js';
import { parseNewsProviders } from './newsProviders/index.js';
import { prepareMergedCandidatesForScoring } from './multiProviderEditorialFetch.js';

const NOW = Date.parse('2026-10-21T00:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const mk = (provider, o = {}) =>
    makeCandidate(provider, { title: 'OpenAI ships new LLM model', url: `https://x.example/${Math.random()}`, snippet: 'generative AI LLM OpenAI', ...o });
const prio = (c, env = {}) => computePriorities([c], { env, now: NOW })[0];

test('recency: exponential decay with 12h default half-life, env override, missing date handled', () => {
    assert.equal(recencyScore(hoursAgo(0), { now: NOW }), 1);
    assert.ok(Math.abs(recencyScore(hoursAgo(12), { now: NOW }) - 0.5) < 1e-9);
    assert.ok(Math.abs(recencyScore(hoursAgo(24), { now: NOW }) - 0.25) < 1e-9);
    assert.equal(recencyScore(hoursAgo(-5), { now: NOW }), 1); // future => new
    assert.equal(recencyScore(null, { now: NOW }), 0.25);
    assert.equal(recencyScore('garbage', { now: NOW }), 0.25);
    const cfg = resolveWeightingConfig({ SOURCE_RECENCY_HALF_LIFE_HOURS: '6' });
    assert.ok(Math.abs(recencyScore(hoursAgo(6), { now: NOW, halfLifeHours: cfg.halfLifeHours }) - 0.5) < 1e-9);
    assert.equal(resolveWeightingConfig({ SOURCE_RECENCY_HALF_LIFE_HOURS: '-3' }).halfLifeHours, 12);
});

test('newer HN story with more points outranks older low-point one', () => {
    const fresh = mk('hn', { points: 400, num_comments: 200, published_at: hoursAgo(1) });
    const stale = mk('hn', { points: 20, num_comments: 2, published_at: hoursAgo(30) });
    const [a, b] = computePriorities([fresh, stale], { now: NOW });
    assert.ok(a.priority > b.priority);
    assert.ok(a.components.engagement > b.components.engagement);
    assert.equal(selectTopByPriority([stale, fresh], { maxToScore: 1, now: NOW })[0], fresh);
});

test('engagement is log-scaled, HN only, and tolerates missing points', () => {
    assert.equal(engagementScore(mk('hn')), 0);
    assert.equal(engagementScore(mk('hn', { points: undefined, num_comments: undefined })), 0);
    assert.equal(engagementScore(mk('gnews', { points: 999 })), 0);
    const e100 = engagementScore(mk('hn', { points: 100 }));
    const e200 = engagementScore(mk('hn', { points: 200 }));
    assert.ok(e100 > 0 && e200 > e100 && e200 - e100 < e100); // diminishing returns
    assert.equal(engagementScore(mk('hn', { points: 1e9, num_comments: 1e9 })), 1);
});

test('provider weights default and SOURCE_WEIGHTS env override apply', () => {
    const base = { published_at: hoursAgo(2), url: 'https://same.example/a' };
    const hn = prio(mk('hn', base)).priority;
    const gn = prio(mk('gnews', base)).priority;
    const ddg = prio(mk('ddg', base)).priority;
    assert.ok(hn > gn && gn > ddg);
    assert.equal(prio(mk('thenewstack', base)).components.provider_weight, 0.9);
    assert.equal(prio(mk('weird', base)).components.provider_weight, 0.7);
    const env = { SOURCE_WEIGHTS: 'ddg=2.0, gnews=bad' };
    assert.ok(prio(mk('ddg', base), env).priority > prio(mk('hn', base), env).priority);
    assert.equal(prio(mk('gnews', base), env).components.provider_weight, 0.8);
});

test('authority bonus applies to non-HN only, env can change it', () => {
    const base = { published_at: hoursAgo(2) };
    const auth = prio(mk('gnews', { ...base, url: 'https://www.theverge.com/a' }));
    const plain = prio(mk('gnews', { ...base, url: 'https://blog.example.com/a' }));
    assert.equal(auth.components.authority, 0.05);
    assert.equal(plain.components.authority, 0);
    assert.ok(auth.priority > plain.priority);
    assert.equal(prio(mk('hn', { ...base, url: 'https://www.theverge.com/a' })).components.authority, 0);
    assert.equal(prio(mk('gnews', { ...base, url: 'https://thenewstack.io/x' })).components.authority, 0.05);
    assert.equal(isAuthoritySource({ provider: 'bingnews', url: 'https://news.bbc.co.uk/x' }), true);
    assert.equal(isAuthoritySource({ provider: 'bingnews', url: 'https://notft.com/x', source: 'notft.com' }), false);
    assert.equal(prio(mk('gnews', { ...base, url: 'https://www.theverge.com/a' }), { SOURCE_AUTHORITY_BONUS: '0.2' }).components.authority, 0.2);
});

test('multi-provider bonus from URL merge and from same title, capped', () => {
    const a = mk('gnews', { url: 'https://a.example/s' });
    const b = mk('bingnews', { url: 'https://www.a.example/s/' });
    const merged = mergeCandidates([[a], [b]]);
    assert.equal(merged.length, 1);
    const m = computePriorities(merged, { now: NOW })[0];
    assert.equal(m.components.multi_provider, 0.05);
    const single = prio(mk('gnews', { url: 'https://a.example/s' }));
    assert.ok(m.priority > single.priority);
    // same title, different URLs, different providers
    const t1 = mk('gnews', { title: 'Anthropic launches a brand new model today', url: 'https://one.example/1' });
    const t2 = mk('ddg', { title: 'Anthropic launches a brand new model today - Example', url: 'https://two.example/2' });
    const [r1] = computePriorities([t1, t2], { now: NOW });
    assert.equal(r1.components.provider_count, 2);
    // cap
    const many = ['hn', 'gnews', 'bingnews', 'ddg', 'thenewsapi'].map((p, i) => mk(p, { title: 'same long story title here', url: `https://s${i}.example/` }));
    assert.equal(computePriorities(many, { now: NOW })[0].components.multi_provider, 0.15);
});

test('cap selects top-25 by priority; keyword gate order and missing fields do not crash', () => {
    const cands = [];
    for (let i = 0; i < 40; i++) {
        cands.push(mk('hn', { url: `https://h.example/${i}`, title: `OpenAI LLM story number ${i}`, points: i, num_comments: 0, published_at: hoursAgo(1) }));
    }
    cands.push(mk('ddg', { url: 'https://d.example/old', title: 'OpenAI LLM ancient item', published_at: hoursAgo(500) }));
    cands.push(mk('hn', { url: 'https://h.example/nodate', title: 'OpenAI LLM undated item', points: undefined, published_at: undefined }));
    const logs = [];
    const top = prepareMergedCandidatesForScoring(cands, { env: {}, now: NOW, log: (l) => logs.push(l) });
    assert.equal(top.length, 25);
    assert.equal(top[0].url, 'https://h.example/39');
    assert.ok(!top.some((c) => c.url === 'https://d.example/old'));
    const ev = JSON.parse(logs[0]);
    assert.equal(ev.event, 'source_weighting_top');
    assert.equal(ev.items.length, 5);
    assert.deepEqual(Object.keys(ev.items[0]).sort(), ['components', 'priority', 'provider', 'url']);
    assert.ok(ev.items[0].priority >= ev.items[4].priority);
    assert.doesNotThrow(() => computePriorities([{ title: 't', url: 'u' }], { now: NOW }));
});

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Kubernetes meets LLM agents</title><link>https://thenewstack.io/k8s-llm/</link><pubDate>Tue, 20 Oct 2026 22:00:00 +0000</pubDate><description><![CDATA[<p>How <b>generative AI</b> runs on k8s.</p>]]></description></item>
<item><title>No date item</title><link>https://thenewstack.io/nodate/</link><description>plain</description></item>
<item><title>No link</title></item>
</channel></rss>`;

test('thenewstack provider: one live request, parses RSS, no retries, live only, failures logged', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
        calls.push({ url, opts });
        return { ok: true, status: 200, text: async () => FEED };
    };
    const { candidates, requests } = await thenewstackProvider.fetchCandidates({ fetchImpl });
    assert.equal(requests, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, THENEWSTACK_FEED_URL);
    assert.ok(calls[0].opts.signal);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].provider, 'thenewstack');
    assert.equal(candidates[0].source, 'thenewstack.io');
    assert.equal(candidates[0].title, 'Kubernetes meets LLM agents');
    assert.equal(candidates[0].url, 'https://thenewstack.io/k8s-llm/');
    assert.equal(candidates[0].published_at, '2026-10-20T22:00:00.000Z');
    assert.equal(candidates[0].snippet, 'How generative AI runs on k8s.');
    assert.equal(candidates[1].published_at, null);

    const skipLogs = [];
    const hist = await thenewstackProvider.fetchCandidates({ asOfDate: '2026-01-01', fetchImpl, log: (l) => skipLogs.push(l) });
    assert.equal(hist.requests, 0);
    assert.equal(calls.length, 1);

    const failLogs = [];
    const bad = await thenewstackProvider.fetchCandidates({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }), log: (l) => failLogs.push(l) });
    assert.deepEqual(bad.candidates, []);
    assert.match(failLogs[0], /http_503/);
    assert.deepEqual(parseNewsProviders('hn,thenewsapi,gnews,bingnews,thenewstack'), ['hn', 'thenewsapi', 'gnews', 'bingnews', 'thenewstack']);
});
