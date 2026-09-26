import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));

test('axios-curlirize is not used (would log Authorization headers and thenewsapi api_token)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['axios-curlirize'], undefined);

  const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  assert.doesNotMatch(index, /curlirize/i);

  const lock = fs.readFileSync(path.join(dir, 'yarn.lock'), 'utf8');
  assert.doesNotMatch(lock, /axios-curlirize/);
});
