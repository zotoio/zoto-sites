import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('today.zoto.io nginx vhost uses dynamic DNS upstream', () => {
  const conf = fs.readFileSync(path.join(ROOT, 'nginx-conf/today.zoto.io.conf'), 'utf8');
  assert.match(conf, /resolver 127\.0\.0\.11/);
  assert.match(conf, /\$dynamic_upstream/);
  assert.match(conf, /@today_zoto_io_api_unavailable/);
  assert.doesNotMatch(conf, /proxy_pass http:\/\/today:3001;/);
});
