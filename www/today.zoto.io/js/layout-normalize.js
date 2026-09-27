/** @typedef {{ id: string, type: string, x: number, y: number, w: number, h: number }} LayoutRect */

/** True when two widgets occupy overlapping grid cells (margin handles adjacent cells). */
export function rectsConflict(a, b) {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

/**
 * Push widgets apart so no pair shares grid cells. Preserves order (top-to-left sort).
 * @param {LayoutRect[]} widgets
 * @param {number} columns
 */
export function normalizeWidgetLayout(widgets, columns = 12) {
  if (!widgets.length) return widgets;
  const sorted = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];

  for (const item of sorted) {
    const w = { ...item };
    let guard = 0;
    while (guard < 5000) {
      const clash = placed.find((p) => rectsConflict(w, p));
      if (!clash) break;
      w.y = clash.y + clash.h;
      if (w.x + w.w > columns) {
        w.x = 0;
        w.y += 1;
      }
      guard += 1;
    }
    if (w.x + w.w > columns) {
      w.x = Math.max(0, columns - w.w);
    }
    placed.push(w);
  }
  return packWidgetLayoutLeft(placed, columns);
}

/**
 * Slide widgets left within their row when grid cells are free (reduces holes with float:false).
 * @param {LayoutRect[]} widgets
 * @param {number} columns
 */
export function packWidgetLayoutLeft(widgets, columns = 12) {
  const sorted = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const w of sorted) {
    for (let x = 0; x < w.x; x += 1) {
      const trial = { ...w, x };
      if (trial.x + trial.w > columns) continue;
      const blocked = sorted.some((p) => p !== w && rectsConflict(trial, p));
      if (!blocked) w.x = x;
    }
  }
  return sorted;
}
