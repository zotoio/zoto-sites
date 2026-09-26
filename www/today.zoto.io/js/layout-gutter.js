import { GRID_GUTTER_PX } from './grid-config.js';
import { rectsConflict } from './layout-normalize.js';

/** Minimum visible gap between widget cards (px). */
export const MIN_WIDGET_GAP_PX = 12;

/**
 * GridStack applies margin on each side of an item; gap between neighbors ≈ 2×margin.
 * @param {number} [marginPx] per-side margin passed to GridStack.init
 */
export function gridStackMarginPerSide(marginPx = GRID_GUTTER_PX) {
  return marginPx;
}

/** @param {{ x: number, y: number, w: number, h: number }} w */
function xOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x;
}

/** @param {{ x: number, y: number, w: number, h: number }} w */
function yOverlap(a, b) {
  return a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Pixel gap between two widgets that share a grid boundary (non-overlapping cells).
 * @param {{ x: number, y: number, w: number, h: number }} a
 * @param {{ x: number, y: number, w: number, h: number }} b
 * @param {number} cellHeight
 * @param {number} marginPx per-side GridStack margin
 */
export function pixelGapBetween(a, b, cellHeight, marginPx) {
  if (rectsConflict(a, b)) return -1;

  let best = Infinity;
  const m = marginPx;

  if (xOverlap(a, b)) {
    if (a.y + a.h <= b.y) {
      const gap = b.y * cellHeight + m - ((a.y + a.h) * cellHeight - m);
      best = Math.min(best, gap);
    } else if (b.y + b.h <= a.y) {
      const gap = a.y * cellHeight + m - ((b.y + b.h) * cellHeight - m);
      best = Math.min(best, gap);
    }
  }

  if (yOverlap(a, b)) {
    const colWidth = 1;
    if (a.x + a.w <= b.x) {
      const gap = b.x * colWidth + m - ((a.x + a.w) * colWidth - m);
      best = Math.min(best, gap);
    } else if (b.x + b.w <= a.x) {
      const gap = a.x * colWidth + m - ((b.x + b.w) * colWidth - m);
      best = Math.min(best, gap);
    }
  }

  return best;
}

/**
 * @param {{ x: number, y: number, w: number, h: number }[]} widgets
 * @param {{ cellHeight?: number, marginPx?: number, minGapPx?: number }} [opts]
 */
export function layoutHasMinimumGutter(widgets, opts = {}) {
  const cellHeight = opts.cellHeight ?? 72;
  const marginPx = opts.marginPx ?? gridStackMarginPerSide();
  const minGapPx = opts.minGapPx ?? MIN_WIDGET_GAP_PX;

  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      const a = widgets[i];
      const b = widgets[j];
      if (rectsConflict(a, b)) return false;
      const gap = pixelGapBetween(a, b, cellHeight, marginPx);
      if (gap >= 0 && gap < minGapPx) return false;
    }
  }
  return true;
}
