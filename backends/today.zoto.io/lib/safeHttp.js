// SSRF and path-traversal guards for outbound fetches and cache file access.
import dns from 'dns';
import net from 'net';
import path from 'path';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96],
]) blocked.addSubnet(addr, prefix, 'ipv6');

/** True when an IP literal is loopback, private, link-local, CGNAT, multicast or otherwise non-public. */
export function isPrivateAddress(ip) {
    let addr = ip;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
    if (mapped) addr = mapped[1];
    const family = net.isIP(addr);
    if (!family) return true;
    return blocked.check(addr, family === 4 ? 'ipv4' : 'ipv6');
}

export class UnsafeUrlError extends Error {
    constructor(message) { super(message); this.name = 'UnsafeUrlError'; this.code = 'UNSAFE_URL'; }
}

/**
 * Parse and validate an outbound URL: http(s) only, no credentials, no IP-literal private hosts,
 * optional host allowlist (exact host or dot-suffix such as ".blob.core.windows.net").
 */
export function assertSafeUrl(rawUrl, { allowHosts } = {}) {
    let url;
    try { url = new URL(String(rawUrl)); } catch { throw new UnsafeUrlError('invalid URL'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`blocked protocol ${url.protocol}`);
    if (url.username || url.password) throw new UnsafeUrlError('credentials in URL not allowed');
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
        throw new UnsafeUrlError(`blocked host ${host}`);
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError(`blocked address ${host}`);
    if (allowHosts && !allowHosts.some(h => (h.startsWith('.') ? host.endsWith(h) : host === h))) {
        throw new UnsafeUrlError(`host not allowlisted: ${host}`);
    }
    return url;
}

/** dns.lookup replacement that refuses non-public addresses (also applies to redirects and DNS rebinding). */
export function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family }];
        const bad = list.find(a => isPrivateAddress(a.address));
        if (bad || !list.length) return callback(new UnsafeUrlError(`blocked address for ${hostname}`));
        if (options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
}

/** axios request config that validates the URL and every resolved address. */
export function safeAxiosConfig(rawUrl, config = {}, { allowHosts } = {}) {
    const url = assertSafeUrl(rawUrl, { allowHosts });
    return {
        timeout: 15000,
        maxRedirects: 3,
        maxContentLength: 25 * 1024 * 1024,
        ...config,
        url: url.toString(),
        lookup: safeLookup,
        beforeRedirect: (opts) => {
            assertSafeUrl(opts.href || `${opts.protocol}//${opts.hostname}${opts.path || ''}`, { allowHosts });
        },
    };
}

/**
 * Resolve a file name inside root. Rejects absolute paths, traversal, NUL bytes and anything that
 * normalises to a location outside root.
 */
export function resolveWithinRoot(root, ...segments) {
    const base = path.resolve(root);
    for (const s of segments) {
        if (typeof s !== 'string' || !s || s.includes('\0') || path.isAbsolute(s)) throw new UnsafeUrlError('invalid path segment');
    }
    const resolved = path.resolve(base, ...segments);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new UnsafeUrlError('path escapes root');
    return resolved;
}
