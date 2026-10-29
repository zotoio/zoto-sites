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

test('botz.ai subdomain proxy resolves upstream lazily and swarm is never cached', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/botz.ai-sub-swarm.conf'), 'utf8');
  assert.match(conf, /resolver 127\.0\.0\.11/);
  assert.match(conf, /set \$project_upstream "http:\/\/swarm:4310";/);
  assert.match(conf, /proxy_pass \$project_upstream;/);
  assert.doesNotMatch(conf, /proxy_pass http:\/\/swarm:4310;/);
  assert.match(conf, /error_page 502 504 = @botz_sub_swarm_unavailable;/);
  assert.match(conf, /add_header Cache-Control "private, no-store" always;/);
  assert.match(conf, /add_header Cloudflare-CDN-Cache-Control "no-store" always;/);
  assert.match(conf, /proxy_hide_header Cache-Control;/);
});

test('mcp.botz.ai proxies everything to botz-mcp unbuffered with forwarded headers and no-store', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/botz.ai-sub-mcp.conf'), 'utf8');
  assert.match(conf, /server_name  mcp\.botz\.ai;/);
  // location / covers /mcp, /.well-known/*, /auth/*, /register, /authorize, /token, /revoke, /admin
  assert.match(conf, /location \/ \{/);
  assert.match(conf, /set \$project_upstream "http:\/\/botz-mcp:4444";/);
  assert.match(conf, /proxy_buffering off;/);
  assert.match(conf, /proxy_request_buffering off;/);
  assert.match(conf, /proxy_read_timeout 900s;/);
  assert.match(conf, /proxy_set_header X-Forwarded-Proto https;/);
  assert.match(conf, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
  assert.match(conf, /add_header Cloudflare-CDN-Cache-Control "no-store" always;/);
  assert.doesNotMatch(conf, /proxy_intercept_errors on/); // 401 + WWW-Authenticate must reach MCP clients
});

test('streaming flag does not change existing swarm vhost', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/botz.ai-sub-swarm.conf'), 'utf8');
  assert.doesNotMatch(conf, /proxy_buffering off;/);
});

test('D2: every server block caps request bodies at 16m (reverse-proxy backstop)', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'nginx-conf')).filter((n) => n.endsWith('.conf'))) {
    const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf', f), 'utf8');
    const servers = (conf.match(/\bserver\s*\{/g) || []).length;
    const caps = (conf.match(/client_max_body_size 16m;/g) || []).length;
    assert.equal(caps, servers, `${f}: ${caps} caps for ${servers} server blocks`);
  }
});

test('swarm.botz.ai exposes /otlp/v1/ with body cap and rate limit', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/botz.ai-sub-swarm.conf'), 'utf8');
  assert.match(conf, /limit_req_zone \$otlp_swarm_client zone=otlp_swarm:10m rate=20r\/s;/);
  const block = conf.match(/location \^~ \/otlp\/v1\/ \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(block, 'otlp location present');
  assert.match(block, /limit_req zone=otlp_swarm burst=40 nodelay;/);
  assert.match(block, /client_max_body_size 4m;/);
  assert.match(block, /proxy_pass \$project_upstream;/);
});

test('botz.ai project proxies support blue/green switching and a JSON-RPC 503 fallback', () => {
  for (const [name, host] of [['mcp', 'botz-mcp:4444'], ['swarm', 'swarm:4310']]) {
    const conf = fs.readFileSync(path.join(ROOT, `nginx-conf/botz.ai-sub-${name}.conf`), 'utf8');
    const sets = conf.match(new RegExp(`set \\$project_upstream "http://${host}";\\n\\s+include /etc/nginx/botz-upstreams/${name}\\.conf\\*;`, 'g')) || [];
    assert.ok(sets.length >= 1, `${name}: override include follows every upstream set`);
    assert.equal(sets.length, (conf.match(/set \$project_upstream/g) || []).length);
    assert.match(conf, /proxy_next_upstream error timeout http_502;/);
    const fb = conf.match(/location @botz_sub_\w+_unavailable \{([\s\S]*?)\n    \}/)[1];
    assert.match(fb, /add_header Retry-After "5" always;/);
    assert.match(fb, /default_type application\/json;/);
    const body = JSON.parse(fb.match(/return 503 '(.*)';/)[1]);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.error.message, 'Service temporarily unavailable. Please retry shortly.');
    assert.equal(body.error.data.transient, true);
  }
});
