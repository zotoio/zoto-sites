import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('today.zoto.io nginx vhost uses dynamic DNS upstream', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/today.zoto.io.conf'), 'utf8');
  assert.match(conf, /listen 80;/);
  assert.match(conf, /return 301 https:\/\/\$host\$request_uri;/);
  assert.match(conf, /resolver 127\.0\.0\.11/);
  assert.match(conf, /\$dynamic_upstream/);
  assert.match(conf, /@today_zoto_io_api_unavailable/);
  assert.doesNotMatch(conf, /proxy_pass http:\/\/today:3001;/);
});

test('botz.ai story images are cached for a year (200 only) and dot-paths under /cache are denied', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/botz.ai.conf'), 'utf8');
  const block = conf.match(/location \/cache\/images\/ \{[\s\S]*?\}/)?.[0];
  assert.ok(block, 'location /cache/images/ present');
  assert.match(block, /alias \/usr\/share\/nginx\/html\/botz\.ai\/cache\/images\/;/);
  assert.match(block, /add_header Cache-Control "public, max-age=31536000, immutable";/);
  assert.doesNotMatch(block, /\balways\b/, 'a 404 for a missing variant must not be marked immutable');
  const deny = new RegExp(conf.match(/location ~ (\S+) \{\s*deny all;/)[1]);
  for (const p of ['/cache/.replaced/x.json', '/cache/images/.k-480w.webp.1.deadbeef.tmp']) assert.match(p, deny, p);
  for (const p of ['/cache/images/2026-10-19-08-ab.png', '/cache/images/2026-10-19-08-ab-768w.webp', '/cache/2026-10-19-08.json']) assert.doesNotMatch(p, deny, p);
});
