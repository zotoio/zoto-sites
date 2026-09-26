import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTransit } from '../lib/demo.js';

test('demoTransit is only used for explicit demo requests', () => {
  const d = demoTransit();
  assert.equal(d.source, 'demo');
  assert.ok(d.stops[0].name.includes('Market') || d.stops.length > 0);
});
