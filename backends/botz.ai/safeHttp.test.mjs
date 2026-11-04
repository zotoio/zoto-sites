import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { assertSafeUrl, isPrivateAddress, resolveWithinRoot, safeLookup } from './safeHttp.js';

test('isPrivateAddress flags non-public ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
        assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('assertSafeUrl rejects unsafe URLs', () => {
    for (const u of ['file:///etc/passwd', 'gopher://x', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest', 'http://user:pw@example.com/', 'not a url', 'http://metadata.google.internal/']) {
        assert.throws(() => assertSafeUrl(u), /./, u);
    }
    assert.equal(assertSafeUrl('https://example.com/a').hostname, 'example.com');
});

test('assertSafeUrl enforces allowHosts', () => {
    const allowHosts = ['.blob.core.windows.net'];
    assert.ok(assertSafeUrl('https://x.blob.core.windows.net/i.png', { allowHosts }));
    assert.throws(() => assertSafeUrl('https://evil.example/i.png', { allowHosts }));
    assert.throws(() => assertSafeUrl('https://blob.core.windows.net.evil.example/i.png', { allowHosts }));
});

test('safeLookup refuses hosts resolving to loopback', (t, done) => {
    safeLookup('localhost', {}, (err) => {
        assert.ok(err);
        assert.equal(err.code, 'UNSAFE_URL');
        done();
    });
});

test('resolveWithinRoot confines paths to root', () => {
    const root = path.resolve('/tmp/cache-root');
    assert.equal(resolveWithinRoot(root, 'images', 'a.png'), path.join(root, 'images', 'a.png'));
    for (const seg of ['../etc/passwd', '/etc/passwd', 'a/../../b', 'x\0y', '']) {
        assert.throws(() => resolveWithinRoot(root, seg), /./, JSON.stringify(seg));
    }
});
