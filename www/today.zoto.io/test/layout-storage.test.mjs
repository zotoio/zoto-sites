import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYOUT_SCHEMA,
  applyGridNodes,
  defaultLayout,
  migrateLayout,
} from '../js/layout-storage.js';

test('defaultLayout uses current schema', () => {
  const layout = defaultLayout();
  assert.equal(layout.schema, LAYOUT_SCHEMA);
  assert.ok(layout.widgets.some((w) => w.type === 'weather'));
});

test('migrateLayout rejects unknown schema', () => {
  assert.equal(migrateLayout({ schema: 99, widgets: [] }), null);
});

test('migrateLayout normalizes widget records', () => {
  const layout = migrateLayout({
    schema: LAYOUT_SCHEMA,
    widgets: [{ id: 'news', type: 'news', x: 1, y: 2, w: 4, h: 5, settings: { maxItems: 6 } }],
  });
  assert.equal(layout.widgets[0].settings.maxItems, 6);
});

test('applyGridNodes updates positions', () => {
  const widgets = defaultLayout().widgets;
  applyGridNodes(widgets, [{ id: 'weather', x: 2, y: 3, w: 8, h: 10 }]);
  const wx = widgets.find((w) => w.id === 'weather');
  assert.equal(wx.x, 2);
  assert.equal(wx.h, 10);
});
