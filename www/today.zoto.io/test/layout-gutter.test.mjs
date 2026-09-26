import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_GUTTER_PX } from '../js/grid-config.js';
import { layoutHasMinimumGutter, MIN_WIDGET_GAP_PX } from '../js/layout-gutter.js';
import { rectsConflict } from '../js/layout-normalize.js';
import { defaultLayout, demoShowcaseLayout } from '../js/layout-storage.js';

function assertNoGridOverlap(widgets) {
  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      assert.equal(rectsConflict(widgets[i], widgets[j]), false, `overlap ${widgets[i].type} vs ${widgets[j].type}`);
    }
  }
}

test('defaultLayout has no overlaps and meets minimum gutter', () => {
  const widgets = defaultLayout().widgets;
  assertNoGridOverlap(widgets);
  assert.equal(
    layoutHasMinimumGutter(widgets, {
      cellHeight: 72,
      marginPx: GRID_GUTTER_PX,
      minGapPx: MIN_WIDGET_GAP_PX,
    }),
    true
  );
});

test('demoShowcaseLayout has no overlaps and meets minimum gutter', () => {
  const widgets = demoShowcaseLayout().widgets;
  assertNoGridOverlap(widgets);
  assert.equal(
    layoutHasMinimumGutter(widgets, {
      cellHeight: 72,
      marginPx: GRID_GUTTER_PX,
      minGapPx: MIN_WIDGET_GAP_PX,
    }),
    true
  );
});
