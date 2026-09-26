import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGET_CATALOG,
  WIDGET_CATEGORIES,
  allWidgetTypes,
  createLayoutEntry,
  getSettingsFields,
  widgetsByCategory,
} from '../js/widget-registry.js';

test('every catalog widget has valid category and sizing', () => {
  const catIds = new Set(WIDGET_CATEGORIES.map((c) => c.id));
  for (const type of allWidgetTypes()) {
    const meta = WIDGET_CATALOG[type];
    assert.ok(meta.title, `${type} missing title`);
    assert.ok(meta.description, `${type} missing description`);
    assert.ok(catIds.has(meta.category), `${type} bad category ${meta.category}`);
    assert.ok(meta.minW >= 2 && meta.minH >= 2, `${type} min size`);
    assert.ok(['core', 'extra'].includes(meta.module), `${type} module`);
  }
});

test('category sections cover all non-active types exactly once', () => {
  const seen = new Set();
  for (const cat of WIDGET_CATEGORIES) {
    const types = widgetsByCategory(cat.id);
    assert.ok(types.length > 0, `empty category ${cat.id}`);
    for (const t of types) {
      assert.equal(WIDGET_CATALOG[t].category, cat.id);
      assert.ok(!seen.has(t), `duplicate ${t}`);
      seen.add(t);
    }
  }
  assert.equal(seen.size, allWidgetTypes().length);
});

test('createLayoutEntry copies default settings', () => {
  const e = createLayoutEntry('currency', 1, 2);
  assert.equal(e.type, 'currency');
  assert.equal(e.x, 1);
  assert.equal(e.y, 2);
  assert.equal(e.settings.from, 'USD');
});

test('settings fields align with defaults for configured widgets', () => {
  for (const type of allWidgetTypes()) {
    const fields = getSettingsFields(type);
    const defaults = WIDGET_CATALOG[type].defaultSettings || {};
    for (const f of fields) {
      assert.ok(f.name, `${type} field name`);
      if (Object.prototype.hasOwnProperty.call(defaults, f.name)) {
        assert.equal(defaults[f.name], f.default ?? defaults[f.name]);
      }
    }
  }
});

test('expected widget count for library expansion', () => {
  assert.equal(allWidgetTypes().length, 44);
});
