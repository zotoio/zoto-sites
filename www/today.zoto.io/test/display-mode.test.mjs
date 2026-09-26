import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID_COLUMNS_STANDARD,
  GRID_COLUMNS_ULTRAWIDE,
  isUltrawideActive,
} from '../js/display-mode.js';

test('ultrawide preference overrides media query', () => {
  assert.equal(isUltrawideActive('on', false), true);
  assert.equal(isUltrawideActive('off', true), false);
  assert.equal(isUltrawideActive('auto', true), true);
  assert.equal(isUltrawideActive('auto', false), false);
});

test('grid column constants', () => {
  assert.equal(GRID_COLUMNS_ULTRAWIDE, 24);
  assert.equal(GRID_COLUMNS_STANDARD, 12);
});
