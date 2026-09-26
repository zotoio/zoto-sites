/** @typedef {{ id: string, type: string, x: number, y: number, w: number, h: number, settings?: Record<string, unknown> }} LayoutWidget */

export const LAYOUT_SCHEMA = 1;
export const STORAGE_KEY = 'today.zoto.io.layout.v1';

/** @returns {import('./widget-registry.js').WidgetType[]} */
export function defaultWidgetTypes() {
  return ['location', 'weather', 'news', 'transit'];
}

/** @returns {{ schema: number, widgets: LayoutWidget[] }} */
export function defaultLayout() {
  return {
    schema: LAYOUT_SCHEMA,
    widgets: [
      { id: 'location', type: 'location', x: 0, y: 0, w: 12, h: 2, settings: {} },
      { id: 'weather', type: 'weather', x: 0, y: 2, w: 7, h: 9, settings: {} },
      { id: 'news', type: 'news', x: 7, y: 2, w: 5, h: 9, settings: { maxItems: 10 } },
      { id: 'transit', type: 'transit', x: 0, y: 11, w: 12, h: 6, settings: {} },
    ],
  };
}

/**
 * @param {unknown} raw
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
  return { schema: LAYOUT_SCHEMA, widgets };
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
