import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSimpleYaml, HTTP_FIELD_NAME_RE, discoverProxyUpstreamHosts } from './botz-projects.js';

test('parseSimpleYaml reads hyphenated HTTP header field names', () => {
  const doc = parseSimpleYaml(`
type: static
headers:
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
`);
  assert.equal(doc.headers['X-Frame-Options'], 'DENY');
  assert.equal(doc.headers['X-Content-Type-Options'], 'nosniff');
});

test('HTTP_FIELD_NAME_RE accepts common header names', () => {
  assert.ok(HTTP_FIELD_NAME_RE.test('X-Frame-Options'));
  assert.ok(HTTP_FIELD_NAME_RE.test('Cache-Control'));
});

test('discoverProxyUpstreamHosts includes site manifest upstreams', () => {
  const hosts = discoverProxyUpstreamHosts();
  assert.ok(hosts.includes('botz'));
  assert.ok(hosts.includes('today'));
});
