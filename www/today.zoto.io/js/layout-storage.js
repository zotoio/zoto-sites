/** @typedef {{ id: string, type: string, x: number, y: number, w: number, h: number, settings?: Record<string, unknown> }} LayoutWidget */

import { createLayoutEntry } from './widget-registry.js';
import { GRID_COLUMNS_ULTRAWIDE } from './display-mode.js';
import { normalizeWidgetLayout } from './layout-normalize.js';

export const LAYOUT_SCHEMA = 1;
export const STORAGE_KEY = 'today.zoto.io.layout.v1';

export function defaultLayout() {
  return {
    schema: LAYOUT_SCHEMA,
    widgets: normalizeWidgetLayout(
      [
        createLayoutEntry('location', 0, 0),
        createLayoutEntry('weather', 0, 2),
        createLayoutEntry('news', 7, 2),
        createLayoutEntry('transit', 0, 11),
      ],
      12
    ),
  };
}

/** Busy layout for demo screenshots when no saved layout exists. */
export function demoShowcaseLayout() {
  const types = [
    ['location', 0, 0, 12, 2],
    ['weather', 0, 2, 5, 7],
    ['news-topics', 5, 2, 4, 7],
    ['clock', 9, 2, 3, 3],
    ['day-progress', 9, 5, 3, 2],
    ['air-quality', 0, 9, 3, 3],
    ['radar', 3, 9, 4, 4],
    ['iss', 7, 9, 3, 3],
    ['daily-quote', 7, 12, 3, 2],
    ['wiki-nearby', 10, 5, 2, 3],
    ['walk-rings', 0, 12, 4, 5],
    ['bikes', 4, 12, 3, 4],
    ['calculator', 10, 12, 2, 4],
    ['transit', 0, 17, 12, 5],
  ];
  return {
    schema: LAYOUT_SCHEMA,
    widgets: normalizeWidgetLayout(
      types.map(([type, x, y, w, h]) => {
        const e = createLayoutEntry(type, x, y);
        e.w = w;
        e.h = h;
        return e;
      }),
      12
    ),
  };
}

/** Demo layout tuned for 24-column ultrawide grid. */
export function ultrawideShowcaseLayout() {
  const types = [
    ['location', 0, 0, 24, 2],
    ['weather', 0, 2, 7, 8],
    ['news-topics', 7, 2, 5, 8],
    ['traffic-cams', 12, 2, 6, 8],
    ['nearby-webcams', 18, 2, 6, 8],
    ['clock', 0, 10, 4, 3],
    ['day-progress', 4, 10, 4, 3],
    ['air-quality', 8, 10, 4, 4],
    ['radar', 12, 10, 6, 6],
    ['iss', 18, 10, 6, 6],
    ['wiki-nearby', 0, 14, 5, 5],
    ['walk-rings', 5, 14, 5, 6],
    ['bikes', 10, 14, 5, 5],
    ['transit', 15, 14, 9, 6],
    ['calculator', 0, 20, 4, 4],
    ['daily-quote', 4, 20, 5, 3],
  ];
  return {
    schema: LAYOUT_SCHEMA,
    widgets: normalizeWidgetLayout(
      types.map(([type, x, y, w, h]) => {
        const e = createLayoutEntry(type, x, y);
        e.w = w;
        e.h = h;
        return e;
      }),
      GRID_COLUMNS_ULTRAWIDE
    ),
  };
}

/**
 * @returns {{ schema: number, widgets: LayoutWidget[] } | null}
 */
export function migrateLayout(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const obj = /** @type {{ schema?: number, widgets?: unknown }} */ (raw);
  if (obj.schema !== LAYOUT_SCHEMA || !Array.isArray(obj.widgets)) return null;
  const widgets = obj.widgets
    .filter((w) => w && typeof w === 'object')
    .map((w) => {
      const item = /** @type {LayoutWidget} */ (w);
      return {
        id: String(item.id || item.type),
        type: String(item.type),
        x: Number(item.x) || 0,
        y: Number(item.y) || 0,
        w: Math.max(2, Number(item.w) || 3),
        h: Math.max(2, Number(item.h) || 3),
        settings: item.settings && typeof item.settings === 'object' ? item.settings : {},
      };
    });
  if (widgets.length === 0) return null;
  return {
    schema: LAYOUT_SCHEMA,
    widgets: normalizeWidgetLayout(widgets, GRID_COLUMNS_ULTRAWIDE),
  };
}

/**
 * @param {Storage | null} storage
 */
export function loadLayout(storage = globalThis.localStorage) {
  if (!storage) return defaultLayout();
  try {
    const parsed = migrateLayout(JSON.parse(storage.getItem(STORAGE_KEY) || 'null'));
    return parsed || defaultLayout();
  } catch {
    return defaultLayout();
  }
}

/**
 * @param {{ schema: number, widgets: LayoutWidget[] }} layout
 * @param {Storage | null} storage
 */
export function saveLayout(layout, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ schema: LAYOUT_SCHEMA, widgets: layout.widgets })
  );
}

export function clearLayout(storage = globalThis.localStorage) {
  if (storage) storage.removeItem(STORAGE_KEY);
}

/**
 * Merge grid positions into layout widget records.
 * @param {LayoutWidget[]} widgets
 * @param {{ id?: string, x?: number, y?: number, w?: number, h?: number }[]} nodes
 */
export function applyGridNodes(widgets, nodes) {
  const byId = new Map(widgets.map((w) => [w.id, w]));
  for (const node of nodes) {
    const id = node.id;
    if (!id || !byId.has(id)) continue;
    const w = byId.get(id);
    w.x = node.x ?? w.x;
    w.y = node.y ?? w.y;
    w.w = node.w ?? w.w;
    w.h = node.h ?? w.h;
  }
  return widgets;
}
