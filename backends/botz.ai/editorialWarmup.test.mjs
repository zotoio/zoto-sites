import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

// Exercise the actual delayed route callback, without starting the generation server
// or importing its credentials, network clients or writable article cache.
const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const callbackSource = source.match(/setTimeout\(([\s\S]*?), 10000\);/)?.[1];
assert.ok(callbackSource, 'editorial warmup callback is present');

function callback(get, logs = []) {
    return vm.runInNewContext(`(${callbackSource})`, {
        axios: { get },
        EDITORIAL_API_URL_PREFIX: 'https://botz.ai',
        console: { error: (...args) => logs.push(args) },
    });
}

test('warmup awaits its request, preserves its URL and bounds request time', async () => {
    let calls = 0;
    const pending = callback(async (url, options) => {
        calls++;
        assert.equal(url, 'https://botz.ai/editorials');
        assert.equal(options.timeout, 15000);
        return { status: 200 };
    })();
    assert.equal(typeof pending?.then, 'function');
    await pending;
    assert.equal(calls, 1);
});

test('502 rejection is contained and logs only numeric status, not Axios config or secrets', async () => {
    const logs = [];
    const error = Object.assign(new Error('private response text'), {
        response: { status: 502, data: 'private response body' },
        config: { headers: { Authorization: 'private credential' } },
    });
    await callback(async () => { throw error; }, logs)();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].length, 1);
    assert.equal(logs[0][0], 'Editorial cache warmup failed (HTTP 502).');
    assert.doesNotMatch(JSON.stringify(logs), /private|Authorization|config/);
});

test('network timeout and synchronous client errors are contained without dumping errors', async () => {
    for (const get of [
        async () => { throw new Error('private timeout details'); },
        () => { throw new Error('private synchronous details'); },
    ]) {
        const logs = [];
        await callback(get, logs)();
        assert.equal(logs.length, 1);
        assert.equal(logs[0][0], 'Editorial cache warmup failed (network error).');
    }
});

test('successful warmup does not log an error', async () => {
    const logs = [];
    await callback(async () => ({ status: 200 }), logs)();
    assert.equal(logs.length, 0);
});

test('real timer survives rejected request under strict unhandled rejection mode', () => {
    const script = `
        const axios = { get: async () => { throw { response: { status: 502 } }; } };
        const EDITORIAL_API_URL_PREFIX = 'https://botz.ai';
        setTimeout(${callbackSource}, 0);
        setTimeout(() => console.log('survived'), 30);
    `;
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], {
        encoding: 'utf8', timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /survived/);
});
