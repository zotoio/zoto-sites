import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWidgetLayout, rectsConflict } from '../js/layout-normalize.js';

test('rectsConflict detects overlapping grid cells', () => {
  assert.equal(rectsConflict({ x: 0, y: 0, w: 4, h: 4 }, { x: 3, y: 0, w: 2, h: 2 }), true);
  assert.equal(rectsConflict({ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 0, w: 2, h: 2 }), false);
  assert.equal(rectsConflict({ x: 0, y: 0, w: 4, h: 4 }, { x: 5, y: 0, w: 2, h: 2 }), false);
});

test('normalizeWidgetLayout separates overlapping widgets', () => {
  const out = normalizeWidgetLayout(
    [
      { id: 'a', type: 'a', x: 0, y: 0, w: 6, h: 4 },
      { id: 'b', type: 'b', x: 2, y: 1, w: 4, h: 4 },
    ],
    12
  );
  const a = out.find((w) => w.id === 'a');
  const b = out.find((w) => w.id === 'b');
  assert.equal(rectsConflict(a, b), false);
});
