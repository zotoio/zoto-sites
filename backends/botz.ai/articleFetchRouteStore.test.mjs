import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchLinkedArticleMetadata } from './articleEnrichment.js';
import { createRouteStore, routeHostKey } from './articleFetchRouteStore.js';

const HTML = '<html><head><meta property="og:title" content="T"></head></html>';
const ok = () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
const forbidden = () => new Response('no', { status: 403 });
const env = { ARTICLE_FETCH_PROXY: 'http://p:1', ARTICLE_FETCH_429_RETRIES: '0' };

function harness(handler, extra = {}) {
    const calls = [];
    const logs = [];
    const fetchImpl = async (url, opts) => {
        const kind = opts.dispatcher ? 'proxy' : 'direct';
        calls.push(kind);
        return handler(kind, calls);
    };
    return {
        calls,
        logs,
        run: (url, store, e = env) =>
            fetchLinkedArticleMetadata(url, {
                fetchImpl, env: e, routeStore: store, log: (m) => logs.push(m),
                getProxyDispatcher: async () => ({}), sleep: async () => {}, ...extra,
            }),
    };
}

test('403 direct then proxy 200 is remembered; next fetch goes straight to proxy', async () => {
    const h = harness((kind) => (kind === 'direct' ? forbidden() : ok()));
    const store = createRouteStore({});
    await h.run('https://news.example/a', store);
    assert.deepEqual(h.calls, ['direct', 'proxy']);
    assert.equal(store.get('news.example'), 'proxy');
    h.calls.length = 0;
    await h.run('https://www.news.example/b', store);
    assert.deepEqual(h.calls, ['proxy']);
    assert.ok(h.logs.some((l) => l.includes('article_fetch_route host=news.example remembered=proxy chosen=proxy')));
});

test('proxy failure on remembered proxy host tries direct once and updates memory', async () => {
    const h = harness((kind) => (kind === 'proxy' ? forbidden() : ok()));
    const store = createRouteStore({});
    store.set('x.example', 'proxy');
    const out = await h.run('https://x.example/a', store);
    assert.deepEqual(h.calls, ['proxy', 'direct']);
    assert.equal(store.get('x.example'), 'direct');
    assert.equal(out.og_title, 'T');
});

test('direct 200 stays direct', async () => {
    const h = harness(() => ok());
    const store = createRouteStore({});
    await h.run('https://ok.example/a', store);
    await h.run('https://ok.example/b', store);
    assert.deepEqual(h.calls, ['direct', 'direct']);
    assert.equal(store.get('ok.example'), 'direct');
    assert.ok(h.logs.some((l) => l.includes('remembered=none chosen=direct')));
});

test('TTL expiry reverts to direct-first', async () => {
    let t = 1000;
    const store = createRouteStore({ ttlMs: 3600e3, now: () => t });
    store.set('t.example', 'proxy');
    assert.equal(store.get('t.example'), 'proxy');
    t += 3600e3 + 1;
    const h = harness(() => ok());
    await h.run('https://t.example/a', store);
    assert.deepEqual(h.calls, ['direct']);
});

test('persistence round-trip, atomic write leaves no temp file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
    const file = path.join(dir, 'sub', 'routes.json');
    createRouteStore({ filePath: file }).set('a.example', 'proxy');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['routes.json']);
    assert.equal(createRouteStore({ filePath: file }).get('a.example'), 'proxy');
});

test('corrupt file is tolerated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
    const file = path.join(dir, 'routes.json');
    fs.writeFileSync(file, '{not json');
    const logs = [];
    const store = createRouteStore({ filePath: file, log: (m) => logs.push(m) });
    assert.equal(store.get('a.example'), null);
    assert.ok(logs.some((l) => l.includes('corrupt')));
    store.set('a.example', 'direct');
    assert.equal(createRouteStore({ filePath: file }).get('a.example'), 'direct');
});

test('www. and case normalization; no memory without proxy or in always mode', async () => {
    assert.equal(routeHostKey('https://WWW.Example.COM/x'), 'example.com');
    const store = createRouteStore({});
    const h = harness(() => ok());
    await h.run('https://n.example/a', store, {});
    await h.run('https://n.example/a', store, { ...env, ARTICLE_FETCH_PROXY_MODE: 'always' });
    assert.equal(store.get('n.example'), null);
});
